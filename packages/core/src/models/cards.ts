/**
 * Curated model catalog with capability tags + quality scores.
 *
 * This is the single source of truth for "what is this model and how
 * good is it at writing code". Unlike the name-regex heuristic it
 * replaces, every score here is a benchmark-grounded *prior* anchored to
 * public results (SWE-bench Verified, Aider polyglot, LMArena coding
 * Elo). Priors are deliberately conservative and are refined at runtime
 * by local outcomes (see `learn.ts`).
 *
 * Scores are on a 0-100 scale where ~90+ = current frontier coding
 * models, ~65-79 = strong daily drivers, ~45-64 = mid, <45 = small/weak.
 * They encode *relative* strength, not an absolute benchmark percentage.
 *
 * To refresh: re-read the latest SWE-bench Verified / Aider polyglot
 * leaderboards and nudge `coding`/`reasoning`; add new frontier models
 * with explicit `aliases` for every provider-native id. Do NOT widen
 * aliases to fuzzy patterns - unknown ids must fall through to the
 * conservative prior in `resolve.ts` so an unverified small model can
 * never masquerade as a frontier one.
 */

import { type QualityTier, tierForCoding } from './tiers.js';

export type Modality = 'text' | 'image' | 'audio' | 'video';

export type ModelCard = {
  /** Canonical id (OpenRouter "vendor/model" style where possible). */
  id: string;
  /**
   * Every other id that resolves to this card: provider-native model
   * ids, local-CLI aliases (`opus`, `sonnet`, `gpt-5-codex`), and the
   * OpenRouter slug. Matched case-insensitively, exact-string only.
   */
  aliases: string[];
  family: string;
  /** Input modalities the model accepts. */
  inputs: Modality[];
  /** Reliable tool / function calling. */
  tools: boolean;
  /** Reasoning ("thinking") model. */
  reasoning: boolean;
  /** Max context window in tokens. */
  contextWindow: number;
  /** Benchmark-grounded priors in [0,100]. `coding` is the primary key. */
  quality: { coding: number; reasoning: number };
  /** Advisory price (USD per 1M); live OpenRouter price overrides at resolve time. */
  pricePer1MIn?: number;
  pricePer1MOut?: number;
  /** Provenance notes for the score. */
  sources?: string[];
};

const TEXT: Modality[] = ['text'];
const VISION: Modality[] = ['text', 'image'];

/**
 * Curated frontier + strong + representative cheap models. Everything
 * not listed here resolves to a conservative prior (see `resolve.ts`).
 */
