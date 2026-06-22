import {
  buildReport,
  defaultProviders,
  deriveMemoryBias,
  loadConfig,
  openStore,
  ProviderRegistry,
  resolveDbPath,
  runMode,
} from '@coderouter/core';
import type {
  ActivityEvent,
  AskUserQuestionPayload,
  Effort,
  Mode,
  ModeOutput,
  ProgressNotifier,
  ProviderConfig,
  ProviderId,
  RouteRef,
  Store,
  WorktreeHandle,
} from '@coderouter/core';
import type { Report } from '@coderouter/core';
import { spinnerProgress } from './ui/progress.js';
import { getPreferredModels } from './ui/setup.js';

export type ProgressAdapter = {
  notifier: ProgressNotifier;
  close(): void;
};

export type CliRunOpts = {
  prompt: string;
  cwd: string;
  mode: Mode;
  effort?: Effort;
  fast?: boolean;
  apply?: boolean;
  route?: string;
  sessionId?: string;
  json?: boolean;
  /**
   * Optional progress adapter. When omitted, falls back to the default
   * stdout spinner. The Ink REPL passes its own state-routing notifier
   * here so progress doesn't fight Ink's renderer.
   */
  progress?: ProgressAdapter;
  /**
   * Cancellation handle. The REPL wires esc-to-interrupt to this; the
   * non-interactive `coderouter run` doesn't bother (a SIGINT just
   * tears down the whole process).
   */
  signal?: AbortSignal;
  /**
   * Optional streaming sink: every output chunk that the underlying
   * adapter emits is forwarded here. The REPL renders this live above
   * the input box so the user sees the model's answer as it lands
   * instead of waiting for the whole run to finish.
   */
  onChunk?: (chunk: string) => void;
  /**
   * Optional activity sink: structured tool_use / tool_result /
   * thinking events for adapters that have visibility into the
   * underlying agent loop (Claude Code, Codex). Used by the REPL
   * to render a live action feed alongside the streamed answer.
   */
  onActivity?: (event: ActivityEvent) => void;
  /**
   * Optional running-usage sink: cumulative token / cost numbers
   * fired whenever the adapter has fresh data. Used by the REPL
   * to render a live "X in · Y out · $0.0123" counter under the
   * spinner row.
   */
  onUsage?: (usage: { tokensIn: number; tokensOut: number; costUsd: number }) => void;
  /**
   * Prompt-injection enforcement policy. Defaults to 'warn' (record
   * findings but run anyway). Set to 'block' to refuse runs whose
   * prompts trigger any high-severity rule.
   */
  injectionPolicy?: 'warn' | 'block';
  /**
   * Per-provider session ids captured from earlier turns in this
   * REPL session. The mode forwards the entry that matches the
   * routed provider as `AdapterCallInput.resumeSessionId` so the
   * agent can resume the prior conversation. Mismatches (different
   * provider this turn, no entry) are silently ignored.
   */
  resumeSessions?: Partial<Record<ProviderId, string>>;
  /**
   * Optional callback for the model's interactive-question tool
   * (Claude Code's `AskUserQuestion`). The REPL uses this to abort
   * the headless run and surface the question to the operator
   * instead of letting the model fall back to a guess.
   */
  onUserQuestion?: (payload: AskUserQuestionPayload) => void;
  /**
   * Session-wide worktree to reuse for this turn. The REPL captures
   * this off `Report.worktree` after the first turn and feeds it
   * back here so the agent's cwd, branch, and accumulated edits all
   * carry across prompts. Unset on the first turn (mode creates a
   * fresh worktree) and on one-shot non-REPL invocations.
   */
  existingWorktree?: WorktreeHandle;
  /**
   * When true, the mode keeps the run's worktree alive past the end
   * of the call and returns its handle on `Report.worktree`. The
   * REPL sets this on every turn so the same worktree carries
   * across the whole conversation. Left false for `coderouter run`
   * one-shot invocations.
   */
  keepWorktree?: boolean;
  /**
   * Prior conversation messages from earlier REPL turns for
   * first-party agent multi-turn memory. Passed through to the
   * mode -> adapter -> agent loop.
   */
  priorMessages?: import('@coderouter/core').ChatMessage[];
};

