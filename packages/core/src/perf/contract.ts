import type { PerfReport, PerfStage } from './tracker.js';

/**
 * The latency contract CodeRouter commits to. These numbers are the
 * targets the eval harness regresses against (p95 across the task set).
 *
 * Pre-agent (instant -> classify -> context -> route -> worktree) keeps
 * the user from feeling "the tool slowed me down":
 *   - cold cache:  <2000ms
 *   - warm cache:  <100ms
 *
 * Plan mode (the full instant -> classify -> single-shot planner) keeps
 * the everyday-task happy path snappy:
 *   - <5000ms
 *
 * Masterplan is allowed to be slow (research is the point), but each
 * phase has its own budget tracked separately.
 */
export type PerfBudget = {
  preAgentColdMs: number;
  preAgentWarmMs: number;
  planModeMs: number;
};

export const DEFAULT_BUDGET: PerfBudget = {
  preAgentColdMs: 2000,
  preAgentWarmMs: 100,
  planModeMs: 5000,
};

const PRE_AGENT_STAGES: PerfStage[] = ['instant', 'classify', 'context', 'memory', 'route', 'worktree'];

/**
 * Returns the cumulative pre-agent latency from a PerfReport. Used by
 * the eval harness assertion and `coderouter stats --perf`.
 */
export function preAgentMs(report: PerfReport): number {
  return report.entries
    .filter((e) => PRE_AGENT_STAGES.includes(e.stage))
    .reduce((sum, e) => sum + e.durationMs, 0);
}

export type PerfAssertion = {
  ok: boolean;
  violations: string[];
};

export function assertPreAgentBudget(
  report: PerfReport,
  budget: PerfBudget,
  mode: 'cold' | 'warm' = 'cold',
): PerfAssertion {
  const violations: string[] = [];
  const ms = preAgentMs(report);
  const target = mode === 'cold' ? budget.preAgentColdMs : budget.preAgentWarmMs;
  if (ms > target) {
    violations.push(`pre-agent ${mode}: ${ms.toFixed(0)}ms exceeds budget ${target}ms`);
  }
  return { ok: violations.length === 0, violations };
}

export function assertPlanModeBudget(report: PerfReport, budget: PerfBudget): PerfAssertion {
  const violations: string[] = [];
  if (report.totalMs > budget.planModeMs) {
    violations.push(
      `plan mode total: ${report.totalMs.toFixed(0)}ms exceeds budget ${budget.planModeMs}ms`,
    );
  }
  return { ok: violations.length === 0, violations };
}
