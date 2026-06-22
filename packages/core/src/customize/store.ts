import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Effort } from '../types.js';
import { parseFrontmatter, stringifyFrontmatter, type Frontmatter } from './frontmatter.js';
import type { AssetScope, Rule, Skill, Subagent } from './types.js';

/** Root directory for a given scope. */
export function scopeRoot(scope: AssetScope, cwd: string): string {
  return scope === 'project' ? join(cwd, '.coderouter') : join(homedir(), '.coderouter');
}

const VALID_EFFORTS: ReadonlySet<string> = new Set(['low', 'medium', 'high', 'max']);

/** Filesystem-safe slug from a free-text name. */
export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'untitled';
}

// ---------------------------------------------------------------------------
// Rules — `<root>/rules/*.md`
// ---------------------------------------------------------------------------

export async function loadRules(cwd: string): Promise<Rule[]> {
  return mergeByKey(
    [...(await readRuleDir('global', cwd)), ...(await readRuleDir('project', cwd))],
    (r) => r.id,
  );
}

async function readRuleDir(scope: AssetScope, cwd: string): Promise<Rule[]> {
  const dir = join(scopeRoot(scope, cwd), 'rules');
  const files = await listMarkdown(dir);
  const out: Rule[] = [];
  for (const file of files) {
    const path = join(dir, file);
    const raw = await safeRead(path);
    if (raw == null) continue;
    const { data, body } = parseFrontmatter(raw);
    out.push({
      id: file.replace(/\.md$/i, ''),
      scope,
      path,
      description: asString(data.description),
      globs: asStringArray(data.globs),
      alwaysApply: asBool(data.alwaysApply),
      body: body.trim(),
    });
  }
  return out;
}

export async function writeRule(
  cwd: string,
  input: {
    scope: AssetScope;
    id: string;
    description?: string;
    globs?: string[];
    alwaysApply?: boolean;
    body: string;
  },
): Promise<Rule> {
  const id = slugify(input.id);
  const dir = join(scopeRoot(input.scope, cwd), 'rules');
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${id}.md`);
  const data: Frontmatter = {};
  if (input.description) data.description = input.description;
  if (input.globs && input.globs.length) data.globs = input.globs;
  if (input.alwaysApply) data.alwaysApply = true;
  await writeFile(path, stringifyFrontmatter(data, input.body), 'utf8');
  return {
    id,
    scope: input.scope,
    path,
    description: input.description ?? '',
    globs: input.globs ?? [],
    alwaysApply: Boolean(input.alwaysApply),
    body: input.body.trim(),
  };
}

export async function deleteRule(cwd: string, scope: AssetScope, id: string): Promise<void> {
  await rm(join(scopeRoot(scope, cwd), 'rules', `${slugify(id)}.md`), { force: true });
}

// ---------------------------------------------------------------------------
// Skills — `<root>/skills/<slug>/SKILL.md`
// ---------------------------------------------------------------------------

export async function loadSkills(cwd: string): Promise<Skill[]> {
  return mergeByKey(
    [...(await readSkillDir('global', cwd)), ...(await readSkillDir('project', cwd))],
    (s) => s.slug,
  );
}

async function readSkillDir(scope: AssetScope, cwd: string): Promise<Skill[]> {
  const dir = join(scopeRoot(scope, cwd), 'skills');
  const slugs = await listDirs(dir);
  const out: Skill[] = [];
  for (const slug of slugs) {
    const path = join(dir, slug, 'SKILL.md');
    const raw = await safeRead(path);
    if (raw == null) continue;
    const { data, body } = parseFrontmatter(raw);
    out.push({
      slug,
      scope,
      path,
      name: asString(data.name) || slug,
      description: asString(data.description),
      body: body.trim(),
    });
  }
  return out;
}

export async function writeSkill(
  cwd: string,
  input: { scope: AssetScope; name: string; description?: string; body: string; slug?: string },
): Promise<Skill> {
  const slug = slugify(input.slug ?? input.name);
  const dir = join(scopeRoot(input.scope, cwd), 'skills', slug);
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'SKILL.md');
  const data: Frontmatter = { name: input.name };
  if (input.description) data.description = input.description;
  await writeFile(path, stringifyFrontmatter(data, input.body), 'utf8');
  return {
    slug,
    scope: input.scope,
    path,
    name: input.name,
    description: input.description ?? '',
    body: input.body.trim(),
  };
}

export async function deleteSkill(cwd: string, scope: AssetScope, slug: string): Promise<void> {
  await rm(join(scopeRoot(scope, cwd), 'skills', slugify(slug)), { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Subagents — `<root>/subagents/*.md`
// ---------------------------------------------------------------------------

export async function loadSubagents(cwd: string): Promise<Subagent[]> {
  return mergeByKey(
    [...(await readSubagentDir('global', cwd)), ...(await readSubagentDir('project', cwd))],
    (s) => s.slug,
  );
}

async function readSubagentDir(scope: AssetScope, cwd: string): Promise<Subagent[]> {
  const dir = join(scopeRoot(scope, cwd), 'subagents');
  const files = await listMarkdown(dir);
  const out: Subagent[] = [];
  for (const file of files) {
    const path = join(dir, file);
    const raw = await safeRead(path);
    if (raw == null) continue;
    const { data, body } = parseFrontmatter(raw);
    const slug = file.replace(/\.md$/i, '');
    out.push({
      slug,
      scope,
      path,
      name: asString(data.name) || slug,
      description: asString(data.description),
      kind: asString(data.kind) || undefined,
      provider: asString(data.provider) || undefined,
      model: asString(data.model) || undefined,
      effort: asEffort(data.effort),
      body: body.trim(),
    });
  }
  return out;
}

export async function writeSubagent(
  cwd: string,
  input: {
    scope: AssetScope;
    name: string;
    description?: string;
    kind?: string;
    provider?: string;
    model?: string;
    effort?: Effort;
    body: string;
    slug?: string;
  },
): Promise<Subagent> {
  const slug = slugify(input.slug ?? input.name);
  const dir = join(scopeRoot(input.scope, cwd), 'subagents');
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${slug}.md`);
  const data: Frontmatter = { name: input.name };
  if (input.description) data.description = input.description;
  if (input.kind) data.kind = input.kind;
  if (input.provider) data.provider = input.provider;
  if (input.model) data.model = input.model;
  if (input.effort) data.effort = input.effort;
  await writeFile(path, stringifyFrontmatter(data, input.body), 'utf8');
  return {
    slug,
    scope: input.scope,
    path,
    name: input.name,
    description: input.description ?? '',
    kind: input.kind,
    provider: input.provider,
    model: input.model,
    effort: input.effort,
    body: input.body.trim(),
  };
}

export async function deleteSubagent(cwd: string, scope: AssetScope, slug: string): Promise<void> {
  await rm(join(scopeRoot(scope, cwd), 'subagents', `${slugify(slug)}.md`), { force: true });
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

/** Project entries override global entries sharing the same key. */
function mergeByKey<T extends { scope: AssetScope }>(items: T[], keyOf: (t: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) {
    // `items` is global-first then project, so project writes last and wins.
    byKey.set(keyOf(item), item);
  }
  return [...byKey.values()].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
}

async function listMarkdown(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && /\.md$/i.test(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

async function listDirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

async function safeRead(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  if (typeof v === 'string' && v.trim()) return v.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

function asBool(v: unknown): boolean {
  return v === true || v === 'true';
}

function asEffort(v: unknown): Effort | undefined {
  return typeof v === 'string' && VALID_EFFORTS.has(v) ? (v as Effort) : undefined;
}
