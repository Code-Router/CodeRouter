/**
 * Per-intent scoring for the smart router.
 *
 * Each candidate model is reduced to four normalized features in [0,1]:
 *   - quality   : family/tier prior (see quality.ts)
 *   - cheapness : 1 for free, → 0 as price climbs (smooth, anchored)
 *   - context   : context window normalized against a 256k ceiling
 *   - reasoning : 1 if the model is a reasoning model, else 0
 *
 * An intent applies a weight vector over those features. The weights
 * encode policy ("for huge-context, context dominates; for fast-cheap,
 * price dominates") and are the main knob to tune as results come in.
 */

import type { Intent } from '../../catalog/types.js';
import { isReasoningModel, qualityPrior, qualityTier } from './quality.js';

export type ScoreInput = {
  id: string;
  pricePer1MIn: number;
  pricePer1MOut: number;
  contextWindow: number;
  supportedParameters?: string[];
};

export type ScoreBreakdown = {
  quality: number;
  cheapness: number;
  context: number;
  reasoning: number;
};

/**
 * Price anchor (USD per 1M, prompt+completion summed). A model whose
 * combined price equals the anchor scores 0.5 on cheapness; cheaper
 * models trend toward 1, pricier toward 0.
 */
const PRICE_ANCHOR = 8;
const CONTEXT_FLOOR = 8_000;
const CONTEXT_CEIL = 256_000;

type Weights = Record<keyof ScoreBreakdown, number>;

/**
 * Intent → feature weights. Each row sums to ~1 so raw scores stay in a
 * comparable [0,1]-ish range across intents.
 */
const WEIGHTS: Record<Intent, Weights> = {
  // Default daily driver: quality-led but genuinely cost-aware.
  'balanced-agent': { quality: 0.55, cheapness: 0.3, context: 0.05, reasoning: 0.1 },
  // Big refactors: quality + headroom matter, price barely.
  'multi-file': { quality: 0.6, cheapness: 0.05, context: 0.2, reasoning: 0.15 },
  // Hard thinking: reasoning capability + quality, price last.
  'deep-reasoning': { quality: 0.5, cheapness: 0.1, context: 0.1, reasoning: 0.3 },
  // Long inputs: context window dominates.
  'huge-context': { quality: 0.3, cheapness: 0.1, context: 0.6, reasoning: 0 },
  // Trivial / throwaway: price dominates, but keep a floor on quality.
  'fast-cheap': { quality: 0.25, cheapness: 0.7, context: 0.05, reasoning: 0 },
  // Not served by OpenRouter; weights present for completeness.
  'local-offline': { quality: 0.5, cheapness: 0.4, context: 0.1, reasoning: 0 },
};

export function cheapness(pricePer1MIn: number, pricePer1MOut: number): number {
  const cost = Math.max(0, pricePer1MIn) + Math.max(0, pricePer1MOut);
  return PRICE_ANCHOR / (PRICE_ANCHOR + cost);
}

export function contextScore(contextWindow: number): number {
  if (!Number.isFinite(contextWindow) || contextWindow <= CONTEXT_FLOOR) return 0;
  const span = CONTEXT_CEIL - CONTEXT_FLOOR;
  return Math.min(1, (contextWindow - CONTEXT_FLOOR) / span);
}

export function breakdown(m: ScoreInput): ScoreBreakdown {
  return {
    quality: qualityPrior(m.id),
    cheapness: cheapness(m.pricePer1MIn, m.pricePer1MOut),
    context: contextScore(m.contextWindow),
    reasoning: isReasoningModel(m.id, m.supportedParameters) ? 1 : 0,
  };
}

export function scoreFor(m: ScoreInput, intent: Intent): number {
  const w = WEIGHTS[intent];
  const b = breakdown(m);
  return (
    w.quality * b.quality +
    w.cheapness * b.cheapness +
    w.context * b.context +
    w.reasoning * b.reasoning
  );
}

/** Human-readable one-liner explaining a model's selection. */
export function explain(m: ScoreInput, intent: Intent, score: number): string {
  const price = (m.pricePer1MIn + m.pricePer1MOut).toFixed(2);
  const ctxK = Math.round(m.contextWindow / 1000);
  return `smart:${intent} ${qualityTier(m.id)} score=${score.toFixed(3)} $${price}/1M ctx=${ctxK}k`;
}
