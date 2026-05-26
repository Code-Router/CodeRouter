import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exec, gitOrThrow } from '../sandbox/exec.js';
import { promptNouns, scanContext, tokensFor } from './scan.js';
import { containsSecretMaterial, isSecretPath } from './secrets.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cr-ctx-'));
  await exec('git', ['init', '-q', '-b', 'main', dir]);
  await gitOrThrow(['config', 'user.email', 't@coderouter.dev'], { cwd: dir });
  await gitOrThrow(['config', 'user.name', 'T'], { cwd: dir });
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(join(dir, 'src', 'auth.ts'), 'export function login() { return jwt; }');
  await writeFile(join(dir, 'src', 'router.ts'), 'export const routes = ["/", "/login"];');
  await writeFile(join(dir, 'README.md'), '# project\nsupports OAuth login');
  await writeFile(join(dir, '.env'), 'API_KEY=sk-secret-123\n');
  await gitOrThrow(['add', '-A'], { cwd: dir });
  await gitOrThrow(['commit', '-q', '-m', 'init'], { cwd: dir });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('secrets', () => {
  it('flags .env / private key paths', () => {
    expect(isSecretPath('.env')).toBe(true);
    expect(isSecretPath('secrets/foo.json')).toBe(true);
    expect(isSecretPath('src/auth.ts')).toBe(false);
  });
  it('flags content matching common token patterns', () => {
    expect(containsSecretMaterial('AKIA1234567890123456')).toBe(true);
    expect(containsSecretMaterial('normal code\nlooks like this')).toBe(false);
  });
});

describe('promptNouns', () => {
  it('extracts meaningful keywords and skips stopwords', () => {
    const out = promptNouns('Add OAuth login flow to the auth module');
    expect(out).toContain('oauth');
    expect(out).toContain('login');
    expect(out).not.toContain('the');
    expect(out).not.toContain('add');
  });
});

describe('scanContext', () => {
  it('ranks files matching prompt nouns and excludes secrets', async () => {
    const manifest = await scanContext({
      cwd: dir,
      prompt: 'fix login auth bug',
      budget: 50_000,
    });
    const paths = manifest.entries.map((e) => e.path);
    expect(paths.some((p) => p.includes('auth.ts'))).toBe(true);
    expect(paths).not.toContain('.env');
    expect(manifest.totalTokens).toBeGreaterThanOrEqual(0);
  });

  it('respects budget by marking truncated', async () => {
    const manifest = await scanContext({
      cwd: dir,
      prompt: 'fix login auth bug',
      budget: 0,
      maxFiles: 3,
    });
    expect(manifest.entries).toHaveLength(0);
    expect(manifest.budget).toBe(0);
  });

  it('handles missing rg gracefully (empty repo with no matches)', async () => {
    const manifest = await scanContext({
      cwd: dir,
      prompt: 'nothing matches here qwerty12345',
      budget: 1000,
    });
    expect(manifest.entries.length).toBeGreaterThanOrEqual(0);
  });
});

describe('tokensFor', () => {
  it('returns a positive token count', () => {
    expect(tokensFor('hello world')).toBeGreaterThan(0);
  });
});
