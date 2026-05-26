import type { Adapter } from '../adapters/types.js';
import type { Classification } from '../types.js';
import { type ClassifierCache, MemoryClassifierCache } from './cache.js';
import { buildIndex, type CorpusIndex, classifyByEmbedding } from './embed.js';
import { classifierHash } from './hash.js';
import { classifyByLLM } from './llm.js';
import { classifyByRules } from './rules.js';
import type { ClassifierInput, SeedExample } from './types.js';

export type CascadeOptions = {
  /** Seed corpus loaded once at startup. */
  corpus?: SeedExample[];
  /** Prebuilt index (faster on cold start when shared across calls). */
  index?: CorpusIndex;
  /** Cheap LLM judge adapter for stage 3 (Haiku / 4o-mini / DeepSeek-chat). */
  llmJudge?: Adapter;
  /** Cache instance; defaults to in-memory LRU. */
  cache?: ClassifierCache;
  /** Minimum confidence required to skip stage 3 (default 0.7). */
  rulesConfidenceFloor?: number;
  /** Hard cap on stage durations (ms). 0 = unlimited. */
  llmTimeoutMs?: number;
};

/**
 * 4-stage cascade.
 *
 *   cache -> rules -> embed -> llm -> fallback
 *
 * Each stage either returns a confident classification or yields to the
 * next. The cascade caches the final answer keyed by
 * (prompt + repoHead + manifestHash), so even if stage 3 ran we never
 * pay the LLM cost twice for the same input.
 */
export class ClassifierCascade {
  private readonly cache: ClassifierCache;
  private readonly index: CorpusIndex;

  constructor(private readonly opts: CascadeOptions = {}) {
    this.cache = opts.cache ?? new MemoryClassifierCache();
    this.index = opts.index ?? buildIndex(opts.corpus ?? []);
  }

  async classify(input: ClassifierInput): Promise<Classification> {
    const hash = classifierHash(input);
    const cached = this.cache.get(hash);
    if (cached) return cached;

    const floor = this.opts.rulesConfidenceFloor ?? 0.7;
    const rules = classifyByRules(input);
    if (rules && rules.confidence >= floor) {
      const result = this.finish(hash, rules);
      this.cache.set(hash, result);
      return result;
    }

    const embed = classifyByEmbedding(input, this.index);
    if (embed && embed.confidence >= floor) {
      const result = this.finish(hash, embed);
      this.cache.set(hash, result);
      return result;
    }

    if (!input.noLlm && this.opts.llmJudge) {
      try {
        const llm = await classifyByLLM(input, this.opts.llmJudge);
        if (llm) {
          const result = this.finish(hash, llm);
          this.cache.set(hash, result);
          return result;
        }
      } catch {
        // Swallow and fall through to the best-effort path below.
      }
    }

    // Best-effort: prefer whatever previous stage returned, else default.
    const fallback = rules ?? embed;
    const result = fallback
      ? this.finish(hash, fallback)
      : this.finish(hash, {
          stage: 'rules',
          confidence: 0.4,
          taskType: 'feature',
          shape: {
            deepReasoning: 0.4,
            multiFileTaste: 0.4,
            hugeContext: 0.2,
            adversarial: 0.2,
            algorithmic: 0.2,
            exploratory: 0.4,
          },
          rationale: 'fallback: no high-confidence stage matched',
        });
    this.cache.set(hash, result);
    return result;
  }

  private finish(
    hash: string,
    stage: import('./types.js').ClassifierStageResult,
  ): Classification {
    return {
      hash,
      source: stage.stage,
      confidence: stage.confidence,
      taskType: stage.taskType,
      shape: stage.shape,
      rationale: stage.rationale,
    };
  }
}
