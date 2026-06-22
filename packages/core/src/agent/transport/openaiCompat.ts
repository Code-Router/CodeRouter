/**
 * OpenAI-compatible chat/completions transport.
 *
 * Targets any backend that speaks OpenAI's `/chat/completions` with
 * `tools[]` and `tool_choice` (OpenRouter, OpenAI direct, Groq,
 * DeepSeek, Together, Fireworks, Mistral, ...). Non-streaming for
 * now - one HTTP round trip per `sendTurn`. SSE streaming is a
 * follow-up that swaps the body of `sendTurn` without touching the
 * Transport interface.
 */

import { httpJson, httpStream } from '../../adapters/http.js';
import type {
  ChatTransport,
  ChatTurnRequest,
  ChatTurnResponse,
  ToolCall,
} from './types.js';

export type OpenAICompatTransportOptions = {
  /** Display name for diagnostics. */
  providerName: string;
  /** Wire-level model id. */
  model: string;
  /** Base URL up to but not including `/chat/completions`. */
  baseURL: string;
  /** Bearer token. */
  apiKey: string;
  /** Per-request HTTP timeout (ms). Default 120s. */
  timeoutMs?: number;
  /** Pricing for cost accounting. */
  pricePer1MIn?: number;
  pricePer1MOut?: number;
  /** Override the reasoning_effort param name (e.g. some providers use `effort`). */
  reasoningParam?: string;
  /**
   * Extra headers merged into every request. Default headers
   * already include OpenRouter's attribution headers
   * (`HTTP-Referer`, `X-Title`); explicit overrides win.
   */
  extraHeaders?: Record<string, string>;
  /**
   * Extra body fields merged into every request (after the standard
   * ones). Useful for provider-specific knobs we don't model yet.
   */
  extraBody?: Record<string, unknown>;
};

type RawCompletionResponse = {
  choices: Array<{
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    /**
     * OpenRouter-only: the actual USD cost of the generation (already
     * net of caching discounts, BYOK, etc.). Present when the request
     * body carries `usage: { include: true }`.
     */
    cost?: number;
  };
  model?: string;
};

type StreamChunk = {
  choices?: Array<{
    delta: {
      content?: string;
      reasoning_content?: string;
      reasoning?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
  };
};

/** Whether a base URL points at OpenRouter, which can return real cost. */
function isOpenRouter(baseURL: string): boolean {
  return /openrouter\.ai/i.test(baseURL);
}

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * OpenAI-compatible transport. Intended to be constructed once per
 * agent run and handed to `runAgent({ transport })`.
 */
export class OpenAICompatTransport implements ChatTransport {
  readonly kind = 'openai-compat';

  constructor(public readonly opts: OpenAICompatTransportOptions) {}

  async sendTurn(req: ChatTurnRequest): Promise<ChatTurnResponse> {
    const baseBody: Record<string, unknown> = {
      model: this.opts.model,
      messages: req.messages,
      tools: req.tools,
      tool_choice: 'auto',
      ...(isOpenRouter(this.opts.baseURL) ? { usage: { include: true } } : {}),
      ...(this.opts.extraBody ?? {}),
    };
    if (req.reasoningEffort) {
      const param = this.opts.reasoningParam ?? 'reasoning_effort';
      baseBody[param] = req.reasoningEffort;
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.opts.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/coderouter/coderouter',
      'X-Title': 'CodeRouter',
      ...(this.opts.extraHeaders ?? {}),
    };

    const url = `${this.opts.baseURL.replace(/\/$/, '')}/chat/completions`;
    const timeoutMs = this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    // Streaming path: when the caller provides onDelta, use SSE.
    if (req.onDelta) {
      return this.sendTurnStreaming(url, headers, baseBody, timeoutMs, req);
    }

    // Non-streaming fallback (original path).
    const data = await httpJson<RawCompletionResponse>({
      url,
      method: 'POST',
      headers,
      body: baseBody,
      timeoutMs,
      signal: req.signal,
    });

    const choice = data.choices[0];
    if (!choice) {
      throw new Error(
        `OpenAICompatTransport(${this.opts.providerName}): backend returned no choices`,
      );
    }
    const tokensIn = data.usage?.prompt_tokens ?? 0;
    const tokensOut = data.usage?.completion_tokens ?? 0;
    const costUsd = typeof data.usage?.cost === 'number' ? data.usage.cost : undefined;

    return {
      message: {
        role: 'assistant',
        content: choice.message.content ?? null,
        tool_calls: choice.message.tool_calls,
      },
      tokensIn,
      tokensOut,
      costUsd,
      finishReason: choice.finish_reason,
    };
  }

  private async sendTurnStreaming(
    url: string,
    headers: Record<string, string>,
    baseBody: Record<string, unknown>,
    timeoutMs: number,
    req: ChatTurnRequest,
  ): Promise<ChatTurnResponse> {
    const body = {
      ...baseBody,
      stream: true,
      stream_options: { include_usage: true },
    };

    let content = '';
    let reasoning = '';
    let finishReason: string | undefined;
    let tokensIn = 0;
    let tokensOut = 0;
    let costUsd: number | undefined;

    // Tool calls are delivered incrementally by index. We accumulate
    // id, function name, and arguments fragments per index.
    const toolCallAccum: Map<number, { id: string; name: string; args: string }> = new Map();

    await httpStream(
      { url, method: 'POST', headers, body, idleTimeoutMs: timeoutMs, signal: req.signal },
      (event: unknown) => {
        const chunk = event as StreamChunk;

        // Usage is reported in a final chunk with choices=[].
        if (chunk.usage) {
          tokensIn = chunk.usage.prompt_tokens ?? tokensIn;
          tokensOut = chunk.usage.completion_tokens ?? tokensOut;
          if (typeof chunk.usage.cost === 'number') costUsd = chunk.usage.cost;
        }

        const delta = chunk.choices?.[0]?.delta;
        if (!delta) return;

        if (chunk.choices![0]!.finish_reason) {
          finishReason = chunk.choices![0]!.finish_reason;
        }

        // Content delta
        if (delta.content) {
          content += delta.content;
          req.onDelta!({ content: delta.content });
        }

        // Reasoning delta (OpenAI uses `reasoning_content`, some use `reasoning`)
        const reasoningDelta = delta.reasoning_content ?? delta.reasoning;
        if (reasoningDelta) {
          reasoning += reasoningDelta;
          req.onDelta!({ reasoning: reasoningDelta });
        }

        // Tool call deltas
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            let acc = toolCallAccum.get(idx);
            if (!acc) {
              acc = { id: tc.id ?? '', name: tc.function?.name ?? '', args: '' };
              toolCallAccum.set(idx, acc);
            }
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.name = tc.function.name;
            if (tc.function?.arguments) acc.args += tc.function.arguments;
          }
        }
      },
    );

    // Assemble the final tool_calls array from accumulated fragments.
    const toolCalls: ToolCall[] = [];
    for (const [, acc] of [...toolCallAccum.entries()].sort((a, b) => a[0] - b[0])) {
      toolCalls.push({
        id: acc.id,
        type: 'function',
        function: { name: acc.name, arguments: acc.args },
      });
    }

    return {
      message: {
        role: 'assistant',
        content: content || null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      },
      tokensIn,
      tokensOut,
      costUsd,
      finishReason,
      streamed: true,
      reasoning: reasoning || undefined,
    };
  }

  estimateCost(tokensIn: number, tokensOut: number): number {
    const inP = this.opts.pricePer1MIn ?? 0;
    const outP = this.opts.pricePer1MOut ?? 0;
    return (tokensIn * inP + tokensOut * outP) / 1_000_000;
  }
}
