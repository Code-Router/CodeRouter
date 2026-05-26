/**
 * Performance contract instrumentation.
 *
 * Every run produces a `PerfReport` enumerating per-stage durations so we
 * can:
 *   - expose `coderouter stats --perf` for the user
 *   - fail the eval harness on p95 regressions vs baseline
 *   - identify which stage is responsible for any slowdown a user sees
 *
 * The contract: every workflow stage (instant, classify, context, route,
 * worktree, run, validate, report) writes one entry. Total budget is
 * tracked separately so we know when we missed a target.
 */

export type PerfStage =
  | 'instant'
  | 'classify'
  | 'context'
  | 'memory'
  | 'route'
  | 'worktree'
  | 'run'
  | 'validate'
  | 'handoff'
  | 'judge'
  | 'report'
  | 'research'
  | 'plan'
  | 'masterplan'
  | 'debug'
  | 'review';

export type PerfEntry = {
  stage: PerfStage;
  label?: string;
  startedAtMs: number;
  durationMs: number;
};

export type PerfReport = {
  startedAt: number;
  entries: PerfEntry[];
  totalMs: number;
  /** True when total exceeded the configured budget. */
  overBudget: boolean;
  budgetMs?: number;
};

export class PerfTracker {
  private readonly entries: PerfEntry[] = [];
  private readonly start = performance.now();
  private readonly startedAt = Date.now();

  constructor(private readonly budgetMs?: number) {}

  /**
   * Times an async callback and records it as a perf entry. Returns the
   * callback's resolved value so callers don't need to restructure.
   */
  async time<T>(stage: PerfStage, fn: () => Promise<T>, label?: string): Promise<T> {
    const t0 = performance.now();
    try {
      return await fn();
    } finally {
      this.entries.push({
        stage,
        label,
        startedAtMs: t0 - this.start,
        durationMs: performance.now() - t0,
      });
    }
  }

  /** Records a duration the caller already measured. */
  record(stage: PerfStage, durationMs: number, label?: string): void {
    this.entries.push({
      stage,
      label,
      startedAtMs: performance.now() - this.start - durationMs,
      durationMs,
    });
  }

  report(): PerfReport {
    const totalMs = performance.now() - this.start;
    return {
      startedAt: this.startedAt,
      entries: [...this.entries],
      totalMs,
      budgetMs: this.budgetMs,
      overBudget: this.budgetMs !== undefined ? totalMs > this.budgetMs : false,
    };
  }
}

/**
 * Runs N async tasks in parallel and resolves once all complete. Used by
 * workflows that want to e.g. start the worktree creation while running
 * the classifier (the two are independent and together account for the
 * bulk of pre-agent latency).
 */
export async function parallel<T extends readonly Promise<unknown>[]>(
  ...promises: T
): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
  return (await Promise.all(promises)) as { -readonly [K in keyof T]: Awaited<T[K]> };
}
