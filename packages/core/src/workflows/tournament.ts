import type { Adapter } from '../adapters/types.js';
import type { ProviderRegistry } from '../providers/registry.js';
import { destroyWorktree, diffStats, diffWorktree } from '../sandbox/worktree.js';
import {
  createWorktree,
  type Worktree,
  type WorktreeMetrics,
} from '../sandbox/worktree.js';
import { extractJsonBlock } from '../transformers/tooluse.js';
import { runValidators, summarize, type ValidatorSpec } from '../validate/run.js';
import type { RouteRef, RunBudget, ValidatorResult } from '../types.js';

export type TournamentInput = {
  task: string;
  routes: RouteRef[];
  judgeRoute: RouteRef;
  registry: ProviderRegistry;
  /** Source repo. Each contender gets its own worktree forked from here. */
  repoPath: string;
  systemPrompt?: string;
  budget: RunBudget;
  validators?: ValidatorSpec[];
  /** When true, losing worktrees are kept on disk for inspection. */
  keepLosers?: boolean;
};

export type TournamentResult = {
  contenders: ContenderResult[];
  winner: ContenderResult | null;
  judgeRationale: string;
  judgeCostUsd: number;
  totalCostUsd: number;
};

export type ContenderResult = {
  route: RouteRef;
  worktreePath: string;
  diff: string;
  diffStats: WorktreeMetrics;
  validators: ValidatorResult[];
  status: 'pass' | 'fail' | 'skip';
  costUsd: number;
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
};

const JUDGE_SYSTEM = `You are a code judge. Given multiple candidate diffs for the same task, output STRICT JSON:
{ "winnerIndex": <0-based int>, "rationale": "<1-3 sentences>" }`;

/**
 * Tournament implementation workflow.
 *
 *   1) Create N worktrees forked from the same base.
 *   2) Run N strong adapters in parallel against their worktrees.
 *   3) Validate each.
 *   4) Send the diffs + validator outcomes to a judge for a JSON verdict.
 *   5) Cleanup: keep the winner's worktree, discard losers (unless keepLosers).
 */
export async function runTournament(opts: TournamentInput): Promise<TournamentResult> {
  if (opts.routes.length === 0) {
    return { contenders: [], winner: null, judgeRationale: 'no contenders', judgeCostUsd: 0, totalCostUsd: 0 };
  }

  const contenderRuns = await Promise.all(
    opts.routes.map(async (route, i) => {
      const wt = await createWorktree({
        repoPath: opts.repoPath,
        runId: `tour${i}`,
        prefix: 'tour',
      });
      const adapter = resolve(opts.registry, route);
      const t0 = performance.now();
      try {
        const result = await adapter.run({
          prompt: opts.task,
          cwd: wt.path,
          systemPrompt: opts.systemPrompt,
        });
        const validators = await runValidators({
          cwd: wt.path,
          validators: opts.validators,
        });
        const diff = await diffWorktree(wt).catch(() => '');
        const stats = await diffStats(wt).catch(
          () => ({ filesChanged: 0, insertions: 0, deletions: 0 }) as WorktreeMetrics,
        );
        return {
          contender: {
            route,
            worktreePath: wt.path,
            diff,
            diffStats: stats,
            validators,
            status: summarize(validators).status,
            costUsd: result.costUsd,
            durationMs: performance.now() - t0,
            tokensIn: result.tokensIn,
            tokensOut: result.tokensOut,
          } as ContenderResult,
          worktree: wt,
        };
      } catch (err) {
        return {
          contender: {
            route,
            worktreePath: wt.path,
            diff: '',
            diffStats: { filesChanged: 0, insertions: 0, deletions: 0 },
            validators: [],
            status: 'fail' as const,
            costUsd: 0,
            durationMs: performance.now() - t0,
            tokensIn: 0,
            tokensOut: 0,
          },
          worktree: wt,
          error: err,
        };
      }
    }),
  );

  const contenders = contenderRuns.map((c) => c.contender);

  // Build judge prompt.
  const judge = resolve(opts.registry, opts.judgeRoute);
  const judgePrompt = [
    `Task: ${opts.task}`,
    '',
    'Candidates (judge based on correctness, scope, and quality):',
    ...contenders.map((c, i) =>
      [
        `--- Candidate ${i}: ${c.route.via ?? c.route.provider},${c.route.model} (validators=${c.status}) ---`,
        c.diff.slice(0, 6_000),
      ].join('\n'),
    ),
  ].join('\n');

  const judgeRes = await judge.run({
    prompt: judgePrompt,
    systemPrompt: JUDGE_SYSTEM,
    maxTokens: 800,
    // Local-CLI judges (Claude Code / Codex) require a cwd; readOnly
    // because judging compares diffs, it must never edit anything.
    cwd: opts.repoPath,
    readOnly: true,
  });

  const parsed = extractJsonBlock<{ winnerIndex?: number; rationale?: string }>(judgeRes.text);
  const winnerIndex = clampIndex(parsed?.winnerIndex, contenders.length);
  const winner = winnerIndex !== null ? contenders[winnerIndex] ?? null : null;
  const rationale = (parsed?.rationale ?? judgeRes.text).slice(0, 600);

  // Cleanup losers.
  if (!opts.keepLosers) {
    await Promise.all(
      contenderRuns.map(async (c, i) => {
        if (i === winnerIndex) return;
        try {
          await destroyWorktree(c.worktree as Worktree);
        } catch {
          // ignore
        }
      }),
    );
  }

  const totalCostUsd = contenders.reduce((a, b) => a + b.costUsd, 0) + judgeRes.costUsd;
  return {
    contenders,
    winner,
    judgeRationale: rationale,
    judgeCostUsd: judgeRes.costUsd,
    totalCostUsd,
  };
}

function resolve(registry: ProviderRegistry, ref: RouteRef): Adapter {
  const route = `${ref.via ?? ref.provider},${ref.model}`;
  return registry.resolve(route).adapter;
}

function clampIndex(idx: number | undefined, len: number): number | null {
  if (idx === undefined || idx === null) return null;
  if (!Number.isFinite(idx)) return null;
  if (idx < 0 || idx >= len) return null;
  return Math.floor(idx);
}
