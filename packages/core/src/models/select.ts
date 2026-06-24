/**
 * Quality-first model selector.
 *
 * Given a set of routable candidates (each a provider+model with a
 * resolved `ModelCard`), pick the best one for the task:
 *
 *   1. filter by required capabilities (tools, vision) + min context.
 *   2. keep candidates whose effective coding score clears the quality
 *      floor; if none do, fall back to the best available and flag it.
 *   3. rank:
 *        - objective `quality`: coding score desc, then cost asc.
 *        - objective `cost`:    cost asc among floor-clearing models,
 *                               then coding score desc.
 *
 * "Effective" coding = benchmark prior + a bounded local-learning delta
 * (see `learn.ts`). This is what makes an unverified small model unable
 * to outrank a known frontier model purely because it's cheap.
 */

import type { ProviderId } from '../types.js';
import { type ModelCard } from './cards.js';
import {
  DEFAULT_VALUE_WEIGHTS,
  type Objective,
  type QualityTier,
  type ValueWeights,
  floorScore,
  tierForCoding,
} from './tiers.js';

export type Candidate = {
  /** Registry provider name (drives readiness + the `via` field). */
  via: string;
  /** Adapter kind for the resulting `RouteRef.provider`. */
  adapter: ProviderId;
  /** Wire-level model id sent to the provider. */
  model: string;
  card: ModelCard;
  pricePer1MIn: number;
  pricePer1MOut: number;
  contextWindow: number;
};

export type SelectConstraints = {
  requireTools?: boolean;
  requireVision?: boolean;
  minContextWindow?: number;
  /** Minimum quality tier; candidates below it are only used as fallback. */
  floor?: QualityTier;
  objective?: Objective;
  /** model id -> bounded coding-score delta from local outcomes. */
  qualityBias?: Map<string, number>;
  /**
   * Feature weights for the `value` objective. Ignored for `quality` /
   * `cost`. Defaults to a balanced vector when omitted.
   */
  weights?: ValueWeights;
  /**
   * model id -> speed-prior adjustment in [-0.25,0.25] learned from observed
   * run latencies (learn.ts). Refines the static speed feature of the
   * `value` objective; ignored otherwise.
   */
  latencyBias?: Map<string, number>;
};

export type Selection = {
  candidate: Candidate;
  /** Effective coding score used for ranking. */
  quality: number;
  tier: QualityTier;
  /** True when nothing cleared the floor and we fell back to best-available. */
  belowFloor: boolean;
  rationale: string;
};

function effectiveCoding(c: Candidate, bias?: Map<string, number>): number {
  const base = c.card.quality.coding;
  if (!bias) return base;
  const delta = bias.get(c.card.id) ?? bias.get(c.model) ?? 0;
  return Math.max(0, Math.min(100, base + delta));
}

function meetsCaps(c: Candidate, k: SelectConstraints): boolean {
  if (k.requireTools && !c.card.tools) return false;
  if (k.requireVision && !c.card.inputs.includes('image')) return false;
  if (k.minContextWindow !== undefined && c.contextWindow > 0 && c.contextWindow < k.minContextWindow) {
    return false;
  }
  return true;
}

function totalPrice(c: Candidate): number {
  return Math.max(0, c.pricePer1MIn) + Math.max(0, c.pricePer1MOut);
}

/**
 * Price anchor (USD per 1M, prompt+completion summed). A model whose
 * combined price equals the anchor scores 0.5 on cheapness; cheaper models
 * trend toward 1, pricier toward 0. This is the knob that lets a cheap
 * strong model out-value a pricey frontier one.
 */
const PRICE_ANCHOR = 8;
const CONTEXT_FLOOR = 8_000;
const CONTEXT_CEIL = 256_000;

function cheapness(c: Candidate): number {
  const cost = totalPrice(c);
  return PRICE_ANCHOR / (PRICE_ANCHOR + cost);
}

function contextScore(contextWindow: number): number {
  if (!Number.isFinite(contextWindow) || contextWindow <= CONTEXT_FLOOR) return 0;
  return Math.min(1, (contextWindow - CONTEXT_FLOOR) / (CONTEXT_CEIL - CONTEXT_FLOOR));
}

