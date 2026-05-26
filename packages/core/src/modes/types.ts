import type { Adapter } from '../adapters/types.js';
import type { Clarification } from '../clarify/types.js';
import type { ProviderRegistry } from '../providers/registry.js';
import type { RouterContext } from '../router/policy.js';
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
};

export type ModeContext = {
  registry: ProviderRegistry;
  router: RouterContext;
  store?: Store;
  budget?: RunBudget;
  /** Override adapter resolution at the mode level (used by eval harness). */
  resolveAdapter?: (route: RouteRef) => Adapter;
};
