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
  type Objective,
  type QualityTier,
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

  const sorted = [...pool].sort((a, b) => {
    if (objective === 'cost') {
      const pa = totalPrice(a.c);
      const pb = totalPrice(b.c);
      if (pa !== pb) return pa - pb;
      if (b.q !== a.q) return b.q - a.q;
    } else {
      if (b.q !== a.q) return b.q - a.q;
      const pa = totalPrice(a.c);
      const pb = totalPrice(b.c);
      if (pa !== pb) return pa - pb;
    }
    return b.c.contextWindow - a.c.contextWindow;
  });

  return sorted.map(({ c, q }) => ({
    candidate: c,
    quality: q,
    tier: tierForCoding(q),
    belowFloor,
    rationale: buildRationale(c, q, objective, belowFloor, k),
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
): string {
  const tier = tierForCoding(q);
  const price = totalPrice(c).toFixed(2);
  const parts = [`${tier} coding=${Math.round(q)}`];
  const caps: string[] = [];
  if (k.requireTools) caps.push('tools');
  if (k.requireVision) caps.push('vision');
  if (caps.length) parts.push(`met ${caps.join('+')}`);
  parts.push(objective === 'cost' ? `cheapest>=floor $${price}/1M` : `top quality $${price}/1M`);
  if (belowFloor) parts.push('(below floor: best available)');
  return parts.join(', ');
}
