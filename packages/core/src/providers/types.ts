import type { AdapterCapabilities, ProviderId } from '../types.js';

/**
 * A `ProviderConfig` declares one named provider (e.g. 'openrouter',
 * 'deepseek', 'ollama'). The router resolves route strings like
 * `'deepseek,deepseek-reasoner'` against this registry.
 *
 * Inspired by Claude Code Router's named-route pattern, but with a
 * stronger type for the underlying adapter so the router can reason
 * about cost, context window, and capabilities without re-hardcoding
 * model knowledge in three places.
 */
export type ProviderConfig = {
  name: string;
  adapter: ProviderId;
  baseURL?: string;
  apiKeyEnv?: string;
  apiKey?: string;
  /** Default transformer chain applied to every call through this provider. */
  transformer?: string[];
  /** Per-model capability + price overrides. */
  models: Record<string, ProviderModelConfig>;
  /**
   * Optional dynamic-catalog source. When set, the registry will
   * fall through to this catalog for any model id that's not in
   * the static `models` map - synthesising a `ProviderModelConfig`
   * from catalog metadata (context window, pricing, capabilities).
   * The static map still wins, so curated models can override the
   * catalog defaults for routing rankings or pinned pricing.
   */
  dynamicCatalog?: 'openrouter';
};

export type ProviderModelConfig = {
  pricePer1MIn?: number;
  pricePer1MOut?: number;
  contextWindow?: number;
  capabilities?: Partial<AdapterCapabilities>;
  reasoningParam?: string;
  /** Per-model transformer chain (concatenated with the provider default). */
  transformer?: string[];
  /** Optional extra body fields merged into every request. */
  extraBody?: Record<string, unknown>;
};
