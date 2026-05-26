import type { Classification } from '../types.js';
import type { LearnedStore } from '../store/learned.js';
import { signatureFor } from '../store/learned.js';
import { buildIndex, type CorpusIndex } from './embed.js';
import type { SeedExample } from './types.js';

/**
 * Classifier data flywheel.
 *
 * After each run we know the prompt's classification (from the cascade)
 * and the route's outcome (from the validators + optional rating). Good
 * runs contribute new examples to `learned_examples`; the flywheel then
 * periodically merges the learned set into the in-memory kNN corpus so
 * the next run benefits from past evidence.
 *
 * Dedup uses the same `signatureFor` as the seed loader, so a single
 * good answer doesn't get re-inserted dozens of times by paraphrased
 * variants of the same prompt.
 */

export type FlywheelStats = {
  /** Records inserted this call (post-dedup). */
  inserted: number;
  /** Records skipped because the signature already existed. */
  dedup: number;
};

/**
 * Records a single classified prompt into the learned-examples store.
 * Returns false if the example is a near-duplicate (signature already
 * exists), true if newly inserted.
 */
export function recordClassification(
  learned: LearnedStore,
  args: { prompt: string; classification: Classification; runId?: string },
): boolean {
  const sig = signatureFor(args.prompt);
  return learned.insert({
    prompt: args.prompt,
    taskType: args.classification.taskType,
    shape: args.classification.shape,
    sourceRunId: args.runId,
    embedSignature: sig,
  });
}

/**
 * Builds a new kNN corpus index that merges the static seed corpus with
 * the dynamic learned examples. Called by the modes when they construct
 * a `ClassifierCascade`. Learned examples take priority on duplicate
 * signatures (so user-specific corrections dominate).
 */
export function buildMergedIndex(
  seedCorpus: SeedExample[],
  learned: LearnedStore,
): CorpusIndex {
  const seen = new Set<string>();
  const merged: SeedExample[] = [];
  for (const ex of learned.list()) {
    const sig = ex.embedSignature ?? signatureFor(ex.prompt);
    if (seen.has(sig)) continue;
    seen.add(sig);
    merged.push({
      id: `learned-${ex.id}`,
      prompt: ex.prompt,
      taskType: ex.taskType,
      shape: ex.shape,
    });
  }
  for (const ex of seedCorpus) {
    const sig = signatureFor(ex.prompt);
    if (seen.has(sig)) continue;
    seen.add(sig);
    merged.push(ex);
  }
  return buildIndex(merged);
}

/**
 * Bulk-insert helper for the eval harness; returns insert vs dedup stats.
 */
export function ingestExamples(
  learned: LearnedStore,
  examples: { prompt: string; taskType: SeedExample['taskType']; shape: SeedExample['shape']; runId?: string }[],
): FlywheelStats {
  let inserted = 0;
  let dedup = 0;
  for (const ex of examples) {
    const ok = learned.insert({
      prompt: ex.prompt,
      taskType: ex.taskType,
      shape: ex.shape,
      sourceRunId: ex.runId,
    });
    if (ok) inserted += 1;
    else dedup += 1;
  }
  return { inserted, dedup };
}
