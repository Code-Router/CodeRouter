import type { RouteRef, RunBudget, ValidatorFailure, ValidatorResult } from '../types.js';

/**
 * L4 - HandoffBrief.
 *
 * The structured envelope CodeRouter passes between agents when it
 * delegates a piece of work. Used by:
 *
 *   - The handoff-fix workflow (delegate residual failures to a cheap fixer)
 *   - The handoff-review workflow (post-write second opinion from a strong model)
 *   - The tournament workflow (identical brief sent to N contenders)
 *
 * The brief is deliberately small and structured so even cheap models
 * can stay on-task without ballooning context windows.
 */
export type HandoffBrief = {
  /** Plain-language description of the work to do. */
  intent: string;
  /** Original prompt that started the run. */
  originalPrompt: string;
  /** Files the receiving agent is allowed to touch. Empty = any file. */
  scopeFiles: string[];
  /** File/path patterns the agent must not touch. */
  forbiddenPatterns: string[];
  /** Validator failures the agent should address (sourced from earlier validators). */
  failures: ValidatorFailure[];
  /** Most recent diff applied by the previous agent (so the fixer sees what changed). */
  priorDiff?: string;
  /** Cost / time budget for this handoff. */
  budget: RunBudget;
  /** Route that produced the brief. */
  fromRoute: RouteRef;
  /** Route receiving the brief. */
  toRoute: RouteRef;
  /** Reason this handoff was issued. */
  reason: string;
};

export type BuildBriefArgs = {
  intent: string;
  originalPrompt: string;
  fromRoute: RouteRef;
  toRoute: RouteRef;
  reason: string;
  validators: ValidatorResult[];
  priorDiff?: string;
  scopeFiles?: string[];
  forbiddenPatterns?: string[];
  budget: RunBudget;
  /** Failure patterns harvested from L5 (project-scoped). */
  memoryForbidden?: string[];
};

/**
 * Builds a `HandoffBrief` from run state + persistent-memory failure
 * patterns. Failures coming out of validators are filtered down to the
 * smallest set the receiving agent needs (top 10 errors, no warnings).
 *
 * The scope-files list comes from changed files in the prior diff when
 * not provided explicitly - this is what handoff-fix does to keep the
 * fixer focused on the previous agent's footprint.
 */
export function buildBrief(args: BuildBriefArgs): HandoffBrief {
  const failures = (args.validators ?? [])
    .flatMap((v) => v.failures)
    .filter((f) => f.severity === 'error')
    .slice(0, 10);

  const scopeFiles = args.scopeFiles ?? deriveScopeFromValidators(args.validators);
  const forbiddenPatterns = [
    ...(args.forbiddenPatterns ?? []),
    ...(args.memoryForbidden ?? []),
  ];

  return {
    intent: args.intent,
    originalPrompt: args.originalPrompt,
    scopeFiles: dedupe(scopeFiles),
    forbiddenPatterns: dedupe(forbiddenPatterns),
    failures,
    priorDiff: args.priorDiff,
    budget: args.budget,
    fromRoute: args.fromRoute,
    toRoute: args.toRoute,
    reason: args.reason,
  };
}

/**
 * Renders the brief as a focused, model-readable prompt. Used by every
 * handoff-aware adapter (codex, claude_code, anthropic, openai).
 *
 * The output is intentionally short - shell agents will fall back to
 * reading files when needed, so we want the brief to be a high-signal
 * directive, not a sprawl of context.
 */
export function renderBriefAsPrompt(brief: HandoffBrief): string {
  const lines: string[] = [];
  lines.push('# Handoff Brief');
  lines.push(`Intent: ${brief.intent}`);
  lines.push(`Reason: ${brief.reason}`);
  lines.push('');
  lines.push(`Original prompt: ${brief.originalPrompt}`);
  if (brief.scopeFiles.length > 0) {
    lines.push('');
    lines.push('Scope (touch ONLY these files unless absolutely necessary):');
    for (const f of brief.scopeFiles) lines.push(`  - ${f}`);
  }
  if (brief.forbiddenPatterns.length > 0) {
    lines.push('');
    lines.push('FORBIDDEN (do not touch matching files):');
    for (const p of brief.forbiddenPatterns) lines.push(`  - ${p}`);
  }
  if (brief.failures.length > 0) {
    lines.push('');
    lines.push('Validator failures to address:');
    for (const f of brief.failures) {
      const loc = f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : '<unknown>';
      const rule = f.rule ? ` [${f.rule}]` : '';
      lines.push(`  - ${loc}${rule}: ${f.message}`);
    }
  }
  if (brief.priorDiff) {
    lines.push('');
    lines.push('Prior diff (DO NOT regress; build on top of these changes):');
    lines.push('```diff');
    lines.push(brief.priorDiff.slice(0, 6_000));
    lines.push('```');
  }
  lines.push('');
  lines.push(
    `Budget: cost <= $${brief.budget.maxCostUsd.toFixed(2)}, duration <= ${brief.budget.maxDurationMs}ms.`,
  );
  return lines.join('\n');
}

function deriveScopeFromValidators(validators: ValidatorResult[] | undefined): string[] {
  if (!validators) return [];
  const out = new Set<string>();
  for (const v of validators) for (const f of v.failures) if (f.file) out.add(f.file);
  return [...out];
}

function dedupe(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}
