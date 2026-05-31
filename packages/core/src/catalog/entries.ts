import type { Catalog } from './types.js';

/**
 * Curated catalog of routable models, grouped by routing intent.
 *
 * This is intentionally hand-maintained right now (rather than fetched
 * from LiteLLM at startup) so:
 *   1. The CLI works offline / on a fresh install with no network.
 *   2. We can verify that every entry is actually a model name a
 *      provider's API still accepts. LiteLLM's full catalog has 1k+
 *      entries including deprecated ones; most of them aren't useful
 *      for the router.
 *
 * To add a new model:
 *   - Confirm the wire-level model id from the provider's docs.
 *   - Pick the smallest set of intents it fits. Don't tag a fast/cheap
 *     model with `deep-reasoning` "just in case" - the router uses the
 *     ranks to break ties between providers, not to grade models.
 *   - Rank 1 = best-in-class for that intent; rank 5 = "usable but
 *     we'd rather route elsewhere if available".
 *
 * The router prefers low ranks but always honors provider readiness
 * first - a rank-5 entry on a configured provider wins over a rank-1
 * entry on a provider whose key is missing.
 */
export const CATALOG: Catalog = [
  // -----------------------------------------------------------------
  // Local host CLIs - always tried first when on PATH because they
  // ride the user's existing Codex / Claude Code / Ollama setup.
  // -----------------------------------------------------------------
  {
    provider: 'codex',
    model: 'gpt-5-codex',
    capabilities: { reasoning: true, tooluse: true },
    intents: [
      { intent: 'deep-reasoning', rank: 1 },
      { intent: 'balanced-agent', rank: 2 },
      { intent: 'multi-file', rank: 2 },
    ],
  },
  {
    provider: 'claude_code',
    model: 'sonnet',
    capabilities: { tooluse: true },
    intents: [
      { intent: 'balanced-agent', rank: 1 },
      { intent: 'multi-file', rank: 2 },
    ],
  },
  {
    provider: 'claude_code',
    model: 'opus',
    capabilities: { tooluse: true },
    intents: [
      { intent: 'multi-file', rank: 1 },
      { intent: 'deep-reasoning', rank: 3 },
    ],
  },
  {
    provider: 'ollama',
    model: 'qwen2.5-coder:7b',
    intents: [
      { intent: 'local-offline', rank: 1 },
      { intent: 'fast-cheap', rank: 4 },
    ],
  },
  {
    provider: 'ollama',
    model: 'llama3.2',
    intents: [
      { intent: 'local-offline', rank: 2 },
      { intent: 'fast-cheap', rank: 5 },
    ],
  },

  // -----------------------------------------------------------------
  // OpenAI native API
  // -----------------------------------------------------------------
  {
    provider: 'openai',
    model: 'gpt-5',
    contextWindow: 400_000,
    pricePer1MIn: 5,
    pricePer1MOut: 15,
    capabilities: { reasoning: true, tooluse: true },
    intents: [
      { intent: 'deep-reasoning', rank: 2 },
      { intent: 'balanced-agent', rank: 3 },
    ],
  },
  {
    provider: 'openai',
    model: 'gpt-5.5',
    contextWindow: 400_000,
    capabilities: { reasoning: true, tooluse: true },
    intents: [
      { intent: 'deep-reasoning', rank: 2 },
      { intent: 'balanced-agent', rank: 3 },
    ],
  },
  {
    provider: 'openai',
    model: 'gpt-5-mini',
    contextWindow: 400_000,
    capabilities: { tooluse: true },
    intents: [
      { intent: 'balanced-agent', rank: 4 },
      { intent: 'fast-cheap', rank: 2 },
    ],
  },
  {
    provider: 'openai',
    model: 'gpt-4.1',
    contextWindow: 1_000_000,
    capabilities: { longContext: true, tooluse: true },
    intents: [
      { intent: 'huge-context', rank: 2 },
      { intent: 'balanced-agent', rank: 4 },
    ],
  },
  {
    provider: 'openai',
    model: 'gpt-4o-mini',
    contextWindow: 128_000,
    pricePer1MIn: 0.15,
    pricePer1MOut: 0.6,
    capabilities: { tooluse: true },
    intents: [{ intent: 'fast-cheap', rank: 1 }],
  },

  // -----------------------------------------------------------------
  // Anthropic native API
  // -----------------------------------------------------------------
  {
    provider: 'anthropic',
    model: 'claude-opus-4-5',
    contextWindow: 200_000,
    pricePer1MIn: 15,
    pricePer1MOut: 75,
    capabilities: { tooluse: true },
    intents: [
      { intent: 'multi-file', rank: 1 },
      { intent: 'deep-reasoning', rank: 3 },
    ],
  },
  {
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    contextWindow: 200_000,
    pricePer1MIn: 3,
    pricePer1MOut: 15,
    capabilities: { tooluse: true },
    intents: [
      { intent: 'balanced-agent', rank: 1 },
      { intent: 'multi-file', rank: 3 },
    ],
  },
  {
    provider: 'anthropic',
    model: 'claude-3-5-haiku-latest',
    contextWindow: 200_000,
    pricePer1MIn: 0.8,
    pricePer1MOut: 4,
    capabilities: { tooluse: true },
    intents: [{ intent: 'fast-cheap', rank: 2 }],
  },

  // -----------------------------------------------------------------
  // Google native API
  // -----------------------------------------------------------------
  {
    provider: 'google',
    model: 'gemini-2.5-pro',
    contextWindow: 2_000_000,
    pricePer1MIn: 1.25,
    pricePer1MOut: 10,
    capabilities: { longContext: true, tooluse: true, visionInput: true },
    intents: [
      { intent: 'huge-context', rank: 1 },
      { intent: 'balanced-agent', rank: 4 },
    ],
  },
  {
    provider: 'google',
    model: 'gemini-2.5-flash',
    contextWindow: 1_000_000,
    pricePer1MIn: 0.075,
    pricePer1MOut: 0.3,
    capabilities: { longContext: true, tooluse: true },
    intents: [
      { intent: 'fast-cheap', rank: 3 },
      { intent: 'huge-context', rank: 3 },
    ],
  },

  // -----------------------------------------------------------------
  // DeepSeek native API
  // -----------------------------------------------------------------
  {
    provider: 'deepseek',
    model: 'deepseek-reasoner',
    contextWindow: 64_000,
    pricePer1MIn: 0.55,
    pricePer1MOut: 2.19,
    capabilities: { reasoning: true },
    intents: [{ intent: 'deep-reasoning', rank: 4 }],
  },
  {
    provider: 'deepseek',
    model: 'deepseek-chat',
    contextWindow: 128_000,
    pricePer1MIn: 0.27,
    pricePer1MOut: 1.1,
    intents: [
      { intent: 'fast-cheap', rank: 3 },
      { intent: 'balanced-agent', rank: 5 },
    ],
  },

  // -----------------------------------------------------------------
  // Groq native API
  // -----------------------------------------------------------------
  {
    provider: 'groq',
    model: 'llama-3.3-70b-versatile',
    contextWindow: 128_000,
    intents: [
      { intent: 'fast-cheap', rank: 4 },
      { intent: 'balanced-agent', rank: 5 },
    ],
  },

  // -----------------------------------------------------------------
  // OpenRouter (aggregator) - rank these slightly worse than native
  // APIs for the same backing model so we prefer native when keys
  // are configured for both. The aggregator's job is to be the
  // catch-all when the user only set up an OpenRouter key.
  // -----------------------------------------------------------------
  {
    provider: 'openrouter',
    model: 'openai/gpt-5',
    contextWindow: 400_000,
    capabilities: { reasoning: true, tooluse: true },
    intents: [{ intent: 'deep-reasoning', rank: 3 }],
  },
  {
    provider: 'openrouter',
    model: 'anthropic/claude-opus-4-5',
    contextWindow: 200_000,
    capabilities: { tooluse: true },
    intents: [{ intent: 'multi-file', rank: 2 }],
  },
  {
    provider: 'openrouter',
    model: 'anthropic/claude-sonnet-4-5',
    contextWindow: 200_000,
    capabilities: { tooluse: true },
    intents: [{ intent: 'balanced-agent', rank: 2 }],
  },
  {
    provider: 'openrouter',
    model: 'google/gemini-2.5-pro',
    contextWindow: 2_000_000,
    capabilities: { longContext: true, tooluse: true },
    intents: [{ intent: 'huge-context', rank: 2 }],
  },
];
