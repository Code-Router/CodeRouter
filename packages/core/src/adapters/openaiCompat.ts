import type { AdapterCapabilities, ProviderId } from '../types.js';
import { BaseAdapter } from './base.js';
import { httpJson } from './http.js';
import type { AdapterCallInput, AdapterCallResult } from './types.js';

export type OpenAICompatOptions = {
  /** Display name for this provider, e.g. 'openrouter' or 'deepseek'. */
  providerName: string;
  /** Model identifier sent to the provider. */
  model: string;
  /** Base URL up to but not including `/chat/completions`. */
  baseURL: string;
  /** Env var name holding the API key. */
  apiKeyEnv?: string;
  /** Explicit API key (overrides apiKeyEnv). */
  apiKey?: string;
  /** Per-1M-token prices for cost accounting. */
  pricePer1MIn?: number;
  pricePer1MOut?: number;
  /** Context window (used by router for huge-context routes). */
  contextWindow?: number;
  /** Capability flags this provider/model supports. */
  capabilities?: Partial<AdapterCapabilities>;
  /** Optional reasoning effort param name override (e.g. DeepSeek-Reasoner). */
  reasoningParam?: string;
  /** Optional extra body fields merged into every request. */
  extraBody?: Record<string, unknown>;
  systemPrompt?: string;
  timeoutMs?: number;
};

/**
 * Generic OpenAI-Compatible adapter. Used to plug in OpenRouter, DeepSeek,
 * Groq, Together, Mistral, Fireworks, and any other provider that speaks
 * `/v1/chat/completions`. Capabilities, price, and context window come
 * from the registry config so the router can reason about each route the
 * same way as a first-party adapter.
 */
export class OpenAICompatAdapter extends BaseAdapter {
  id: ProviderId = 'openai_compat';
  name: string;
  capabilities: AdapterCapabilities;

  constructor(public readonly opts: OpenAICompatOptions) {
    super();
    this.name = opts.providerName;
    this.capabilities = {
      canEdit: false,
      canPlan: true,
      longContext: (opts.contextWindow ?? 128_000) >= 200_000,
      reasoning: Boolean(opts.reasoningParam) || /reason/.test(opts.model),
      tools: true,
      streaming: true,
      vision: false,
      pricePer1MIn: opts.pricePer1MIn ?? 0,
      pricePer1MOut: opts.pricePer1MOut ?? 0,
      contextWindow: opts.contextWindow ?? 128_000,
      family: 'api-model',
      ...opts.capabilities,
    };
  }

  override async run(input: AdapterCallInput): Promise<AdapterCallResult> {
    const start = performance.now();
    const apiKey =
      this.opts.apiKey ?? (this.opts.apiKeyEnv ? process.env[this.opts.apiKeyEnv] : undefined);
    if (!apiKey) {
      throw new Error(
        `OpenAICompatAdapter(${this.opts.providerName}): API key not set (env=${this.opts.apiKeyEnv ?? 'unset'})`,
      );
    }

    const messages: { role: 'system' | 'user'; content: string }[] = [];
    const sys = input.systemPrompt ?? this.opts.systemPrompt;
    if (sys) messages.push({ role: 'system', content: sys });
    messages.push({ role: 'user', content: input.prompt });

    const body: Record<string, unknown> = {
      model: this.opts.model,
      messages,
      ...this.opts.extraBody,
    };
    if (input.maxTokens !== undefined) body.max_tokens = input.maxTokens;

    if (this.capabilities.reasoning && input.reasoningEffort) {
      const param = this.opts.reasoningParam ?? 'reasoning_effort';
      body[param] = input.reasoningEffort;
    }

    const data = await httpJson<{
      choices: { message: { content: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    }>({
      url: `${this.opts.baseURL.replace(/\/$/, '')}/chat/completions`,
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