export const MODEL_CARDS: ModelCard[] = [
  // ---- Anthropic Claude --------------------------------------------
  {
    id: 'anthropic/claude-opus-4-5',
    aliases: ['claude-opus-4-5', 'claude-opus-4.5', 'opus', 'claude-opus-latest', '~anthropic/claude-opus-latest'],
    family: 'claude',
    inputs: VISION,
    tools: true,
    reasoning: true,
    contextWindow: 200_000,
    quality: { coding: 93, reasoning: 93 },
    pricePer1MIn: 15,
    pricePer1MOut: 75,
    sources: ['SWE-bench Verified top tier', 'Aider polyglot top tier'],
  },
  {
    id: 'anthropic/claude-sonnet-4-5',
    aliases: ['claude-sonnet-4-5', 'claude-sonnet-4.5', 'sonnet', 'claude-sonnet-latest', '~anthropic/claude-sonnet-latest'],
    family: 'claude',
    inputs: VISION,
    tools: true,
    reasoning: true,
    contextWindow: 200_000,
    quality: { coding: 88, reasoning: 86 },
    pricePer1MIn: 3,
    pricePer1MOut: 15,
    sources: ['SWE-bench Verified frontier', 'strong agentic coder'],
  },
  {
    id: 'anthropic/claude-3-5-haiku',
    aliases: ['claude-3-5-haiku-latest', 'claude-3.5-haiku', 'haiku', 'anthropic/claude-3.5-haiku'],
    family: 'claude',
    inputs: VISION,
    tools: true,
    reasoning: false,
    contextWindow: 200_000,
    quality: { coding: 52, reasoning: 48 },
    pricePer1MIn: 0.8,
    pricePer1MOut: 4,
    sources: ['fast/cheap tier'],
  },

  // ---- OpenAI GPT ---------------------------------------------------
  {
    id: 'openai/gpt-5',
    aliases: ['gpt-5'],
    family: 'gpt',
    inputs: VISION,
    tools: true,
    reasoning: true,
    contextWindow: 400_000,
    quality: { coding: 90, reasoning: 92 },
    pricePer1MIn: 5,
    pricePer1MOut: 15,
    sources: ['frontier reasoning + coding'],
  },
  {
    id: 'openai/gpt-5.5',
    aliases: ['gpt-5.5'],
    family: 'gpt',
    inputs: VISION,
    tools: true,
    reasoning: true,
    contextWindow: 400_000,
    quality: { coding: 91, reasoning: 92 },
    pricePer1MIn: 5,
    pricePer1MOut: 15,
    sources: ['frontier reasoning + coding'],
  },
  {
    // Codex CLI's default; treated as a GPT-5-class coding model.
    id: 'openai/gpt-5-codex',
    aliases: ['gpt-5-codex'],
    family: 'gpt',
    inputs: TEXT,
    tools: true,
    reasoning: true,
    contextWindow: 400_000,
    quality: { coding: 91, reasoning: 90 },
    sources: ['Codex coding-specialized GPT-5'],
  },
  {
    id: 'openai/gpt-5-mini',
    aliases: ['gpt-5-mini'],
    family: 'gpt',
    inputs: VISION,
    tools: true,
    reasoning: false,
    contextWindow: 400_000,
    quality: { coding: 66, reasoning: 62 },
    pricePer1MIn: 0.25,
    pricePer1MOut: 2,
    sources: ['cheaper GPT-5 variant'],
  },
  {
    id: 'openai/gpt-4.1',
    aliases: ['gpt-4.1'],
    family: 'gpt',
    inputs: VISION,
    tools: true,
    reasoning: false,
    contextWindow: 1_000_000,
    quality: { coding: 72, reasoning: 68 },
    pricePer1MIn: 2,
    pricePer1MOut: 8,
    sources: ['long-context strong coder'],
  },
  {
    id: 'openai/gpt-4o',
    aliases: ['gpt-4o'],
    family: 'gpt',
    inputs: VISION,
    tools: true,
    reasoning: false,
    contextWindow: 128_000,
    quality: { coding: 67, reasoning: 64 },
    pricePer1MIn: 2.5,
    pricePer1MOut: 10,
    sources: ['strong daily driver'],
  },
  {
    id: 'openai/gpt-4o-mini',
    aliases: ['gpt-4o-mini'],
    family: 'gpt',
    inputs: VISION,
    tools: true,
    reasoning: false,
    contextWindow: 128_000,
    quality: { coding: 48, reasoning: 44 },
    pricePer1MIn: 0.15,
    pricePer1MOut: 0.6,
    sources: ['fast/cheap tier'],
  },

  // ---- Google Gemini ------------------------------------------------
  {
    id: 'google/gemini-2.5-pro',
    aliases: ['gemini-2.5-pro'],
    family: 'gemini',
    inputs: VISION,
    tools: true,
    reasoning: true,
    contextWindow: 2_000_000,
    quality: { coding: 84, reasoning: 86 },
    pricePer1MIn: 1.25,
    pricePer1MOut: 10,
    sources: ['frontier, huge context'],
  },
  {
    id: 'google/gemini-2.5-flash',
    aliases: ['gemini-2.5-flash'],
    family: 'gemini',
    inputs: VISION,
    tools: true,
    reasoning: false,
    contextWindow: 1_000_000,
    quality: { coding: 70, reasoning: 66 },
    pricePer1MIn: 0.075,
    pricePer1MOut: 0.3,
    sources: ['strong, cheap, long context'],
  },

  // ---- DeepSeek -----------------------------------------------------
  {
    id: 'deepseek/deepseek-r1',
    aliases: ['deepseek-reasoner', 'deepseek/deepseek-reasoner', 'deepseek-r1'],
    family: 'deepseek',
    inputs: TEXT,
    tools: false,
    reasoning: true,
    contextWindow: 64_000,
    quality: { coding: 80, reasoning: 88 },
    pricePer1MIn: 0.55,
    pricePer1MOut: 2.19,
    sources: ['open frontier reasoner'],
  },
  {
    id: 'deepseek/deepseek-chat',
    aliases: ['deepseek-chat', 'deepseek-v3', 'deepseek/deepseek-v3'],
    family: 'deepseek',
    inputs: TEXT,
    tools: true,
    reasoning: false,
    contextWindow: 128_000,
    quality: { coding: 70, reasoning: 64 },
    pricePer1MIn: 0.27,
    pricePer1MOut: 1.1,
    sources: ['strong open model, cheap'],
  },

  // ---- Qwen (large coders only; small variants stay conservative) --
  {
    id: 'qwen/qwen3-coder',
    aliases: ['qwen/qwen3-coder', 'qwen3-coder'],
    family: 'qwen',
    inputs: TEXT,
    tools: true,
    reasoning: false,
    contextWindow: 256_000,
    quality: { coding: 72, reasoning: 66 },
    sources: ['large open coding model'],
  },
  {
    id: 'qwen/qwen-2.5-coder-32b-instruct',
    aliases: ['qwen/qwen-2.5-coder-32b-instruct', 'qwen2.5-coder-32b'],
    family: 'qwen',
    inputs: TEXT,
    tools: true,
    reasoning: false,
    contextWindow: 128_000,
    quality: { coding: 64, reasoning: 56 },
    sources: ['32B open coder'],
  },

  // ---- xAI ----------------------------------------------------------
  {
    id: 'x-ai/grok-4',
    aliases: ['x-ai/grok-4', 'grok-4'],
    family: 'grok',
    inputs: VISION,
    tools: true,
    reasoning: true,
    contextWindow: 256_000,
    quality: { coding: 82, reasoning: 84 },
    sources: ['frontier reasoner'],
  },

  // ---- Meta Llama (large) ------------------------------------------
  {
    id: 'meta-llama/llama-3.3-70b-instruct',
    aliases: ['llama-3.3-70b-versatile', 'meta-llama/llama-3.3-70b-instruct', 'llama-3.3-70b'],
    family: 'llama',
    inputs: TEXT,
    tools: true,
    reasoning: false,
    contextWindow: 128_000,
    quality: { coding: 58, reasoning: 54 },
    sources: ['mid open model'],
  },

  // ---- Local Ollama defaults ---------------------------------------
  {
    id: 'ollama/qwen2.5-coder:7b',
    aliases: ['qwen2.5-coder:7b'],
    family: 'qwen',
    inputs: TEXT,
    tools: false,
    reasoning: false,
    contextWindow: 32_000,
    quality: { coding: 42, reasoning: 36 },
    sources: ['local 7B coder'],
  },
  {
    id: 'ollama/llama3.2',
    aliases: ['llama3.2'],
    family: 'llama',
    inputs: TEXT,
    tools: false,
    reasoning: false,
    contextWindow: 128_000,
    quality: { coding: 30, reasoning: 28 },
    sources: ['local small model'],
  },
];

// ---- alias index --------------------------------------------------

const ALIAS_INDEX: Map<string, ModelCard> = (() => {
  const m = new Map<string, ModelCard>();
  for (const card of MODEL_CARDS) {
    m.set(card.id.toLowerCase(), card);
    for (const a of card.aliases) m.set(a.toLowerCase(), card);
  }
  return m;
})();

/** Exact (case-insensitive) lookup of a curated card by id or alias. */
export function findCard(id: string): ModelCard | null {
  return ALIAS_INDEX.get(id.trim().toLowerCase()) ?? null;
}

/** Coarse tier of a card from its coding score. */
export function cardTier(card: ModelCard): QualityTier {
  return tierForCoding(card.quality.coding);
}
