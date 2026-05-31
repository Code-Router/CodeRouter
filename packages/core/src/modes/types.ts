import type { ActivityEvent, Adapter } from '../adapters/types.js';
import type { Clarification } from '../clarify/types.js';
import type { ProviderRegistry } from '../providers/registry.js';
import type { RouterContext } from '../router/policy.js';
import type { InjectionFinding } from '../security/injection.js';
import type { Store } from '../store/index.js';
import type {
  Citation,
  ContextManifest,
  Classification,
  Effort,
  RouteRef,
  RunBudget,
  RunOutcome,
  ValidatorResult,
} from '../types.js';
import type { ProgressNotifier } from './progress.js';
import type { PlanFile } from './planFile.js';

export type ModeInput = {
  prompt: string;
  cwd: string;
  effort?: Effort;
  sessionId?: string;
  /** Validators to run. Falls back to project-detected defaults. */
  validatorsCommand?: string[];
  /** When set, mode runs the dryRun decision flow (no agent invocation). */
  dryRun?: boolean;
  /** Apply final diff to host repo when true (Agent/Masterplan execute). */
  apply?: boolean;
  /** Skip classifier/context/validators (--fast escape hatch). */
  fast?: boolean;
  /** Optional explicit route override. */
  route?: string;
  /** Optional MCP-shaped notifier. */
  progress?: ProgressNotifier;
  /**
   * Cancellation handle. When aborted, in-flight adapter calls bail
   * out and the mode returns `status: 'aborted'`. The REPL wires its
   * esc-to-interrupt key to this.
   */
  signal?: AbortSignal;
  /**
   * Optional streaming sink: every chunk the underlying adapter emits
   * is forwarded here so the REPL can render the response live.
   * Adapters that don't stream just call this once at the end with
   * the full response (or not at all - the report layer still has
   * the final text).
   */
  onChunk?: (chunk: string) => void;
  /**
   * Optional structured-action sink: every observable tool call /
   * tool result / reasoning summary the adapter can see is
   * forwarded here so the REPL can render a live activity feed.
   * Adapters that don't expose tool-level visibility simply never
   * fire this callback.
   */
  onActivity?: (event: ActivityEvent) => void;
  /**
   * What to do when prompt-injection scanning surfaces a `high`
   * severity finding:
   *   - `'warn'` (default): record findings on the output and run
   *     the adapter anyway. The user sees the warning in the report.
   *   - `'block'`: refuse to invoke the adapter; return early with
   *     `status: 'failed'` and the findings attached so the caller
   *     can show them to the operator.
   *
   * Lower severity findings (`info`, `warn`) never block regardless
   * of policy.
   */
  injectionPolicy?: 'warn' | 'block';
};

export type ModeOutput = {
  mode: 'plan' | 'masterplan' | 'agent' | 'debug' | 'review';
  status: RunOutcome['status'];
  runId: string;
  /** Final rendered text artifact (plan markdown, debug hypothesis tree, etc). */
  text?: string;
  /** Plan file when relevant. */
  planFile?: PlanFile;
  /** Resolved diff for the run, if any. */
  diff?: string;
  filesChanged?: string[];
  classification?: Classification;
  contextManifest?: ContextManifest;
  routes?: RouteRef[];
  validators?: ValidatorResult[];
  clarifications?: Clarification[];
  citations?: Citation[];
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  rationale: string;
  /**
   * Prompt-injection findings flagged during the run. Populated by
   * the mode pipeline before the adapter is invoked. An empty list
   * means the scan ran but came up clean; `undefined` means the
   * scanner wasn't run at all (e.g. `--fast`).
   */
  securityFindings?: InjectionFinding[];
  /**
   * True when the worktree was merged back into the host repo
   * (i.e. `apply` was on AND there were changes). False means the
   * changes either landed only in `artifactDir` (recoverable) or
   * the run produced no changes.
   */
  applied?: boolean;
  /**
   * Filesystem path under `<repo>/.coderouter/runs/<runId>/` where
   * the diff + a small manifest were persisted before the worktree
   * was destroyed. Set when there were changes to keep around for
   * later inspection / manual `git apply`.
   */
  artifactDir?: string;
};

export type ModeContext = {
  registry: ProviderRegistry;
  router: RouterContext;
  store?: Store;
  budget?: RunBudget;
  /** Override adapter resolution at the mode level (used by eval harness). */
  resolveAdapter?: (route: RouteRef) => Adapter;
};
