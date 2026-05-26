import { describe, expect, it } from 'vitest';
import type { RouteRef, RunBudget, ValidatorResult } from '../types.js';
import { buildBrief, renderBriefAsPrompt } from './brief.js';

const fromRoute: RouteRef = { provider: 'openai', model: 'gpt-5', rationale: '' };
const toRoute: RouteRef = { provider: 'anthropic', model: 'claude-3-5-haiku-latest', rationale: '' };
const budget: RunBudget = { maxCostUsd: 1, maxDurationMs: 60_000, maxHandoffPasses: 1, maxContenders: 1 };

const validators: ValidatorResult[] = [
  {
    name: 'lint',
    command: 'biome',
    status: 'fail',
    durationMs: 1,
    failures: [
      { file: 'src/foo.ts', line: 12, message: 'unused var', rule: 'noUnusedVars', severity: 'error' },
      { file: 'src/foo.ts', line: 15, message: 'soft', severity: 'warning' },
      { file: 'src/bar.ts', line: 1, message: 'parser', severity: 'error' },
    ],
  },
];

describe('buildBrief', () => {
  it('derives scope from failure file list and filters to errors', () => {
    const brief = buildBrief({
      intent: 'fix lint errors',
      originalPrompt: 'p',
      fromRoute,
      toRoute,
      reason: 'lint failed',
      validators,
      budget,
    });
    expect(brief.scopeFiles.sort()).toEqual(['src/bar.ts', 'src/foo.ts']);
    expect(brief.failures.every((f) => f.severity === 'error')).toBe(true);
    expect(brief.failures).toHaveLength(2);
  });

  it('inherits forbiddenPatterns from memory bias', () => {
    const brief = buildBrief({
      intent: 'fix lint',
      originalPrompt: 'p',
      fromRoute,
      toRoute,
      reason: '',
      validators: [],
      budget,
      forbiddenPatterns: ['migrations/**'],
      memoryForbidden: ['legacy/*'],
    });
    expect(brief.forbiddenPatterns).toContain('migrations/**');
    expect(brief.forbiddenPatterns).toContain('legacy/*');
  });
});

describe('renderBriefAsPrompt', () => {
  it('emits a model-readable directive', () => {
    const brief = buildBrief({
      intent: 'fix lint',
      originalPrompt: 'p',
      fromRoute,
      toRoute,
      reason: 'lint failed',
      validators,
      priorDiff: 'diff body',
      budget,
      forbiddenPatterns: ['migrations/**'],
    });
    const text = renderBriefAsPrompt(brief);
    expect(text).toContain('# Handoff Brief');
    expect(text).toContain('Validator failures');
    expect(text).toContain('FORBIDDEN');
    expect(text).toContain('Prior diff');
  });
});
