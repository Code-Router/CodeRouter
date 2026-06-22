import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverVerifiers } from './discover.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cr-discover-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('discoverVerifiers', () => {
  it('detects node test/lint/typecheck scripts and the package manager', async () => {
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ scripts: { test: 'vitest', lint: 'biome check', typecheck: 'tsc --noEmit' } }),
    );
    await writeFile(join(dir, 'pnpm-lock.yaml'), '');
    const out = await discoverVerifiers(dir);
    expect(out.ecosystem).toBe('node');
    expect(out.packageManager).toBe('pnpm');
    const kinds = out.commands.map((c) => c.kind);
    expect(kinds).toContain('test');
    expect(kinds).toContain('lint');
    expect(kinds).toContain('typecheck');
    expect(out.commands.find((c) => c.kind === 'test')?.command).toBe('pnpm test');
  });

  it('detects rust projects', async () => {
    await writeFile(join(dir, 'Cargo.toml'), '[package]\nname = "x"\n');
    const out = await discoverVerifiers(dir);
    expect(out.ecosystem).toBe('rust');
    expect(out.commands.map((c) => c.command)).toContain('cargo test');
  });

  it('detects go modules', async () => {
    await writeFile(join(dir, 'go.mod'), 'module x\n');
    const out = await discoverVerifiers(dir);
    expect(out.ecosystem).toBe('go');
    expect(out.commands.map((c) => c.command)).toContain('go test ./...');
  });

  it('detects python via pyproject + tests dir', async () => {
    await writeFile(join(dir, 'pyproject.toml'), '[tool.ruff]\n[tool.mypy]\n');
    await mkdir(join(dir, 'tests'));
    const out = await discoverVerifiers(dir);
    expect(out.ecosystem).toBe('python');
    const cmds = out.commands.map((c) => c.command);
    expect(cmds).toContain('pytest');
    expect(cmds).toContain('ruff check .');
    expect(cmds).toContain('mypy .');
  });

  it('returns unknown with no commands for an empty dir', async () => {
    const out = await discoverVerifiers(dir);
    expect(out.ecosystem).toBe('unknown');
    expect(out.commands).toHaveLength(0);
  });
});
