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

// ---- latency learning ---------------------------------------------

export type LatencyObservation = {
  /** Wire-level model id from the run's route. */
  model: string;
  /** Wall-clock duration of the run, ms. */
  durationMs: number;
  /** Output tokens produced (used to normalize duration into ms/token). */
  tokensOut: number;
};

export type LatencyOptions = {
  /** Minimum samples before any adjustment is applied. Default 3. */
  minSamples?: number;
  /** Shrinkage constant: weight = n / (n + K). Default 8. */
  shrinkageK?: number;
  /** Max absolute speed-prior adjustment, in [0,1] units. Default 0.25. */
  maxAdjust?: number;
};

/**
 * Build a `model id -> speed-prior adjustment` map from observed run
 * latencies. The selector's `speed` feature is a static prior (cheap +
 * non-reasoning == fast); this refines it with how the model *actually*
 * performs on this machine/network.
 *
 * We normalize each model's mean ms-per-output-token against the population
 * median, so a model that is faster-than-typical gets a positive nudge and a
 * sluggish one a negative nudge. Same guard rails as `computeQualityBias`:
 * a hard sample floor, shrinkage on thin data, and a bounded adjustment.
 */
export function computeLatencyBias(
  observations: LatencyObservation[],
  opts: LatencyOptions = {},
): Map<string, number> {
  const minSamples = opts.minSamples ?? 3;
  const K = opts.shrinkageK ?? 8;
  const maxAdjust = opts.maxAdjust ?? 0.25;

  const agg = new Map<string, { n: number; sumMsPerTok: number }>();
  for (const o of observations) {
    if (!o.model || o.durationMs <= 0) continue;
    const msPerTok = o.durationMs / Math.max(1, o.tokensOut);
    const a = agg.get(o.model) ?? { n: 0, sumMsPerTok: 0 };
    a.n += 1;
    a.sumMsPerTok += msPerTok;
    agg.set(o.model, a);
  }

  const means: { model: string; n: number; mpt: number }[] = [];
  for (const [model, a] of agg) means.push({ model, n: a.n, mpt: a.sumMsPerTok / a.n });
  if (means.length === 0) return new Map();

  const sorted = means.map((m) => m.mpt).sort((x, y) => x - y);
  const baseline = sorted[Math.floor(sorted.length / 2)] || 1;

  const out = new Map<string, number>();
  for (const m of means) {
    if (m.n < minSamples) continue;
    // Faster than baseline (lower ms/token) -> positive adjustment.
    const signal = clamp((baseline - m.mpt) / baseline, -1, 1);
    const shrink = m.n / (m.n + K);
    const adj = clamp(signal * shrink * maxAdjust, -maxAdjust, maxAdjust);
    if (Math.abs(adj) < 0.01) continue;
    out.set(m.model, adj);
  }
  return out;
}

/** Convenience: derive latency observations from run records. */
export function latencyObservationsFromRuns(
  runs: { routes: { model: string }[]; durationMs: number; tokensOut: number }[],
): LatencyObservation[] {
  const obs: LatencyObservation[] = [];
  for (const r of runs) {
    if (!r.durationMs) continue;
    for (const rt of r.routes) {
      if (!rt.model) continue;
      obs.push({ model: rt.model, durationMs: r.durationMs, tokensOut: r.tokensOut });
    }
  }
  return obs;
}

// ---- per-task-class preference learning (local RouteLLM-style) ----

export type PolicyObservation = ModelObservation & {
  /** Task class this observation belongs to (we key on taskType). */
  taskClass: string;
};

/**
 * Learn which models win *per task class* from local run outcomes - a
 * lightweight, offline take on RouteLLM's preference learning. Returns a
 * nested map `taskClass -> (model -> coding-score delta)`; the router folds
 * the sub-map for the current task into the value selector's quality bias,
 * so a model that reliably succeeds on (say) refactors gets nudged up for
 * refactors specifically, without affecting unrelated task classes.
 *
 * Cost is intentionally NOT folded in here: the value selector already
 * weighs cheapness first-class, so this stays a pure outcome signal and
 * reuses `computeQualityBias`'s bounded, shrinkage-weighted math per group.
 */
export function computePolicyPreference(
  observations: PolicyObservation[],
  opts: LearnOptions = {},
): Map<string, Map<string, number>> {
  const byClass = new Map<string, ModelObservation[]>();
  for (const o of observations) {
    if (!o.taskClass || !o.model) continue;
    const list = byClass.get(o.taskClass) ?? [];
    list.push({ model: o.model, success: o.success, rating: o.rating });
    byClass.set(o.taskClass, list);
  }
  const out = new Map<string, Map<string, number>>();
  for (const [taskClass, obs] of byClass) {
    const bias = computeQualityBias(obs, opts);
    if (bias.size > 0) out.set(taskClass, bias);
  }
  return out;
}

/** Convenience: derive per-task-class observations from run records. */
export function policyObservationsFromRuns(
  runs: { routes: { model: string }[]; status: string; rating: number | null; taskType: string | null }[],
): PolicyObservation[] {
  const obs: PolicyObservation[] = [];
  for (const r of runs) {
    if (!r.taskType) continue;
    const success = r.status === 'success';
    for (const rt of r.routes) {
      if (!rt.model) continue;
      obs.push({ taskClass: r.taskType, model: rt.model, success, rating: r.rating });
    }
  }
  return obs;
}