/**
 * Speed prior in [0,1]. We have no measured latency at selection time, so
 * approximate: non-reasoning models answer faster than "thinking" ones, and
 * cheaper (smaller) models are generally quicker. Phase 2 refines this with
 * observed `durationMs` from real runs.
 */
function speedPrior(c: Candidate, latencyAdj = 0): number {
  const base = c.card.reasoning ? 0.35 : 0.85;
  return clamp(0.6 * base + 0.4 * cheapness(c) + latencyAdj, 0, 1);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Normalized weighted value score in roughly [0,1]. */
function valueScore(c: Candidate, q: number, w: ValueWeights, latencyAdj: number): number {
  return (
    w.quality * (q / 100) +
    w.cheapness * cheapness(c) +
    w.speed * speedPrior(c, latencyAdj) +
    w.context * contextScore(c.contextWindow) +
    w.reasoning * (c.card.reasoning ? 1 : 0)
  );
}

function latencyAdjFor(c: Candidate, latencyBias?: Map<string, number>): number {
  if (!latencyBias) return 0;
  return latencyBias.get(c.card.id) ?? latencyBias.get(c.model) ?? 0;
}

/** Rank candidates best-first. Returns [] when none meet the hard caps. */
export function selectModels(
  candidates: Candidate[],
  k: SelectConstraints = {},
): Selection[] {
  const objective: Objective = k.objective ?? 'quality';
  const bias = k.qualityBias;

  const capable = candidates.filter((c) => meetsCaps(c, k));
  if (capable.length === 0) return [];

  const withQuality = capable.map((c) => ({ c, q: effectiveCoding(c, bias) }));

  const floor = k.floor ? floorScore(k.floor) : 0;
  const clearing = withQuality.filter((x) => x.q >= floor);
  const belowFloor = clearing.length === 0;
  const pool = belowFloor ? withQuality : clearing;

  const weights = k.weights ?? DEFAULT_VALUE_WEIGHTS;
  const scored = pool.map((x) => ({
    ...x,
    v: objective === 'value' ? valueScore(x.c, x.q, weights, latencyAdjFor(x.c, k.latencyBias)) : 0,
  }));

  const sorted = scored.sort((a, b) => {
    if (objective === 'cost') {
      const pa = totalPrice(a.c);
      const pb = totalPrice(b.c);
      if (pa !== pb) return pa - pb;
      if (b.q !== a.q) return b.q - a.q;
    } else if (objective === 'value') {
      // Quality-per-dollar-per-second: highest composite value first, then
      // fall back to raw quality, then price, to break exact ties.
      if (b.v !== a.v) return b.v - a.v;
      if (b.q !== a.q) return b.q - a.q;
      const pa = totalPrice(a.c);
      const pb = totalPrice(b.c);
      if (pa !== pb) return pa - pb;
    } else {
      if (b.q !== a.q) return b.q - a.q;
      const pa = totalPrice(a.c);
      const pb = totalPrice(b.c);
      if (pa !== pb) return pa - pb;
    }
    return b.c.contextWindow - a.c.contextWindow;
  });

  return sorted.map(({ c, q, v }) => ({
    candidate: c,
    quality: q,
    tier: tierForCoding(q),
    belowFloor,
    rationale: buildRationale(c, q, objective, belowFloor, k, v),
  }));
}

/** Best candidate, or null when none meet the hard caps. */
export function selectBest(
  candidates: Candidate[],
  k: SelectConstraints = {},
): Selection | null {
  return selectModels(candidates, k)[0] ?? null;
}

function buildRationale(
  c: Candidate,
  q: number,
  objective: Objective,
  belowFloor: boolean,
  k: SelectConstraints,
  value?: number,
): string {
  const tier = tierForCoding(q);
  const price = totalPrice(c).toFixed(2);
  const parts = [`${tier} coding=${Math.round(q)}`];
  const caps: string[] = [];
  if (k.requireTools) caps.push('tools');
  if (k.requireVision) caps.push('vision');
  if (caps.length) parts.push(`met ${caps.join('+')}`);
  if (objective === 'cost') {
    parts.push(`cheapest>=floor $${price}/1M`);
  } else if (objective === 'value') {
    parts.push(`best value=${(value ?? 0).toFixed(2)} $${price}/1M`);
  } else {
    parts.push(`top quality $${price}/1M`);
  }
  if (belowFloor) parts.push('(below floor: best available)');
  return parts.join(', ');
}
