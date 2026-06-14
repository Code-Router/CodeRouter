import type { Adapter } from '../adapters/types.js';
import type { ProviderRegistry } from '../providers/registry.js';
import { extractJsonBlock } from '../transformers/tooluse.js';
import type { RouteRef } from '../types.js';

export type DualPlanInput = {
  task: string;
  routes: [RouteRef, RouteRef];
  judgeRoute: RouteRef;
  registry: ProviderRegistry;
  systemPrompt?: string;
  /** Whether to also include the raw plan text alongside the agreement summary. */
  includeRaw?: boolean;
  signal?: AbortSignal;
  /**
   * Working directory for local-CLI planners (Claude Code / Codex
   * require one). Planning is always read-only - the adapters get
   * `readOnly: true` so they can read the repo but never write it.
   */
  cwd?: string;
};

export type DualPlanResult = {
  planA: { route: RouteRef; text: string; costUsd: number; durationMs: number };
  planB: { route: RouteRef; text: string; costUsd: number; durationMs: number };
  /** Agreements + decision points produced by the judge. */
  decision: DualPlanDecision;
  judgeCostUsd: number;
  totalCostUsd: number;
};

export type DualPlanDecision = {
  agreements: string[];
  decisionPoints: {
    title: string;
    description: string;
    optionA: string;
    optionB: string;
    recommendation?: 'A' | 'B' | 'either';
  }[];
  /** Free-form summary the judge wrote when JSON extraction failed. */
  fallbackText?: string;
};

const JUDGE_SYSTEM = `You are a planning judge. Given two implementation plans for the same task, produce a STRICT JSON object with this schema (no prose):
{
  "agreements": ["..."],
  "decisionPoints": [
    {
      "title": "<short>",
      "description": "<1-2 sentences>",
      "optionA": "<plan A's stance>",
      "optionB": "<plan B's stance>",
      "recommendation": "A" | "B" | "either"
    }
  ]
}
Cap agreements at 6 bullets; cap decisionPoints at 4 entries. Avoid restating the plans verbatim.`;

/**
 * Dual-model planning workflow.
 *
 *   1) Run two strong planners in parallel with `adapter.plan()`.
 *   2) Send both outputs to a judge model with a strict-JSON system prompt.
 *   3) Return `{ agreements, decisionPoints[] }` so the user gets a decision UI,
 *      not two walls of text.
 */
export async function runDualPlan(opts: DualPlanInput): Promise<DualPlanResult> {
  const adapterA = resolve(opts.registry, opts.routes[0]);
  const adapterB = resolve(opts.registry, opts.routes[1]);
  const judge = resolve(opts.registry, opts.judgeRoute);

  const planFn = (a: Adapter) =>
    (a.plan ?? a.run).call(a, {
      prompt: opts.task,
      systemPrompt: opts.systemPrompt,
      signal: opts.signal,
      cwd: opts.cwd,
      readOnly: true,
    });

  const [resA, resB] = await Promise.all([planFn(adapterA), planFn(adapterB)]);

  const judgePrompt = [
    'Plan A:',
    '---',
    resA.text.slice(0, 8_000),
    '',
    'Plan B:',
    '---',
    resB.text.slice(0, 8_000),
    '',
    'Produce the JSON object as specified.',
  ].join('\n');

  const judgeRes = await judge.run({
    prompt: judgePrompt,
    systemPrompt: JUDGE_SYSTEM,
    maxTokens: 1_500,
    signal: opts.signal,
    cwd: opts.cwd,
    readOnly: true,
  });

  const parsed = extractJsonBlock<DualPlanDecision>(judgeRes.text);
  const decision: DualPlanDecision = parsed
    ? {
        agreements: Array.isArray(parsed.agreements) ? parsed.agreements.slice(0, 6) : [],
        decisionPoints: Array.isArray(parsed.decisionPoints)
          ? parsed.decisionPoints.slice(0, 4)
          : [],
      }
    : { agreements: [], decisionPoints: [], fallbackText: judgeRes.text };

  return {
    planA: {
      route: opts.routes[0],
      text: opts.includeRaw === false ? '' : resA.text,
      costUsd: resA.costUsd,
      durationMs: resA.durationMs,
    },
    planB: {
      route: opts.routes[1],
      text: opts.includeRaw === false ? '' : resB.text,
      costUsd: resB.costUsd,
      durationMs: resB.durationMs,
    },
    decision,
    judgeCostUsd: judgeRes.costUsd,
    totalCostUsd: resA.costUsd + resB.costUsd + judgeRes.costUsd,
  };
}

function resolve(registry: ProviderRegistry, ref: RouteRef): Adapter {
  const route = `${ref.via ?? ref.provider},${ref.model}`;
  return registry.resolve(route).adapter;
}
