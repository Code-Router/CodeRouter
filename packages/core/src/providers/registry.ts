import { AnthropicAdapter } from '../adapters/anthropic.js';
import { ClaudeCodeAdapter } from '../adapters/claudeCode.js';
import { CodexAdapter } from '../adapters/codex.js';
import { GoogleAdapter } from '../adapters/google.js';
import { OllamaAdapter } from '../adapters/ollama.js';
import { OpenAIAdapter } from '../adapters/openai.js';
import { OpenAICompatAdapter } from '../adapters/openaiCompat.js';
import type { Adapter } from '../adapters/types.js';
import { applyTransformers } from '../transformers/index.js';
import type { ProviderConfig, ProviderModelConfig } from './types.js';

export type ResolvedRoute = {
  providerName: string;
  model: string;
  adapter: Adapter;
};

/**
 * In-memory registry of providers + lazy adapter construction.
 *
 * Resolution flow:
 *   route string "provider,model" -> registry lookup -> adapter factory
 *   -> wrap with declared transformers -> ResolvedRoute used by the
 *   router / handoff / tournament workflows.
 */
export class ProviderRegistry {
  private readonly providers = new Map<string, ProviderConfig>();
  private readonly adapterCache = new Map<string, Adapter>();

  constructor(providers: ProviderConfig[] = []) {
    for (const p of providers) this.providers.set(p.name, p);
  }

  set(provider: ProviderConfig): void {
    this.providers.set(provider.name, provider);
    for (const key of [...this.adapterCache.keys()]) {
      if (key.startsWith(`${provider.name},`)) this.adapterCache.delete(key);
    }
  }

  list(): ProviderConfig[] {
    return [...this.providers.values()];
  }

  /**
   * Returns true when the provider can actually make a call: it either
   * has a literal `apiKey`, an `apiKeyEnv` whose env var is set, or it's
   * a local-only adapter (ollama / codex / claude_code) that delegates
   * to a host binary instead of an HTTP API.
   *
   * The router uses this to filter shape-based candidates so we don't
   * route to e.g. Google when GOOGLE_API_KEY isn't set just because the
   * default registry knows about Gemini.
   */
  isReady(name: string): boolean {
    const provider = this.providers.get(name);
    if (!provider) return false;
    if (provider.adapter === 'ollama' || provider.adapter === 'codex' || provider.adapter === 'claude_code') {
      return true;
    }
    if (provider.apiKey) return true;
    if (provider.apiKeyEnv && process.env[provider.apiKeyEnv]) return true;
    return false;
  }

  /**
   * Resolve a route string like 'deepseek,deepseek-reasoner' or
   * 'openrouter,anthropic/claude-sonnet-4'.
   */
  resolve(route: string): ResolvedRoute {
    const [providerName, ...modelParts] = route.split(',');
    if (!providerName || modelParts.length === 0) {
      throw new Error(`ProviderRegistry: invalid route '${route}' (want 'provider,model')`);
    }
    const model = modelParts.join(',');
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(
        `ProviderRegistry: unknown provider '${providerName}' (have: ${[...this.providers.keys()].join(', ')})`,
      );
    }
    const modelCfg = provider.models[model];
    if (!modelCfg) {
      throw new Error(
        `ProviderRegistry: unknown model '${model}' on provider '${providerName}' (have: ${Object.keys(provider.models).join(', ')})`,
      );
    }

    const cacheKey = `${providerName},${model}`;
    const cached = this.adapterCache.get(cacheKey);
    if (cached) {
      return { providerName, model, adapter: cached };
    }

    const adapter = this.buildAdapter(provider, model, modelCfg);
    const transformers = [...(provider.transformer ?? []), ...(modelCfg.transformer ?? [])];
    const wrapped = applyTransformers(adapter, transformers, providerName);
    this.adapterCache.set(cacheKey, wrapped);
    return { providerName, model, adapter: wrapped };
  }

  private buildAdapter(
    provider: ProviderConfig,
    model: string,
    cfg: ProviderModelConfig,
  ): Adapter {
    const apiKey =
      provider.apiKey ?? (provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : undefined);
    switch (provider.adapter) {
      case 'openai':
        return new OpenAIAdapter({
          model,
          apiKey,
          baseURL: provider.baseURL,
        });
      case 'anthropic':
        return new AnthropicAdapter({
          model,
          apiKey,
          baseURL: provider.baseURL,
        });
      case 'google':
        return new GoogleAdapter({
          model,
          apiKey,
          baseURL: provider.baseURL,
        });
      case 'openai_compat':
        if (!provider.baseURL)
          throw new Error(`openai_compat provider '${provider.name}' requires baseURL`);
        return new OpenAICompatAdapter({
          providerName: provider.name,
          model,
          baseURL: provider.baseURL,
          apiKey,
          apiKeyEnv: provider.apiKeyEnv,
          pricePer1MIn: cfg.pricePer1MIn,
          pricePer1MOut: cfg.pricePer1MOut,
          contextWindow: cfg.contextWindow,
          capabilities: cfg.capabilities,
          reasoningParam: cfg.reasoningParam,
          extraBody: cfg.extraBody,
        });
      case 'ollama':
        return new OllamaAdapter({
          model,
          baseURL: provider.baseURL,
          contextWindow: cfg.contextWindow,
        });
      case 'codex':
        return new CodexAdapter({ model });
      case 'claude_code':
        return new ClaudeCodeAdapter({ model });
      default:
        throw new Error(`ProviderRegistry: unsupported adapter '${provider.adapter}'`);
    }
  }
}

