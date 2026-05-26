import type { CognitiveShape, TaskType } from '../types.js';
import type { ClassifierInput, ClassifierStageResult, SeedExample } from './types.js';

/**
 * Stage 2: lightweight bag-of-words "embedding" kNN over the seed corpus.
 *
 * We deliberately avoid a heavy embedding dependency for v0 - the kNN
 * approach with hashed token frequency works well enough on the 50-100
 * seed corpus and stays in the <20ms budget. The same module is the hook
 * that v0.3 will use to swap in fastembed/text-embedding-3-small without
 * touching callers.
 */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'it', 'this', 'that', 'in', 'on', 'at',
  'to', 'of', 'for', 'with', 'from', 'by', 'as', 'be', 'are', 'was', 'were', 'i', 'we',
  'you', 'they', 'me', 'us', 'them', 'my', 'our', 'your', 'their', 'so', 'do', 'does',
]);

export type Vec = Map<string, number>;

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_+./-]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export function vectorize(text: string): Vec {
  const tokens = tokenize(text);
  const v = new Map<string, number>();
  for (const t of tokens) v.set(t, (v.get(t) ?? 0) + 1);
  // L2 normalize so cosine = dot product.
  let norm = 0;
  for (const x of v.values()) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (const [k, x] of v) v.set(k, x / norm);
  return v;
}

export function cosine(a: Vec, b: Vec): number {
  let sum = 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const [k, x] of small) {
    const y = big.get(k);
    if (y !== undefined) sum += x * y;
  }
  return sum;
}

/**
 * Build a corpus index once at startup; reuse the prebuilt vectors per
 * classify call. The corpus is small enough that linear scan beats
 * any tree/quantization overhead.
 */
export type CorpusIndex = {
  examples: (SeedExample & { vec: Vec })[];
};

export function buildIndex(corpus: SeedExample[]): CorpusIndex {
  return {
    examples: corpus.map((ex) => ({ ...ex, vec: vectorize(ex.prompt) })),
  };
}

const AVERAGE_K = 5;
const MIN_CONFIDENCE = 0.18;

/**
 * Stage 2 returns null when the kNN result is too weak (lets the LLM
 * stage take over). When strong enough, returns the average shape of
 * the k nearest seeds, with the dominant taskType as the label.
 */
export function classifyByEmbedding(
  input: ClassifierInput,
  index: CorpusIndex,
  k: number = AVERAGE_K,
): ClassifierStageResult | null {
  if (index.examples.length === 0) return null;
  const q = vectorize(input.prompt);
  const scored = index.examples
    .map((ex) => ({ ex, score: cosine(q, ex.vec) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  const best = scored[0];
  if (!best || best.score < MIN_CONFIDENCE) return null;

  // Average shape across top-k weighted by similarity.
  const shape: CognitiveShape = {
    deepReasoning: 0,
    multiFileTaste: 0,
    hugeContext: 0,
    adversarial: 0,
    algorithmic: 0,
    exploratory: 0,
  };
  let totalWeight = 0;
  const taskVotes = new Map<TaskType, number>();
  for (const { ex, score } of scored) {
    const w = Math.max(score, 0);
    totalWeight += w;
    for (const k2 of Object.keys(shape) as (keyof CognitiveShape)[]) {
      shape[k2] += ex.shape[k2] * w;
    }
    taskVotes.set(ex.taskType, (taskVotes.get(ex.taskType) ?? 0) + w);
  }
  if (totalWeight > 0) {
    for (const k2 of Object.keys(shape) as (keyof CognitiveShape)[]) {
      shape[k2] = shape[k2] / totalWeight;
    }
  }
  const [topTask] = [...taskVotes.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['feature' as TaskType];

  return {
    stage: 'embed',
    confidence: Math.min(0.92, 0.5 + best.score * 0.5),
    taskType: topTask as TaskType,
    shape,
    rationale: `embed:kNN k=${k}; top=${best.ex.id} (sim=${best.score.toFixed(2)})`,
  };
}