/**
 * Shared execution path used by `coderouter run`, mode aliases, and the
 * REPL. Owns construction of the registry, the store, and the progress
 * adapter, and serializes the final report.
 */
export async function executeRun(opts: CliRunOpts): Promise<{
  report: Report;
  output: ModeOutput;
  store: Store;
}> {
  const { config } = await loadConfig(opts.cwd);
  const providers = mergeProviders(config.providers as ProviderConfig[] | undefined);
  const registry = new ProviderRegistry(providers);
  // Best-effort preload of the OpenRouter `/v1/models` catalog so a
  // user with only an OpenRouter key can route to ANY tool-capable
  // model on the platform - not just the curated handful we ship
  // statically. Cached on disk (24h TTL) so subsequent runs don't
  // pay the network cost. Failures are ignored: we still resolve
  // statically-declared models when the network is unavailable.
  if (process.env.OPENROUTER_API_KEY) {
    await registry.loadOpenRouterCatalog().catch(() => undefined);
  }
  const store = await openStore(resolveDbPath(opts.cwd));
  const bias = deriveMemoryBias(store, { taskType: 'feature' });
  const { notifier, close } = opts.progress ?? spinnerProgress();

  try {
    const output = await runMode(
      opts.mode,
      {
        prompt: opts.prompt,
        cwd: opts.cwd,
        effort: opts.effort,
        sessionId: opts.sessionId,
        fast: opts.fast,
        apply: opts.apply,
        route: opts.route,
        progress: notifier,
        signal: opts.signal,
        onChunk: opts.onChunk,
        onActivity: opts.onActivity,
        onUsage: opts.onUsage,
        injectionPolicy: opts.injectionPolicy,
        resumeSessions: opts.resumeSessions,
        onUserQuestion: opts.onUserQuestion,
        existingWorktree: opts.existingWorktree,
        keepWorktree: opts.keepWorktree,
        priorMessages: opts.priorMessages,
      },
      {
        registry,
        router: { registry, memoryBias: bias, preferredModels: resolvePreferredModels(registry) },
        store,
      },
    );
    const report = buildReport(opts.prompt, output);
    persistRun(store, opts, output, report);
    return { report, output, store };
  } finally {
    close();
  }
}

/**
 * Resolve the user's saved (provider, model) preferences into routable
 * `RouteRef`s using the registry (so we know each provider's adapter).
 * A preference whose provider isn't in the registry is dropped; the
 * router separately re-checks readiness at pick time.
 */
function resolvePreferredModels(
  registry: ProviderRegistry,
): { strong?: RouteRef; cheap?: RouteRef } {
  const saved = getPreferredModels();
  const toRef = (p: { provider: string; model: string } | null): RouteRef | undefined => {
    if (!p) return undefined;
    const cfg = registry.list().find((c) => c.name === p.provider);
    if (!cfg) return undefined;
    return {
      provider: cfg.adapter as RouteRef['provider'],
      via: cfg.name,
      model: p.model,
      rationale: '',
    };
  };
  return { strong: toRef(saved.strong), cheap: toRef(saved.cheap) };
}

function mergeProviders(extra: ProviderConfig[] | undefined): ProviderConfig[] {
  const base = defaultProviders() as ProviderConfig[];
  if (!extra) return base;
  const byName = new Map(base.map((p) => [p.name, p]));
  for (const p of extra) byName.set(p.name, p);
  return Array.from(byName.values());
}

function persistRun(store: Store, opts: CliRunOpts, output: ModeOutput, report: Report): void {
  try {
    const routes: RouteRef[] = output.routes ?? [];
    store.runs.insert({
      id: output.runId,
      sessionId: opts.sessionId ?? null,
      mode: output.mode as Mode,
      taskType: output.classification?.taskType ?? null,
      prompt: opts.prompt,
      status: output.status,
      costUsd: output.costUsd,
      tokensIn: output.tokensIn,
      tokensOut: output.tokensOut,
      durationMs: output.durationMs,
      routes,
      rationale: output.rationale,
      diff: output.diff ?? null,
      filesChanged: output.filesChanged ?? [],
      validators: output.validators ?? [],
      effectiveness: null,
      rating: null,
      createdAt: Date.now(),
    });
  } catch {
    // Persistence is best-effort; never fail a run because of it.
  }
  void report;
}
