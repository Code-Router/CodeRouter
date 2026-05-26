import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadProjectMemory, projectMemoryToSystemPrompt } from './projectMemory.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cr-mem-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('loadProjectMemory', () => {
  it('returns empty when no memory files exist', async () => {
    const m = await loadProjectMemory(dir);
    expect(m.fragments).toEqual([]);
    expect(m.text).toBe('');
    expect(m.facts).toEqual([]);
  });

  it('prioritizes AGENTS.md over CLAUDE.md', async () => {
    await writeFile(join(dir, 'AGENTS.md'), 'Use pnpm. Run vitest.\n');
    await writeFile(join(dir, 'CLAUDE.md'), 'Use yarn.\n');
    const m = await loadProjectMemory(dir);
    expect(m.fragments[0]?.source).toBe('AGENTS.md');
    expect(m.fragments[1]?.source).toBe('CLAUDE.md');
    const pm = m.facts.find((f) => f.key === 'package-manager');
    expect(pm?.value).toBe('pnpm');
  });

  it('reads .cursor/rules glob', async () => {
    await mkdir(join(dir, '.cursor', 'rules'), { recursive: true });
    await writeFile(join(dir, '.cursor', 'rules', '01-style.md'), 'Use TypeScript strict mode.\n');
    const m = await loadProjectMemory(dir);
    expect(m.fragments.some((f) => f.source === 'cursor-rule')).toBe(true);
  });

  it('extracts test framework, pkg manager, linter, language', async () => {
    await writeFile(
      join(dir, 'AGENTS.md'),
      'This project uses TypeScript with pnpm. Run vitest for tests and biome for lint.',
    );
    const m = await loadProjectMemory(dir);
    const keys = m.facts.map((f) => f.key).sort();
    expect(keys).toEqual(expect.arrayContaining(['package-manager', 'test-framework', 'linter']));
  });

  it('emits a system-prompt-friendly summary', async () => {
    await writeFile(join(dir, 'AGENTS.md'), 'Use vitest, pnpm.\n');
    const m = await loadProjectMemory(dir);
    expect(projectMemoryToSystemPrompt(m)).toContain('Project memory');
  });
});
