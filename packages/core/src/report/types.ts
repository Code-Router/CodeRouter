import type { InjectionFinding } from '../security/injection.js';
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
  /**
   * Prompt-injection findings flagged during the run, copied through
   * from the mode output for downstream consumers (REPL render, MCP
   * JSON, store row).
   */
  securityFindings?: InjectionFinding[];
  /**
   * True when the worktree's diff was merged back into the host repo.
   * False (or undefined) means the changes were either zero or live
   * only in `artifactDir` until the user applies them manually.
   */
  applied?: boolean;
  /**
   * Persisted artifact directory (`<repo>/.coderouter/runs/<runId>/`).
   * Set when the run produced changes; the directory contains
   * `changes.patch` and a `manifest.json` listing the touched files.
   * Survives `apply=off` so the operator can `git apply` later.
   */
  artifactDir?: string;
};
