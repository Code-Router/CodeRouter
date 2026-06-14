import { execFileSync } from 'node:child_process';
import type { AdapterCapabilities, ProviderId } from '../types.js';
import { BaseAdapter } from './base.js';
import { httpJson } from './http.js';
import type { AdapterCallInput, AdapterCallResult } from './types.js';

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';

/**
 * Cached set of locally-pulled Ollama model tags (e.g.
 * `qwen2.5-coder:7b`, `llama3.2:1b`). Populated lazily from
 * `ollama list` and memoised for the process lifetime - pulling a
 * model mid-run is rare enough that a restart is an acceptable ask.
 *
 * Why this exists: having the `ollama` binary on PATH says nothing
 * about which models are pulled. The router used to treat "binary
 * present" as "provider ready", route a plan phase to
 * `qwen2.5-coder:7b`, and crash with an HTTP 404 from the local
 * server when the model wasn't installed. Readiness now requires
 * the *specific configured model* to actually be present.
 */
let ollamaModelsCache: Set<string> | null = null;

function installedOllamaModels(): Set<string> {
  if (ollamaModelsCache) return ollamaModelsCache;
  const models = new Set<string>();
  try {
    const out = execFileSync('ollama', ['list'], {
      encoding: 'utf8',
      timeout: 3_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    for (const line of out.split('\n').slice(1)) {
      const name = line.trim().split(/\s+/)[0];
      if (name) models.add(name);
    }
  } catch {
    // `ollama list` failed (server not running, binary missing).
    // Treat as "no models" - the router will skip ollama entirely,
    // which is strictly better than routing to a 404.
  }
  ollamaModelsCache = models;
  return models;
}

/**
 * True when `model` is pulled locally. A bare configured name like
 * `llama3.2` is what `ollama run` resolves as `llama3.2:latest`, so
 * we match it against the `:latest` tag - an installed `llama3.2:1b`
 * does NOT satisfy a configured `llama3.2`.
 */
export function isOllamaModelInstalled(model: string): boolean {
  const installed = installedOllamaModels();
  if (installed.has(model)) return true;
  if (!model.includes(':')) return installed.has(`${model}:latest`);
  return false;
}

/** Test hook: clear the `ollama list` memo. */
export function resetOllamaModelsCache(): void {
  ollamaModelsCache = null;
}

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
