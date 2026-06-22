/**
 * Quality tiers + per-intent selection policy.
 *
 * The router is quality-first: for real coding work it ranks candidates
 * by a benchmark-grounded coding score and lets cost only break ties.
 * Cost becomes the primary objective only for explicitly trivial work.
 *
 * A model's `coding` score lives in [0,100] (see `cards.ts`). Tiers are
 * coarse bands over that score, used for the per-task quality *floor*
 * (the minimum we'll accept before falling back) and for UI labels.
 */

import type { Intent } from '../catalog/types.js';
import type { Classification, Effort } from '../types.js';

export type QualityTier = 'frontier' | 'strong' | 'mid' | 'small';

/** Lower bound (inclusive) of each tier on the 0-100 coding scale. */
export const TIER_MIN: Record<QualityTier, number> = {
  frontier: 80,
  strong: 65,
  mid: 45,
  small: 0,
};

/** Order used when comparing tiers (higher index = better). */
export const TIER_ORDER: QualityTier[] = ['small', 'mid', 'strong', 'frontier'];

/** Map a 0-100 coding score to its coarse tier. */
export function tierForCoding(coding: number): QualityTier {
  if (coding >= TIER_MIN.frontier) return 'frontier';
  if (coding >= TIER_MIN.strong) return 'strong';
  if (coding >= TIER_MIN.mid) return 'mid';
  return 'small';
}

/** Minimum coding score required to clear a given floor tier. */
export function floorScore(tier: QualityTier): number {
  return TIER_MIN[tier];
}

/**
 * Selection objective:
 *   - `quality`: rank by coding score, cost only breaks ties (default).
 *   - `cost`: cheapest model that still clears the quality floor.
 */
export type Objective = 'quality' | 'cost';

export type IntentDefaults = {
  /** Minimum coding tier we want before falling back to "best available". */
  floor: QualityTier;
  objective: Objective;
  /** Minimum context window in tokens. */
  minContextWindow: number;
};

/**
 * Per-intent defaults. Real coding work is quality-first with a high
 * floor (frontier-by-default falls out naturally: quality ranking picks
 * the best eligible model). Only `fast-cheap` / `local-offline` flip to
 * a cost objective for genuinely trivial tasks.
 */
export const INTENT_DEFAULTS: Record<Intent, IntentDefaults> = {
  'deep-reasoning': { floor: 'frontier', objective: 'quality', minContextWindow: 16_000 },
  'multi-file': { floor: 'frontier', objective: 'quality', minContextWindow: 60_000 },
  'balanced-agent': { floor: 'strong', objective: 'quality', minContextWindow: 16_000 },
  'huge-context': { floor: 'strong', objective: 'quality', minContextWindow: 200_000 },
  'fast-cheap': { floor: 'mid', objective: 'cost', minContextWindow: 8_000 },
  'local-offline': { floor: 'small', objective: 'cost', minContextWindow: 0 },
};

/**
 * Quality floor for a task, given its classification + effort. Real work
 * leans frontier; trivial/docs allow cheaper. Higher effort raises the
 * floor so "high"/"max" runs never quietly drop to a mid model.
 */
export function taskFloor(classification: Classification, effort: Effort): QualityTier {
  const { taskType } = classification;
  if (taskType === 'trivial' || taskType === 'docs') return 'mid';
  if (effort === 'high' || effort === 'max') return 'frontier';
  return 'strong';
}
