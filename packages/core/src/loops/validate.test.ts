import { describe, expect, it } from 'vitest';
import { applyPreset } from './presets.js';
import type { LoopSpec } from './types.js';
import { validateLoopSpec } from './validate.js';

function baseSpec(overrides: Partial<LoopSpec> = {}): LoopSpec {
  return {
    name: 'fix-tests',
    goal: 'Fix the failing auth tests with minimal safe code changes.',
    assumptions: [],
    verifier: { commands: ['npm test'], successCondition: 'all exit 0' },
    steps: [],
    models: { planner: 'strong', executor: 'coding', reviewer: 'strong', summarizer: 'cheap' },
    limits: { maxIterations: 6, maxCostUsd: 2.5, maxFilesChanged: 6 },
    safety: { requireApprovalBeforeCommit: true, blockedFiles: ['.env'], allowedPaths: [], allowNetwork: false },
    onSuccess: 'report',
    onFailure: 'report',
    ...overrides,
  };
}

describe('validateLoopSpec', () => {
  it('accepts a complete, bounded spec', () => {
    const v = validateLoopSpec(baseSpec());
    expect(v.valid).toBe(true);
    expect(v.issues).toHaveLength(0);
  });

  it('rejects a spec with no verifier', () => {
    const v = validateLoopSpec(baseSpec({ verifier: { commands: [], successCondition: '' } }));
    expect(v.valid).toBe(false);
    expect(v.issues.join(' ')).toMatch(/verifier/i);
  });

  it('rejects a vague goal', () => {
    const v = validateLoopSpec(baseSpec({ goal: 'improve the app' }));
    expect(v.valid).toBe(false);
    expect(v.issues.join(' ')).toMatch(/broad|vague/i);
  });

  it('rejects missing caps', () => {
    const v = validateLoopSpec(baseSpec({ limits: { maxIterations: 0, maxCostUsd: 0, maxFilesChanged: 0 } }));
    expect(v.valid).toBe(false);
    expect(v.issues.length).toBeGreaterThanOrEqual(3);
  });

  it('rejects dangerous verifier commands', () => {
    const v = validateLoopSpec(baseSpec({ verifier: { commands: ['rm -rf /'], successCondition: 'x' } }));
    expect(v.valid).toBe(false);
    expect(v.issues.join(' ')).toMatch(/dangerous/i);
  });

  it('warns when committing without approval', () => {
    const v = validateLoopSpec(
      baseSpec({ safety: { requireApprovalBeforeCommit: false, blockedFiles: ['.env'], allowedPaths: [], allowNetwork: false } }),
    );
    expect(v.warnings.join(' ')).toMatch(/without human approval/i);
  });
});

describe('applyPreset', () => {
  it('clamps limits to the safe preset and merges blocked files', () => {
    const spec = applyPreset(
      baseSpec({ limits: { maxIterations: 99, maxCostUsd: 999, maxFilesChanged: 999 } }),
      'safe',
    );
    expect(spec.limits.maxIterations).toBeLessThanOrEqual(6);
    expect(spec.limits.maxCostUsd).toBeLessThanOrEqual(2.5);
    expect(spec.safety.blockedFiles).toContain('package-lock.json');
    expect(spec.preset).toBe('safe');
  });
});
