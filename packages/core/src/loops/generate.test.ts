import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProviderRegistry } from '../providers/index.js';
import { generateLoopSpec, slugify } from './generate.js';
import { validateLoopSpec } from './validate.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cr-gen-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('generateLoopSpec (fallback, no providers)', () => {
  it('builds a bounded spec from discovered verifier commands', async () => {
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ scripts: { test: 'vitest run', lint: 'biome check' } }),
    );
    const registry = new ProviderRegistry([]);
    const out = await generateLoopSpec('fix the failing tests', { registry, router: { registry }, cwd: dir });
    expect(out.generated).toBe(false); // no model -> fallback
    expect(out.spec.verifier.commands).toContain('npm run test');
    expect(out.spec.limits.maxIterations).toBeGreaterThan(0);
    expect(out.spec.safety.requireApprovalBeforeCommit).toBe(true);
    // Safe preset clamps + protects lockfiles.
    expect(out.spec.safety.blockedFiles).toContain('package-lock.json');
    const v = validateLoopSpec(out.spec);
    expect(v.valid).toBe(true);
  });

  it('honors explicit verifier commands when provided', async () => {
    const registry = new ProviderRegistry([]);
    const out = await generateLoopSpec('make pytest pass', { registry, router: { registry }, cwd: dir }, {
      verifierCommands: ['pytest -q'],
    });
    expect(out.spec.verifier.commands).toEqual(['pytest -q']);
  });
});

describe('slugify', () => {
  it('produces a safe loop name', () => {
    expect(slugify('Fix the Auth Tests!!!')).toBe('fix-the-auth-tests');
    expect(slugify('')).toBe('loop');
  });
});
