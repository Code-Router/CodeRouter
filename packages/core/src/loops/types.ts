/**
 * Loop types.
 *
 * A "loop" is a long-horizon, self-verifying agent task. The product
 * shape is: the user describes an outcome in plain English, CodeRouter
 * *generates* a structured, bounded `LoopSpec`, the user approves it,
 * and the runner executes it deterministically — running a verifier,
 * and on failure planning -> editing -> reviewing -> re-verifying until
 * the verifier passes or a hard limit (iterations / cost / files) trips.
 *
 * The AI plans and edits; the *system* owns iteration count, cost,
 * commands, file permissions, and stop conditions. A loop must always
 * carry an objective verifier, an iteration cap, a cost cap, file
 * restrictions, and a final report contract.
 */

/** Quality/role hint for a phase; resolved to a concrete route at run time. */
export type LoopModelRole = 'frontier' | 'strong' | 'coding' | 'reviewer' | 'cheap';

export type LoopModels = {
  /** Decomposes failures and decides the single next fix (read-only, strong). */
  planner: LoopModelRole;
  /** Edits code in the worktree (must be edit-capable). */
  executor: LoopModelRole;
  /** Reviews the patch before re-verifying (read-only, strong). */
  reviewer: LoopModelRole;
  /** Cheap/fast summaries + reporting. */
  summarizer: LoopModelRole;
};

export type LoopVerifier = {
  /** Shell commands run, in order, as the loop gate (e.g. `npm test`). */
  commands: string[];
  /** Human-readable success contract. The runner treats all-exit-0 as pass. */
  successCondition: string;
};

export type LoopLimits = {
  maxIterations: number;
  maxCostUsd: number;
  maxFilesChanged: number;
};

export type LoopSafety = {
  /** Pause and surface for human approval before merging into the host repo. */
  requireApprovalBeforeCommit: boolean;
  /** Glob-ish paths the loop must never edit (secrets, lockfiles, ...). */
  blockedFiles: string[];
  /** When non-empty, edits are restricted to these path prefixes. */
  allowedPaths: string[];
  /** Best-effort network gate for verifier/edit subprocesses. */
  allowNetwork: boolean;
};

export type LoopPreset = 'safe' | 'aggressive' | 'ci-repair' | 'migration';

/** A complete, executable loop definition. */
export type LoopSpec = {
  name: string;
  goal: string;
  assumptions: string[];
  verifier: LoopVerifier;
  steps: string[];
  models: LoopModels;
  limits: LoopLimits;
  safety: LoopSafety;
  onSuccess: string;
  onFailure: string;
  preset?: LoopPreset;
};

export type LoopStatus =
  | 'draft'
  | 'queued'
  | 'running'
  | 'paused'
  | 'awaiting_approval'
  | 'succeeded'
  | 'failed'
  | 'stopped';

/** One verifier command's outcome within an iteration. */
export type VerifierResult = {
  command: string;
  exitCode: number;
  ok: boolean;
  durationMs: number;
  output: string;
};

export type LoopPhase = 'verify' | 'plan' | 'edit' | 'review' | 'report';

/** Persisted record of a single loop iteration. */
export type LoopIteration = {
  id: string;
  loopId: string;
  index: number;
  runId: string | null;
  phase: LoopPhase;
  status: 'pass' | 'fail' | 'error' | 'running';
  verifier: VerifierResult[];
  diff: string | null;
  summary: string;
  costUsd: number;
  createdAt: number;
};

/** Minimal worktree handle persisted so a paused/awaiting loop can merge later. */
export type LoopWorktree = {
  runId: string;
  branch: string;
  path: string;
  baseRef: string;
  baseSha: string;
  repoPath: string;
  createdAt: number;
};

/** Top-level persisted loop record. */
export type LoopRecord = {
  id: string;
  name: string;
  goal: string;
  cwd: string;
  status: LoopStatus;
  spec: LoopSpec;
  iterationsDone: number;
  costUsd: number;
  filesChanged: string[];
  lastDiff: string | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
};

/** Result of validating a generated spec. */
export type LoopValidation = {
  valid: boolean;
  issues: string[];
  /** Non-fatal advisories. */
  warnings: string[];
};

/** Live event emitted by the supervisor as a loop runs (streamed via SSE). */
export type LoopEvent =
  | { type: 'status'; loopId: string; status: LoopStatus; at: number }
  | { type: 'iteration'; loopId: string; iteration: LoopIteration; at: number }
  | { type: 'phase'; loopId: string; index: number; phase: LoopPhase; message: string; at: number }
  | { type: 'chunk'; loopId: string; index: number; text: string; at: number }
  | { type: 'verifier'; loopId: string; index: number; result: VerifierResult; at: number }
  | { type: 'done'; loopId: string; status: LoopStatus; record: LoopRecord; at: number }
  | { type: 'error'; loopId: string; message: string; at: number };
