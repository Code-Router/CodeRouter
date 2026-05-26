import type { Effort } from '../types.js';

/**
 * The effort knob.
 *
 * One first-class parameter shifts every policy threshold in the system,
 * so users never have to know which workflow it's wired into. It
 * controls dualPlan auto-promotion, tournament size, handoff passes,
 * cost ceilings, and reasoning effort.
 */
export type EffortProfile = {
  /** Reasoning effort passed to adapters that support it. */
  reasoningEffort: 'minimal' | 'low' | 'medium' | 'high';
  /** Auto-promote to dualPlan when shape exceeds this threshold. */
  dualPlanAutoThreshold: number;
  /** Auto-promote to tournament when shape exceeds this threshold. */
  tournamentAutoThreshold: number;
  /** Number of contenders for tournament workflow. */
  tournamentSize: number;
  /** Maximum handoff passes for the handoff workflow. */
  maxHandoffPasses: number;
  /** USD ceiling for a single workflow invocation. */
  maxCostUsd: number;
  /** Soft total duration budget. */
  maxDurationMs: number;
  /** Whether masterplan should include external research by default. */
  preferMasterplanResearch: boolean;
};

const PROFILES: Record<Effort, EffortProfile> = {
  low: {
    reasoningEffort: 'minimal',
    dualPlanAutoThreshold: 1.1,
    tournamentAutoThreshold: 1.1,
    tournamentSize: 1,
    maxHandoffPasses: 0,
    maxCostUsd: 0.25,
    maxDurationMs: 60_000,
    preferMasterplanResearch: false,
  },
  medium: {
    reasoningEffort: 'medium',
    dualPlanAutoThreshold: 0.95,
    tournamentAutoThreshold: 1.1,
    tournamentSize: 1,
    maxHandoffPasses: 1,
    maxCostUsd: 1.5,
    maxDurationMs: 300_000,
    preferMasterplanResearch: true,
  },
  high: {
    reasoningEffort: 'high',
    dualPlanAutoThreshold: 0.75,
    tournamentAutoThreshold: 0.92,
    tournamentSize: 3,
    maxHandoffPasses: 2,
    maxCostUsd: 5,
    maxDurationMs: 600_000,
    preferMasterplanResearch: true,
  },
  max: {
    reasoningEffort: 'high',
    dualPlanAutoThreshold: 0.6,
    tournamentAutoThreshold: 0.7,
    tournamentSize: 4,
    maxHandoffPasses: 3,
    maxCostUsd: 20,
    maxDurationMs: 1_800_000,
    preferMasterplanResearch: true,
  },
};

export function effortProfile(effort: Effort = 'medium'): EffortProfile {
  return PROFILES[effort];
}
