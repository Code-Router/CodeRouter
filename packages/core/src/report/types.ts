import type {
  Citation,
  RouteRef,
  RunOutcome,
  ValidatorResult,
} from '../types.js';

/**
 * Canonical report shape used by every CodeRouter run. The CLI renders
 * it to a colored terminal block; the MCP server serializes it as JSON
 * to its host agent.
 */
export type Report = {
  runId: string;
  mode: string;
  status: RunOutcome['status'];
  prompt: string;
  classification?: {
    taskType: string;
    confidence: number;
    rationale: string;
    source: string;
  };
  routes: RouteRef[];
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  rationale: string;
  validators: ValidatorResult[];
  filesChanged?: string[];
  diff?: string;
  citations?: Citation[];
  /** Optional escalation nudge (Plan -> Masterplan). */
  escalationHint?: string;
  /** Optional human-readable text artifact (plan markdown / debug tree). */
  text?: string;
};
