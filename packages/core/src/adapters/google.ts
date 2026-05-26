import type { AdapterCapabilities, ProviderId } from '../types.js';
import { BaseAdapter } from './base.js';
import { httpJson } from './http.js';
import type { AdapterCallInput, AdapterCallResult } from './types.js';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';

const PRICE_PER_1M: Record<string, { in: number; out: number; ctx: number }> = {
  'gemini-2.5-pro': { in: 1.25, out: 10, ctx: 2_000_000 },
  'gemini-2.5-flash': { in: 0.3, out: 2.5, ctx: 1_000_000 },
  'gemini-2.0-pro': { in: 1.25, out: 10, ctx: 1_000_000 },
};

export type GoogleAdapterOptions = {
  model: string;
  apiKey?: string;
  baseURL?: string;
  systemPrompt?: string;
  timeoutMs?: number;
};

/** Google Generative Language API adapter (Gemini family - huge context). */
export class GoogleAdapter extends BaseAdapter {
  id: ProviderId = 'google';
  name = 'Google';
  capabilities: AdapterCapabilities;

  constructor(public readonly opts: GoogleAdapterOptions) {
    super();
    const price = PRICE_PER_1M[opts.model] ?? { in: 1.25, out: 10, ctx: 1_000_000 };
    this.capabilities = {
      canEdit: false,
      canPlan: true,
      longContext: true,
      reasoning: opts.model.includes('pro'),
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
    const apiKey = this.opts.apiKey ?? process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GoogleAdapter: GOOGLE_API_KEY / GEMINI_API_KEY is not set');

    const baseURL = this.opts.baseURL ?? DEFAULT_BASE_URL;
    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
      generationConfig: {
        maxOutputTokens: input.maxTokens ?? 4096,
      },
    };
    const sys = input.systemPrompt ?? this.opts.systemPrompt;
    if (sys) body.systemInstruction = { parts: [{ text: sys }] };

    const data = await httpJson<{
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
    }>({
      url: `${baseURL}/v1beta/models/${encodeURIComponent(this.opts.model)}:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      timeoutMs: this.opts.timeoutMs ?? 120_000,
      signal: input.signal,
    });

    const text =
      data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    const tokensIn = data.usageMetadata?.promptTokenCount ?? 0;
    const tokensOut = data.usageMetadata?.candidatesTokenCount ?? 0;
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
