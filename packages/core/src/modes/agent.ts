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
} from '../sandbox/worktree.js';
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
    });
  } catch (err) {
    await destroyWorktree(wt).catch(() => {});
    throw err;
  }
  progress({ phase: 'agent/run', stage: 'done' });

  let validators: import('../types.js').ValidatorResult[] = [];
  let handoffPasses = 0;
  if (!input.fast) {
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
  }

  const diff = await diffWorktree(wt).catch(() => '');
  const files = await changedFiles(wt).catch(() => []);

  if (input.apply) {
    await mergeWorktree(wt).catch(() => {});
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
