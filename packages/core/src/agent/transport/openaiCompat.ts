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

import { httpJson } from '../../adapters/http.js';
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
    const body: Record<string, unknown> = {
      model: this.opts.model,
      messages: req.messages,
      tools: req.tools,
      tool_choice: 'auto',
      // Ask OpenRouter to report the real charged cost in `usage.cost`.
      // Gated to OpenRouter because a top-level `usage` field isn't part
      // of the standard OpenAI body and some strict backends reject it.
      ...(isOpenRouter(this.opts.baseURL) ? { usage: { include: true } } : {}),
      ...(this.opts.extraBody ?? {}),
    };
    if (req.reasoningEffort) {
      const param = this.opts.reasoningParam ?? 'reasoning_effort';
      body[param] = req.reasoningEffort;
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.opts.apiKey}`,
      'Content-Type': 'application/json',
      // Harmless on backends that ignore them; OpenRouter uses these
      // for attribution + safety throttling.
      'HTTP-Referer': 'https://github.com/coderouter/coderouter',
      'X-Title': 'CodeRouter',
      ...(this.opts.extraHeaders ?? {}),
    };

    const data = await httpJson<RawCompletionResponse>({
      url: `${this.opts.baseURL.replace(/\/$/, '')}/chat/completions`,
      method: 'POST',
      headers,
      body,
      timeoutMs: this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
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

  estimateCost(tokensIn: number, tokensOut: number): number {
    const inP = this.opts.pricePer1MIn ?? 0;
    const outP = this.opts.pricePer1MOut ?? 0;
    return (tokensIn * inP + tokensOut * outP) / 1_000_000;
  }
}
