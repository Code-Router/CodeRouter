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
  Effort,
  Mode,
  ModeOutput,
  ProgressNotifier,
  ProviderConfig,
  RouteRef,
  Store,
} from '@coderouter/core';
import type { Report } from '@coderouter/core';
import { spinnerProgress } from './ui/progress.js';

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
   * Prompt-injection enforcement policy. Defaults to 'warn' (record
   * findings but run anyway). Set to 'block' to refuse runs whose
   * prompts trigger any high-severity rule.
   */
  injectionPolicy?: 'warn' | 'block';
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
        injectionPolicy: opts.injectionPolicy,
      },
      {
        registry,
        router: { registry, memoryBias: bias },
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