/**
 * Sensible default registry covering the providers we ship support for
 * out of the box. Users override / extend via `coderouter.config.ts`.
 */
export function defaultProviders(): ProviderConfig[] {
  return [
    {
      name: 'openai',
      adapter: 'openai',
      apiKeyEnv: 'OPENAI_API_KEY',
      transformer: ['maxTokens', 'reasoning', 'tooluse', 'streaming'],
      models: {
        'gpt-5': { contextWindow: 400_000 },
        'gpt-5-reasoning': { contextWindow: 400_000, transformer: ['reasoning'] },
        'gpt-5-mini': { contextWindow: 400_000 },
        'gpt-4o': { contextWindow: 128_000 },
        'gpt-4o-mini': { contextWindow: 128_000 },
        'o4-mini': { contextWindow: 200_000, transformer: ['reasoning'] },
      },
    },
    {
      name: 'anthropic',
      adapter: 'anthropic',
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      transformer: ['maxTokens', 'tooluse', 'streaming'],
      models: {
        'claude-opus-4-1': { contextWindow: 200_000 },
        'claude-sonnet-4-5': { contextWindow: 200_000 },
        'claude-3-5-haiku-latest': { contextWindow: 200_000 },
      },
    },
    {
      name: 'google',
      adapter: 'google',
      apiKeyEnv: 'GOOGLE_API_KEY',
      transformer: ['maxTokens', 'tooluse', 'streaming'],
      models: {
        'gemini-2.5-pro': { contextWindow: 2_000_000 },
        'gemini-2.5-flash': { contextWindow: 1_000_000 },
      },
    },
    {
      name: 'deepseek',
      adapter: 'openai_compat',
      baseURL: 'https://api.deepseek.com/v1',
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      transformer: ['maxTokens', 'reasoning', 'tooluse', 'streaming'],
      models: {
        'deepseek-chat': {
          pricePer1MIn: 0.27,
          pricePer1MOut: 1.1,
          contextWindow: 128_000,
        },
        'deepseek-reasoner': {
          pricePer1MIn: 0.55,
          pricePer1MOut: 2.19,
          contextWindow: 64_000,
          reasoningParam: 'reasoning_effort',
          capabilities: { reasoning: true },
        },
      },
    },
    {
      name: 'openrouter',
      adapter: 'openai_compat',
      baseURL: 'https://openrouter.ai/api/v1',
      apiKeyEnv: 'OPENROUTER_API_KEY',
      transformer: ['maxTokens', 'tooluse', 'streaming'],
      models: {
        'anthropic/claude-opus-4-1': {
          pricePer1MIn: 15,
          pricePer1MOut: 75,
          contextWindow: 200_000,
        },
        'anthropic/claude-sonnet-4-5': {
          pricePer1MIn: 3,
          pricePer1MOut: 15,
          contextWindow: 200_000,
        },
        'google/gemini-2.5-pro': {
          pricePer1MIn: 1.25,
          pricePer1MOut: 10,
          contextWindow: 2_000_000,
          capabilities: { longContext: true },
        },
        'deepseek/deepseek-chat': {
          pricePer1MIn: 0.27,
          pricePer1MOut: 1.1,
          contextWindow: 128_000,
        },
      },
    },
    {
      name: 'groq',
      adapter: 'openai_compat',
      baseURL: 'https://api.groq.com/openai/v1',
      apiKeyEnv: 'GROQ_API_KEY',
      transformer: ['maxTokens', 'tooluse', 'streaming'],
      models: {
        'llama-3.3-70b-versatile': {
          pricePer1MIn: 0.59,
          pricePer1MOut: 0.79,
          contextWindow: 128_000,
        },
      },
    },
    {
      name: 'ollama',
      adapter: 'ollama',
      transformer: ['maxTokens', 'tooluse', 'streaming'],
      models: {
        'llama3.2': { contextWindow: 32_000 },
        'qwen2.5-coder:7b': { contextWindow: 32_000 },
        'qwen2.5-coder:14b': { contextWindow: 32_000 },
      },
    },
    {
      name: 'codex',
      adapter: 'codex',
      transformer: [],
      models: {
        default: {},
        'gpt-5-codex': {},
      },
    },
    {
      name: 'claude_code',
      adapter: 'claude_code',
      transformer: [],
      models: {
        default: {},
        opus: {},
        sonnet: {},
      },
    },
  ];
}
