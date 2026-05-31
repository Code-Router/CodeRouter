import { randomUUID } from 'node:crypto';
import { ClassifierCascade, loadSeedCorpus } from '../classify/index.js';
import { scanContext } from '../context/scan.js';
import { fastClassification } from '../router/fast.js';
import { matchInstant } from '../router/instant.js';
import { pick } from '../router/policy.js';
import { effortProfile } from '../router/effort.js';
import { runHandoff } from '../handoff/workflow.js';
import {
  changedFiles,
  createWorktree,
  destroyWorktree,
  diffWorktree,
  mergeWorktree,
  persistRunArtifact,
} from '../sandbox/worktree.js';
import { scanText as scanForInjection } from '../security/injection.js';
import { runValidators, summarize } from '../validate/run.js';
import type { Adapter } from '../adapters/types.js';
import type { RouteRef } from '../types.js';
import { noopProgress } from './progress.js';
import type { ModeContext, ModeInput, ModeOutput } from './types.js';

/**
 * Agent mode: decisive execution.
 *
 * Pipeline:
 *   instant -> classify -> context -> route -> worktree create
 *   -> adapter.run -> validators -> optional handoff-fix passes
 *   -> diff + merge (if --apply) -> report
 *
 * Honors --fast (skips classifier, context, validators). Respects the
 * effort knob via the router's reasoning thresholds + handoff pass caps.
 */
