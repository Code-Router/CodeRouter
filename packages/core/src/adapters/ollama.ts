import type { AdapterCapabilities, ProviderId } from '../types.js';
import { BaseAdapter } from './base.js';
import { httpJson } from './http.js';
import type { AdapterCallInput, AdapterCallResult } from './types.js';

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';

export type OllamaAdapterOptions = {
  model: string;
  baseURL?: string;
  systemPrompt?: string;
  contextWindow?: number;
  timeoutMs?: number;
};

/**
 * Ollama adapter. Always zero-cost (local). Used for the cheap tier of
 * cost-effectiveness routing: trivial fixes, commit messages, lint
 * cleanup, summaries, etc.
 */
export class OllamaAdapter extends BaseAdapter {
  id: ProviderId = 'ollama';
  name = 'Ollama';
  capabilities: AdapterCapabilities;

  constructor(public readonly opts: OllamaAdapterOptions) {
    super();
    this.capabilities = {
      canEdit: false,
      canPlan: false,
      longContext: (opts.contextWindow ?? 32_000) >= 100_000,
      reasoning: false,
      tools: false,
      streaming: true,
      vision: false,
      pricePer1MIn: 0,
      pricePer1MOut: 0,
      contextWindow: opts.contextWindow ?? 32_000,
      family: 'api-model',
    };
  }

  override estimateCost(_in: number, _out: number): number {
    return 0;
  }

  override async run(input: AdapterCallInput): Promise<AdapterCallResult> {
    const start = performance.now();
    const baseURL = this.opts.baseURL ?? process.env.OLLAMA_HOST ?? DEFAULT_BASE_URL;

    const body = {
      model: this.opts.model,
      messages: [
        ...(input.systemPrompt || this.opts.systemPrompt
          ? [{ role: 'system' as const, content: input.systemPrompt ?? this.opts.systemPrompt ?? '' }]
          : []),
        { role: 'user' as const, content: input.prompt },
      ],
      stream: false,
      options: input.maxTokens ? { num_predict: input.maxTokens } : undefined,
    };

    const data = await httpJson<{
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    }>({
      url: `${baseURL.replace(/\/$/, '')}/api/chat`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      timeoutMs: this.opts.timeoutMs ?? 180_000,
      signal: input.signal,
    });

    const text = data.message?.content ?? '';
    const tokensIn = data.prompt_eval_count ?? 0;
    const tokensOut = data.eval_count ?? 0;
    return {
      text,
      tokensIn,
      tokensOut,
      costUsd: 0,
      durationMs: performance.now() - start,
      raw: data,
    };
  }

  /** Lists locally-installed models. Used by config discovery. */
  static async listLocalModels(baseURL?: string): Promise<string[]> {
    const url = `${(baseURL ?? DEFAULT_BASE_URL).replace(/\/$/, '')}/api/tags`;
    try {
      const data = await httpJson<{ models?: { name: string }[] }>({
        url,
        method: 'GET',
        timeoutMs: 3000,
      });
      return (data.models ?? []).map((m) => m.name);
    } catch {
      return [];
    }
  }
}
