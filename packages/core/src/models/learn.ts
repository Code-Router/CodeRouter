/**
 * Hybrid refinement of benchmark priors with local outcomes.
 *
 * The curated `coding` scores in `cards.ts` are static priors. Over time
 * we observe how each model actually performs *on this user's repos*
 * (run success/failure + thumbs up/down) and nudge the prior up or down.
 *
 * Design constraints (so this never goes haywire on thin data):
 *   - Shrinkage: the delta is weighted by `n / (n + K)`, so a model with
 *     2 runs barely moves while one with 50 runs moves close to its
 *     observed signal.
 *   - Hard sample floor: below `minSamples` we apply zero delta.
 *   - Bounded: the absolute delta is clamped to `maxDelta` coding points,
 *     so local noise can re-rank near-ties but can never turn a small
 *     model into a frontier one (or vice-versa).
 *
 * Pure + deterministic: feed it observations, get back a `model id ->
 * delta` map. The router adds the delta to the prior at selection time.
 */

export type ModelObservation = {
  /** Wire-level model id from the run's route. */
  model: string;
  /** Whether the run succeeded (status === 'success'). */
  success: boolean;
  /** User rating: +1 / -1, or null when unrated. */
  rating: number | null;
};

export type LearnOptions = {
  /** Minimum samples before any delta is applied. Default 3. */
  minSamples?: number;
  /** Shrinkage constant: weight = n / (n + K). Default 8. */
  shrinkageK?: number;
  /** Max absolute delta in coding points. Default 12. */
  maxDelta?: number;
  /** Success rate treated as "neutral" (no signal). Default 0.6. */
  baselineSuccess?: number;
};

type Agg = { n: number; success: number; ratingSum: number; ratingCount: number };

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Build a `model id -> coding-score delta` map from local observations.
 * Models with too few samples are omitted (no entry == zero delta).
 */
export function computeQualityBias(
  observations: ModelObservation[],
  opts: LearnOptions = {},
): Map<string, number> {
  const minSamples = opts.minSamples ?? 3;
  const K = opts.shrinkageK ?? 8;
  const maxDelta = opts.maxDelta ?? 12;
  const baseline = opts.baselineSuccess ?? 0.6;

  const byModel = new Map<string, Agg>();
  for (const o of observations) {
    if (!o.model) continue;
    const a = byModel.get(o.model) ?? { n: 0, success: 0, ratingSum: 0, ratingCount: 0 };
    a.n += 1;
    if (o.success) a.success += 1;
    if (typeof o.rating === 'number' && o.rating !== 0) {
      a.ratingSum += clamp(o.rating, -1, 1);
      a.ratingCount += 1;
    }
    byModel.set(o.model, a);
  }

  const out = new Map<string, number>();
  for (const [model, a] of byModel) {
    if (a.n < minSamples) continue;
    const successRate = a.success / a.n;
    // Success signal: deviation from baseline, in [-baseline, 1-baseline]
    // scaled to roughly [-1, 1].
    const successSignal = clamp((successRate - baseline) / (1 - baseline), -1, 1);
    // Rating signal in [-1, 1].
    const ratingSignal = a.ratingCount > 0 ? clamp(a.ratingSum / a.ratingCount, -1, 1) : 0;
    // Blend: ratings are a stronger signal when present.
    const signal =
      a.ratingCount > 0 ? 0.5 * successSignal + 0.5 * ratingSignal : successSignal;
    const shrink = a.n / (a.n + K);
    const delta = clamp(signal * shrink * maxDelta, -maxDelta, maxDelta);
    if (Math.abs(delta) < 0.5) continue;
    out.set(model, delta);
  }
  return out;
}

/** Convenience: derive observations from run records (routes + status + rating). */
export function observationsFromRuns(
  runs: { routes: { model: string }[]; status: string; rating: number | null }[],
): ModelObservation[] {
  const obs: ModelObservation[] = [];
  for (const r of runs) {
    const success = r.status === 'success';
    for (const rt of r.routes) {
      if (!rt.model) continue;
      obs.push({ model: rt.model, success, rating: r.rating });
    }
  }
  return obs;
}
