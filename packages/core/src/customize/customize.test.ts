import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseFrontmatter, stringifyFrontmatter } from './frontmatter.js';
import { matchSubagent, renderDirectives } from './compose.js';
import {
  deleteRule,
  loadRules,
  loadSkills,
  loadSubagents,
  slugify,
  writeRule,
  writeSkill,
  writeSubagent,
} from './store.js';
import type { Rule, Skill } from './types.js';

describe('frontmatter', () => {
  it('parses scalars, booleans, and block arrays', () => {
    const { data, body } = parseFrontmatter(
      '---\ndescription: TS style\nalwaysApply: true\nglobs:\n  - "src/**/*.ts"\n  - "*.tsx"\n---\nUse tabs.\n',
    );
    expect(data.description).toBe('TS style');
    expect(data.alwaysApply).toBe(true);
    expect(data.globs).toEqual(['src/**/*.ts', '*.tsx']);
    expect(body.trim()).toBe('Use tabs.');
  });

  it('parses inline arrays', () => {
    const { data } = parseFrontmatter('---\nglobs: ["a.ts", "b.ts"]\n---\nx');
    expect(data.globs).toEqual(['a.ts', 'b.ts']);
  });

  it('returns the whole doc as body when there is no frontmatter', () => {
    const { data, body } = parseFrontmatter('just text\nmore');
    expect(data).toEqual({});
    expect(body).toBe('just text\nmore');
  });

  it('round-trips through stringify', () => {
    const out = stringifyFrontmatter({ name: 'X', alwaysApply: true, globs: ['*.ts'] }, 'Body here');
    const { data, body } = parseFrontmatter(out);
    expect(data.name).toBe('X');
    expect(data.alwaysApply).toBe(true);
    expect(data.globs).toEqual(['*.ts']);
    expect(body.trim()).toBe('Body here');
  });
});

describe('slugify', () => {
  it('produces filesystem-safe slugs', () => {
    expect(slugify('Test Author!')).toBe('test-author');
    expect(slugify('  Hello   World  ')).toBe('hello-world');
    expect(slugify('***')).toBe('untitled');
  });
});

describe('store (project + global scopes)', () => {
  let tmp: string;
  let cwd: string;
  let prevHome: string | undefined;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'cr-customize-'));
    cwd = join(tmp, 'proj');
    // Redirect the global scope (~/.coderouter) into the temp dir so
    // the test never touches the developer's real home directory.
    prevHome = process.env.HOME;
    process.env.HOME = join(tmp, 'home');
  });

  afterEach(async () => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    await rm(tmp, { recursive: true, force: true });
  });

  it('writes and reads a project rule', async () => {
    await writeRule(cwd, { scope: 'project', id: 'ts style', description: 'd', globs: ['*.ts'], alwaysApply: true, body: 'tabs' });
    const rules = await loadRules(cwd);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ id: 'ts-style', scope: 'project', alwaysApply: true, globs: ['*.ts'] });
    expect(rules[0]!.body).toBe('tabs');
  });

  it('project rules override global rules of the same id', async () => {
    await writeRule(cwd, { scope: 'global', id: 'style', body: 'GLOBAL', alwaysApply: true });
    await writeRule(cwd, { scope: 'project', id: 'style', body: 'PROJECT', alwaysApply: true });
    await writeRule(cwd, { scope: 'global', id: 'only-global', body: 'g2' });
    const rules = await loadRules(cwd);
    const style = rules.find((r) => r.id === 'style')!;
    expect(style.scope).toBe('project');
    expect(style.body).toBe('PROJECT');
    // Global-only rule still surfaces.
    expect(rules.some((r) => r.id === 'only-global' && r.scope === 'global')).toBe(true);
  });

  it('deletes a rule', async () => {
    await writeRule(cwd, { scope: 'project', id: 'gone', body: 'x' });
    expect(await loadRules(cwd)).toHaveLength(1);
    await deleteRule(cwd, 'project', 'gone');
    expect(await loadRules(cwd)).toHaveLength(0);
  });

  it('writes and reads skills (SKILL.md per slug)', async () => {
    const skill = await writeSkill(cwd, { scope: 'project', name: 'DB Migrations', description: 'run migrations', body: 'steps' });
    expect(skill.slug).toBe('db-migrations');
    const skills = await loadSkills(cwd);
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ name: 'DB Migrations', description: 'run migrations' });
    const raw = await readFile(skills[0]!.path, 'utf8');
    expect(raw).toContain('name: DB Migrations');
  });

  it('writes and reads subagents with pinned model + effort', async () => {
    await writeSubagent(cwd, {
      scope: 'project',
      name: 'Test Author',
      description: 'writes tests',
      kind: 'test',
      provider: 'openrouter_agent',
      model: 'anthropic/claude-sonnet-4-5',
      effort: 'low',
      body: 'be thorough',
    });
    const subs = await loadSubagents(cwd);
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({
      name: 'Test Author',
      kind: 'test',
      provider: 'openrouter_agent',
      model: 'anthropic/claude-sonnet-4-5',
      effort: 'low',
    });
  });
});

describe('renderDirectives', () => {
  const rule = (over: Partial<Rule>): Rule => ({
    id: 'r', scope: 'project', path: '/r.md', description: '', globs: [], alwaysApply: false, body: 'body', ...over,
  });
  const skill = (over: Partial<Skill>): Skill => ({
    slug: 's', scope: 'project', path: '/s/SKILL.md', name: 'S', description: 'desc', body: 'b', ...over,
  });

  it('injects always-apply rules verbatim', () => {
    const out = renderDirectives([rule({ alwaysApply: true, description: 'Always', body: 'X' })], []);
    expect(out).toContain('always apply');
    expect(out).toContain('Always');
    expect(out).toContain('X');
  });

  it('lists glob-scoped rules as conditional', () => {
    const out = renderDirectives([rule({ globs: ['*.ts'], description: 'TS' })], []);
    expect(out).toContain('Conditional rules');
    expect(out).toContain('globs: *.ts');
  });

  it('lists skills with their path', () => {
    const out = renderDirectives([], [skill({ name: 'Migrate', description: 'd', path: '/x/SKILL.md' })]);
    expect(out).toContain('Available skills');
    expect(out).toContain('Migrate');
    expect(out).toContain('/x/SKILL.md');
  });

  it('returns empty string with no assets', () => {
    expect(renderDirectives([], [])).toBe('');
  });
});

describe('matchSubagent', () => {
  const sub = (over: Partial<import('./types.js').Subagent>) => ({
    slug: 's', scope: 'project' as const, path: '/s.md', name: 'N', description: '', body: '', ...over,
  });

  it('matches by explicit name first', () => {
    const list = [sub({ name: 'Tester', kind: 'docs' }), sub({ name: 'Docs', kind: 'test' })];
    expect(matchSubagent(list, { name: 'docs' })!.name).toBe('Docs');
  });

  it('falls back to kind match', () => {
    const list = [sub({ name: 'Tester', kind: 'test' })];
    expect(matchSubagent(list, { kind: 'test' })!.name).toBe('Tester');
  });

  it('returns null when nothing matches', () => {
    expect(matchSubagent([sub({ kind: 'docs' })], { kind: 'test' })).toBeNull();
  });
});
