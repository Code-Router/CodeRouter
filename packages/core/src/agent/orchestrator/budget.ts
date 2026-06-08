/**
 * Agent budget: the safety rail around the loop.
 *
 * Caps both turns AND wall-clock time. The orchestrator consults
 * this on every iteration so a runaway model<->tool interaction
 * always exits cleanly within bounds. Pure data; mutation lives
 * in the orchestrator so the budget object stays comparable for
 * tests.
 */

import type { AgentBudget } from '../types.js';

export const DEFAULT_BUDGET: AgentBudget = {
  maxIterations: 25,
  maxDurationMs: 5 * 60_000,
  perCallTimeoutMs: 120_000,
};

export function resolveBudget(partial?: Partial<AgentBudget>): AgentBudget {
  return {
    maxIterations: partial?.maxIterations ?? DEFAULT_BUDGET.maxIterations,
    maxDurationMs: partial?.maxDurationMs ?? DEFAULT_BUDGET.maxDurationMs,
    perCallTimeoutMs: partial?.perCallTimeoutMs ?? DEFAULT_BUDGET.perCallTimeoutMs,
  };
}

/**
 * Returns the reason to stop (or null if we should keep going).
 *
 * Called at the TOP of each iteration so an exhausted budget never
 * fires another HTTP call. The orchestrator turns the reason into
 * a `finishReason` for the run result.
 */
export function checkBudget(opts: {
  iteration: number;
  startMs: number;
  budget: AgentBudget;
  signal?: AbortSignal;
}): 'iteration-cap' | 'duration-cap' | 'aborted' | null {
  if (opts.signal?.aborted) return 'aborted';
  if (opts.iteration >= opts.budget.maxIterations) return 'iteration-cap';
  if (performance.now() - opts.startMs > opts.budget.maxDurationMs) return 'duration-cap';
  return null;
}
