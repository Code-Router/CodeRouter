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
  Effort,
  Mode,
  ModeOutput,
  ProviderConfig,
  RouteRef,
  Store,
} from '@coderouter/core';
import type { Report } from '@coderouter/core';
import { spinnerProgress } from './ui/progress.js';

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
  const { notifier, close } = spinnerProgress();

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
