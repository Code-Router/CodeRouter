/**
 * Routing intents that the policy can ask the catalog to satisfy.
 *
 * Each intent describes *what we want from a model* in business terms,
 * not which model. The catalog maps intents -> ranked candidate models
 * across providers, and the router picks the highest-ranked entry that
 * belongs to a `ready` provider.
 *
 * Adding a new intent requires:
 * 1. Adding the literal here.
 * 2. Annotating at least one catalog entry with that intent + a rank.
 * 3. Optionally, calling `resolveIntent` from `router/policy.ts`.
 */
export type Intent =
  | 'deep-reasoning' // GPT-5, o-series, deepseek-reasoner, etc.
  | 'multi-file' // Opus-tier, good at large refactors
  | 'huge-context' // Long-context models (Gemini 2.5 Pro, GPT-4.1)
  | 'balanced-agent' // Default daily-driver: Sonnet, GPT-5
  | 'fast-cheap' // Trivial tasks: Haiku, gpt-4o-mini, deepseek-chat
  | 'local-offline'; // Ollama or other on-device

/**
 * The intent layer: what the router cares about. `rank` is a small
 * positive integer (lower = better) used only when multiple ready
 * providers can satisfy the same intent.
 */
export type IntentBinding = {
  intent: Intent;
  rank: number;
};

/**
 * A single concrete model exposed by a provider.
 *
 * - `provider`: the `ProviderRegistry` name (must exist in the registry).
 * - `model`: the wire-level model id we send to the provider.
 * - `intents`: which routing intents this model can satisfy.
 *
 * `contextWindow` and the price fields are advisory; they exist so the
 * router can use them as tiebreakers and so we can surface a budget
 * estimate in the UI. They aren't required for the route to be valid.
 */
export type CatalogEntry = {
  provider: string;
  model: string;
  contextWindow?: number;
  pricePer1MIn?: number;
  pricePer1MOut?: number;
  capabilities?: {
    reasoning?: boolean;
    longContext?: boolean;
    visionInput?: boolean;
    tooluse?: boolean;
  };
  intents: IntentBinding[];
};

export type Catalog = readonly CatalogEntry[];
