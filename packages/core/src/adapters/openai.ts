import type { AdapterCapabilities, ProviderId } from '../types.js';
import { BaseAdapter } from './base.js';
import { httpJson } from './http.js';
import type { AdapterCallInput, AdapterCallResult } from './types.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

const PRICE_PER_1M: Record<string, { in: number; out: number; ctx: number }> = {
  'gpt-5': { in: 3, out: 15, ctx: 400_000 },
  'gpt-5-reasoning': { in: 5, out: 25, ctx: 400_000 },
  'gpt-5-mini': { in: 0.5, out: 2, ctx: 400_000 },
  'gpt-4o': { in: 2.5, out: 10, ctx: 128_000 },
  'gpt-4o-mini': { in: 0.15, out: 0.6, ctx: 128_000 },
  'o3-mini': { in: 1.1, out: 4.4, ctx: 200_000 },
  'o4-mini': { in: 1.1, out: 4.4, ctx: 200_000 },
};

export type OpenAIAdapterOptions = {
  model: string;
  apiKey?: string;
  baseURL?: string;
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  systemPrompt?: string;
  timeoutMs?: number;
};

/** OpenAI Chat Completions / Responses adapter. Used for GPT-5, o-series, etc. */
export class OpenAIAdapter extends BaseAdapter {
  id: ProviderId = 'openai';
  name = 'OpenAI';
  capabilities: AdapterCapabilities;

  constructor(public readonly opts: OpenAIAdapterOptions) {
    super();
    const price = PRICE_PER_1M[opts.model] ?? { in: 3, out: 15, ctx: 128_000 };
    const isReasoning = /reason|o3|o4|gpt-5/.test(opts.model);
    this.capabilities = {
      canEdit: false,
      canPlan: true,
      longContext: price.ctx >= 200_000,
      reasoning: isReasoning,
      tools: true,
      streaming: true,
      vision: /gpt-4o|gpt-5/.test(opts.model),
      pricePer1MIn: price.in,
      pricePer1MOut: price.out,
      contextWindow: price.ctx,
      family: 'api-model',
    };
  }

  override async run(input: AdapterCallInput): Promise<AdapterCallResult> {
    const start = performance.now();
    const apiKey = this.opts.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OpenAIAdapter: OPENAI_API_KEY is not set');

    const baseURL = this.opts.baseURL ?? DEFAULT_BASE_URL;

    type ChatBody = {
      model: string;
      messages: { role: 'system' | 'user'; content: string }[];
      max_completion_tokens?: number;
      reasoning_effort?: string;
    };

    const body: ChatBody = {
      model: this.opts.model,
      messages: [
        ...(input.systemPrompt || this.opts.systemPrompt
          ? [{ role: 'system' as const, content: input.systemPrompt ?? this.opts.systemPrompt ?? '' }]
          : []),
        { role: 'user' as const, content: input.prompt },
      ],
      max_completion_tokens: input.maxTokens,
    };

    const effort = input.reasoningEffort ?? this.opts.reasoningEffort;
    if (this.capabilities.reasoning && effort) body.reasoning_effort = effort;

    const data = await httpJson<{
      choices: { message: { content: string } }[];
      usage?: { prompt_tokens: number; completion_tokens: number };
    }>({
      url: `${baseURL}/chat/completions`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body,
      timeoutMs: this.opts.timeoutMs ?? 120_000,
      signal: input.signal,
    });

    const text = data.choices[0]?.message?.content ?? '';
    const tokensIn = data.usage?.prompt_tokens ?? 0;
    const tokensOut = data.usage?.completion_tokens ?? 0;
    return {
      text,
      tokensIn,
      tokensOut,
      costUsd: this.estimateCost(tokensIn, tokensOut),
      durationMs: performance.now() - start,
      raw: data,
    };
  }
}
