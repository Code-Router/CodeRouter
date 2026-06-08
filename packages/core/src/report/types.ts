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
  /**
   * Why the validator pipeline (lint / typecheck / tests) didn't
   * run, when it didn't. Common values:
   *   - 'no-file-changes'                    informational query
   *   - 'no-<lang>-sources-changed'          cross-lang drop
   *   - '<lang>-deps-not-installed-in-worktree'   missing node_modules etc.
   *   - 'fast-mode'                          --fast flag
   * Surfaced verbatim in the report footer so the user understands
   * why they didn't see lint / tsc / vitest output instead of
   * thinking validators silently failed.
   */
  validatorsSkippedReason?: string;
  /**
   * Adapter-defined session id captured during this run. The REPL
   * persists `{ provider: sessionId }` between turns and replays it
   * on the next prompt so the model has conversational memory.
   * Adapters that don't expose a session (raw HTTP) leave this
   * unset.
   */
  sessionId?: string;
  /** Provider that produced `sessionId`. */
  sessionProvider?: RouteRef['provider'];
};
