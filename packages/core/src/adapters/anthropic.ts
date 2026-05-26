import type { AdapterCapabilities, ProviderId } from '../types.js';
import { BaseAdapter } from './base.js';
import { httpJson } from './http.js';
import type { AdapterCallInput, AdapterCallResult } from './types.js';

const DEFAULT_BASE_URL = 'https://api.anthropic.com';

const PRICE_PER_1M: Record<string, { in: number; out: number; ctx: number }> = {
  'claude-opus-4-1': { in: 15, out: 75, ctx: 200_000 },
  'claude-opus-4': { in: 15, out: 75, ctx: 200_000 },
  'claude-sonnet-4-5': { in: 3, out: 15, ctx: 200_000 },
  'claude-sonnet-4': { in: 3, out: 15, ctx: 200_000 },
  'claude-3-7-sonnet-latest': { in: 3, out: 15, ctx: 200_000 },
  'claude-3-5-sonnet-latest': { in: 3, out: 15, ctx: 200_000 },
  'claude-3-5-haiku-latest': { in: 0.8, out: 4, ctx: 200_000 },
};

export type AnthropicAdapterOptions = {
  model: string;
  apiKey?: string;
  baseURL?: string;
  apiVersion?: string;
  systemPrompt?: string;
  timeoutMs?: number;
};

/** Direct Anthropic Messages API adapter (Opus/Sonnet/Haiku). */
export class AnthropicAdapter extends BaseAdapter {
  id: ProviderId = 'anthropic';
  name = 'Anthropic';
  capabilities: AdapterCapabilities;

  constructor(public readonly opts: AnthropicAdapterOptions) {
    super();
    const price = PRICE_PER_1M[opts.model] ?? { in: 3, out: 15, ctx: 200_000 };
    this.capabilities = {
      canEdit: false,
      canPlan: true,
      longContext: price.ctx >= 200_000,
      reasoning: /opus|sonnet-4/.test(opts.model),
      tools: true,
      streaming: true,
      vision: true,
      pricePer1MIn: price.in,
      pricePer1MOut: price.out,
      contextWindow: price.ctx,
      family: 'api-model',
    };
  }

  override async run(input: AdapterCallInput): Promise<AdapterCallResult> {
    const start = performance.now();
    const apiKey = this.opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('AnthropicAdapter: ANTHROPIC_API_KEY is not set');

    const baseURL = this.opts.baseURL ?? DEFAULT_BASE_URL;
    const body = {
      model: this.opts.model,
      max_tokens: input.maxTokens ?? 4096,
      system: input.systemPrompt ?? this.opts.systemPrompt ?? undefined,
      messages: [{ role: 'user' as const, content: input.prompt }],
    };

    const data = await httpJson<{
      content: { type: string; text?: string }[];
      usage?: { input_tokens: number; output_tokens: number };
    }>({
      url: `${baseURL}/v1/messages`,
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': this.opts.apiVersion ?? '2023-06-01',
        'Content-Type': 'application/json',
      },
      body,
      timeoutMs: this.opts.timeoutMs ?? 120_000,
      signal: input.signal,
    });

    const text = data.content
      .map((c) => (c.type === 'text' ? (c.text ?? '') : ''))
      .join('');
    const tokensIn = data.usage?.input_tokens ?? 0;
    const tokensOut = data.usage?.output_tokens ?? 0;
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
