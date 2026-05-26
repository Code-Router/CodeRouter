import type { Adapter } from '../adapters/types.js';
import type { ProviderRegistry } from '../providers/registry.js';
import { pick, type RouterContext } from '../router/policy.js';
import type { Worktree } from '../sandbox/worktree.js';
import { diffWorktree } from '../sandbox/worktree.js';
import { runValidators, summarize, type ValidatorSpec } from '../validate/run.js';
import type {
  Classification,
  RouteRef,
  RunBudget,
  RunOutcome,
  ValidatorResult,
} from '../types.js';
import { buildBrief, renderBriefAsPrompt } from './brief.js';

export type HandoffOptions = {
  registry: ProviderRegistry;
  router: RouterContext;
  /** Mode: handoff-fix delegates failures to a cheap fixer; handoff-review asks for a second opinion. */
  mode: 'fix' | 'review';
  worktree: Worktree;
  classification: Classification;
  originalPrompt: string;
  /** Validators to run after each pass. */
  validators?: ValidatorSpec[];
  /** The route that produced the work we're handing off from. */
  fromRoute: RouteRef;
  /** Budget caps; passes stop when exhausted. */
  budget: RunBudget;
  /** Reviewer route (handoff-review) - if provided, used instead of picking. */
  reviewerRoute?: RouteRef;
  /** Persistent forbidden patterns from L5. */
  memoryForbidden?: string[];
};

export type HandoffResult = {
  passes: HandoffPassResult[];
  finalValidators: ValidatorResult[];
  status: RunOutcome['status'];
  totalCostUsd: number;
};

export type HandoffPassResult = {
  pass: number;
  route: RouteRef;
  briefSummary: string;
  validators: ValidatorResult[];
  costUsd: number;
  durationMs: number;
};

/**
 * Runs one or more handoff passes against a worktree.
 *
 *   handoff-fix: pick a cheap capable fixer, repeat up to budget.maxHandoffPasses
 *                while validators still fail. Each pass receives a fresh brief
 *                summarising remaining failures.
 *
 *   handoff-review: single pass; reviewer's job is to comment, not to edit.
 *                   We capture the reviewer's response in `briefSummary`.
 *
 * Adapter selection: if `mode==='fix'` we ask the router for a cheap
 * route; if `mode==='review'` we use `reviewerRoute` when provided, else
 * a strong route from the router.
 */
export async function runHandoff(opts: HandoffOptions): Promise<HandoffResult> {
  const passes: HandoffPassResult[] = [];
  let totalCostUsd = 0;
  let validators = await runValidators({
    cwd: opts.worktree.path,
    validators: opts.validators,
  });
  let status: RunOutcome['status'] = summarize(validators).status === 'pass' ? 'success' : 'partial';

  const maxPasses = opts.mode === 'review' ? 1 : opts.budget.maxHandoffPasses;
  for (let pass = 1; pass <= maxPasses; pass += 1) {
    if (opts.mode === 'fix' && summarize(validators).status === 'pass') {
      status = 'success';
      break;
    }
    if (totalCostUsd >= opts.budget.maxCostUsd) {
      status = 'partial';
      break;
    }

    const route =
      opts.mode === 'review'
        ? opts.reviewerRoute ?? pickReviewerRoute(opts)
        : pickFixerRoute(opts);
    const priorDiff = await diffWorktree(opts.worktree).catch(() => undefined);
    const brief = buildBrief({
      intent:
        opts.mode === 'review'
          ? 'Review the diff and surface risks, regressions, and missed cases.'
          : 'Fix the remaining validator failures using the smallest viable change.',
      originalPrompt: opts.originalPrompt,
      fromRoute: opts.fromRoute,
      toRoute: route,
      reason: opts.mode === 'review' ? 'post-write second opinion' : 'residual validator failures',
      validators,
      priorDiff,
      scopeFiles:
        opts.mode === 'review'
          ? undefined
          : [...new Set(validators.flatMap((v) => v.failures).map((f) => f.file ?? '').filter(Boolean))],
      budget: opts.budget,
      memoryForbidden: opts.memoryForbidden,
    });

    const adapter = resolveAdapter(opts.registry, route);
    const t0 = performance.now();
    const out = await adapter.run({
      prompt: renderBriefAsPrompt(brief),
      cwd: opts.worktree.path,
    });
    const durationMs = performance.now() - t0;
    totalCostUsd += out.costUsd;

    if (opts.mode === 'fix') {
      validators = await runValidators({
        cwd: opts.worktree.path,
        validators: opts.validators,
      });
    }

    passes.push({
      pass,
      route,
      briefSummary: out.text.slice(0, 600),
      validators: opts.mode === 'fix' ? validators : [],
      costUsd: out.costUsd,
      durationMs,
    });

    if (opts.mode === 'review') break;
  }

  if (summarize(validators).status === 'pass') status = 'success';
  else if (summarize(validators).status === 'fail' && passes.length >= maxPasses) status = 'partial';

  return {
    passes,
    finalValidators: validators,
    status,
    totalCostUsd,
  };
}

function pickFixerRoute(opts: HandoffOptions): RouteRef {
  return pick(opts.classification, opts.router, { forceCheap: true });
}

function pickReviewerRoute(opts: HandoffOptions): RouteRef {
  return pick(opts.classification, opts.router, { effort: 'high' });
}

function resolveAdapter(registry: ProviderRegistry, ref: RouteRef): Adapter {
  const route = `${ref.via ?? ref.provider},${ref.model}`;
  return registry.resolve(route).adapter;
}