export async function runAgentMode(input: ModeInput, ctx: ModeContext): Promise<ModeOutput> {
  const start = performance.now();
  const progress = input.progress ?? noopProgress;
  const runId = randomUUID().slice(0, 8);
  const effort = input.effort ?? 'medium';
  const profile = effortProfile(effort);

  progress({ phase: 'agent/instant', stage: 'start' });
  const instant = matchInstant(input.prompt);
  progress({ phase: 'agent/instant', stage: 'done' });

  // Prompt-injection scan. We run this before any classifier or
  // adapter call so a `block` policy can abort the run without
  // burning tokens or spinning up a worktree. Findings always flow
  // through to the report regardless of policy so the operator can
  // see them.
  progress({ phase: 'agent/security', stage: 'start' });
  const securityFindings = scanForInjection(input.prompt, { source: 'user-prompt' }).findings;
  progress({
    phase: 'agent/security',
    stage: 'done',
    data: { findings: securityFindings.length },
  });
  const policy = input.injectionPolicy ?? 'warn';
  const hasHighRisk = securityFindings.some((f) => f.severity === 'high');
  if (policy === 'block' && hasHighRisk) {
    return {
      mode: 'agent',
      status: 'failed',
      runId,
      classification: undefined,
      contextManifest: { entries: [], totalTokens: 0, budget: 0, truncated: false },
      routes: [],
      validators: [],
      costUsd: 0,
      tokensIn: 0,
      tokensOut: 0,
      durationMs: performance.now() - start,
      rationale: 'blocked: prompt-injection policy=block and high-severity finding present',
      securityFindings,
    };
  }

  const corpus = await loadSeedCorpus();
  const classifier = new ClassifierCascade({ corpus });

  const classification = input.fast
    ? fastClassification(input.prompt)
    : instant.matched
      ? instant.classification
      : await classifier.classify({ prompt: input.prompt, noLlm: !ctx.budget });

  const route = input.route
    ? parseRoute(input.route)
    : pick(classification, ctx.router, { effort });

  const adapter: Adapter = ctx.resolveAdapter
    ? ctx.resolveAdapter(route)
    : ctx.registry.resolve(`${route.via ?? route.provider},${route.model}`).adapter;

  progress({ phase: 'agent/worktree', stage: 'start' });
  const wt = await createWorktree({ repoPath: input.cwd, runId, prefix: 'agent' });
  progress({ phase: 'agent/worktree', stage: 'done' });

  let manifest = { entries: [], totalTokens: 0, budget: 0, truncated: false } as import('../types.js').ContextManifest;
  if (!input.fast) {
    progress({ phase: 'agent/context', stage: 'start' });
    manifest = await scanContext({ cwd: wt.path, prompt: input.prompt });
    progress({ phase: 'agent/context', stage: 'done' });
  }

  progress({ phase: 'agent/run', stage: 'start' });
  let res;
  try {
    res = await adapter.run({
      prompt: input.prompt,
      cwd: wt.path,
      reasoningEffort: profile.reasoningEffort,
      contextManifest: manifest,
      signal: input.signal,
      onChunk: input.onChunk,
      onActivity: input.onActivity,
    });
  } catch (err) {
    await destroyWorktree(wt).catch(() => {});
    // Surface cancellation as a structured outcome instead of letting
    // the AbortError propagate as a generic failure.
    if (input.signal?.aborted) {
      return {
        mode: 'agent',
        status: 'aborted',
        runId,
        classification,
        contextManifest: manifest,
        routes: [route],
        validators: [],
        costUsd: 0,
        tokensIn: 0,
        tokensOut: 0,
        durationMs: performance.now() - start,
        rationale: `${route.rationale} (aborted)`,
        securityFindings,
      };
    }
    throw err;
  }
  progress({ phase: 'agent/run', stage: 'done' });

  // Compute the diff once, up front: it gates whether validators
  // (and therefore handoff) make sense at all. If the model didn't
  // touch any files we're answering a question, not making a change,
  // and running `pnpm lint` / `tsc` / `vitest` against an unchanged
  // worktree is at best wasted time and at worst noise that drowns
  // the actual answer.
  const files = await changedFiles(wt).catch(() => []);
  const diff = await diffWorktree(wt).catch(() => '');

  let validators: import('../types.js').ValidatorResult[] = [];
  let handoffPasses = 0;
  if (!input.fast && files.length > 0) {
    progress({ phase: 'agent/validate', stage: 'start' });
    validators = await runValidators({ cwd: wt.path });
    progress({ phase: 'agent/validate', stage: 'done' });

    if (summarize(validators).status === 'fail' && profile.maxHandoffPasses > 0) {
      progress({ phase: 'agent/handoff', stage: 'start' });
      const handoff = await runHandoff({
        registry: ctx.registry,
        router: ctx.router,
        mode: 'fix',
        worktree: wt,
        classification,
        originalPrompt: input.prompt,
        fromRoute: route,
        budget: {
          maxCostUsd: profile.maxCostUsd,
          maxDurationMs: profile.maxDurationMs,
          maxHandoffPasses: profile.maxHandoffPasses,
          maxContenders: profile.tournamentSize,
        },
      });
      validators = handoff.finalValidators;
      handoffPasses = handoff.passes.length;
      progress({ phase: 'agent/handoff', stage: 'done', data: { passes: handoffPasses } });
    }
  } else if (!input.fast) {
    // Skipped explicitly so the progress phase still emits a "done"
    // beat; otherwise the spinner gets stuck on "run · done" for the
    // remainder of the pipeline.
    progress({ phase: 'agent/validate', stage: 'done', data: { skipped: 'no-file-changes' } });
  }

  // Always persist the diff to a stable, recoverable location BEFORE
  // we destroy the worktree. Without this the user has no way to
  // recover the changes they just watched the model "make" - the
  // worktree lives in /tmp and gets nuked on apply=off, which is the
  // exact pattern that produced the "claimed to create the file but
  // it doesn't exist" confusion.
  let artifactDir: string | undefined;
  if (files.length > 0) {
    const artifact = await persistRunArtifact(wt, { diff, files });
    if (artifact) artifactDir = artifact.dir;
  }

  let applied = false;
  if (input.apply) {
    if (files.length > 0) {
      try {
        await mergeWorktree(wt);
        applied = true;
      } catch {
        applied = false;
      }
    } else {
      await destroyWorktree(wt).catch(() => {});
    }
  } else {
    await destroyWorktree(wt).catch(() => {});
  }

  const status = summarize(validators).status === 'fail' ? 'partial' : 'success';

  return {
    mode: 'agent',
    status,
    runId,
    text: res.text,
    diff,
    filesChanged: files,
    classification,
    contextManifest: manifest,
    routes: [route],
    validators,
    costUsd: res.costUsd,
    tokensIn: res.tokensIn,
    tokensOut: res.tokensOut,
    durationMs: performance.now() - start,
    rationale: `${route.rationale}${handoffPasses ? ` + ${handoffPasses} handoff pass(es)` : ''}`,
    securityFindings,
    applied,
    artifactDir,
  };
}

function parseRoute(route: string): RouteRef {
  const [provider, ...rest] = route.split(',');
  if (!provider || rest.length === 0) throw new Error(`Invalid route: ${route}`);
  return {
    provider: provider as RouteRef['provider'],
    model: rest.join(','),
    rationale: 'explicit route override',
    via: provider,
  };
}
