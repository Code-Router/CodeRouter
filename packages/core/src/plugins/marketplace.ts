import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { coderouterHome, ensureRepo, showFile } from './gitcache.js';
import type { LoadedMarketplace, Marketplace, Plugin, PluginSource } from './types.js';

/** Anthropic's two default marketplaces — the whole public ecosystem. */
export const DEFAULT_MARKETPLACES: Marketplace[] = [
  { name: 'claude-plugins-official', repo: 'anthropics/claude-plugins-official', source: 'builtin' },
  { name: 'claude-community', repo: 'anthropics/claude-plugins-community', source: 'builtin' },
];

const MARKETPLACE_JSON = '.claude-plugin/marketplace.json';

function registryPath(): string {
  return join(coderouterHome(), 'marketplaces.json');
}

type Registry = { marketplaces: Array<{ name: string; repo: string }> };

async function readRegistry(): Promise<Registry> {
  try {
    const raw = await readFile(registryPath(), 'utf8');
    const parsed = JSON.parse(raw) as Registry;
    return { marketplaces: Array.isArray(parsed.marketplaces) ? parsed.marketplaces : [] };
  } catch {
    return { marketplaces: [] };
  }
}

async function writeRegistry(reg: Registry): Promise<void> {
  await mkdir(coderouterHome(), { recursive: true });
  await writeFile(registryPath(), `${JSON.stringify(reg, null, 2)}\n`, 'utf8');
}

/** Default marketplaces + user-registered ones (deduped by name). */
export async function listMarketplaces(): Promise<Marketplace[]> {
  const reg = await readRegistry();
  const seen = new Set(DEFAULT_MARKETPLACES.map((m) => m.name));
  const user: Marketplace[] = [];
  for (const m of reg.marketplaces) {
    if (seen.has(m.name)) continue;
    seen.add(m.name);
    user.push({ name: m.name, repo: m.repo, source: 'user' });
  }
  return [...DEFAULT_MARKETPLACES, ...user];
}

export async function addMarketplace(repo: string, name?: string): Promise<Marketplace> {
  const clean = repo.trim();
  if (!clean) throw new Error('repo required');
  const fallbackName = name?.trim() || clean.replace(/^.*\//, '').replace(/\.git$/i, '');
  const reg = await readRegistry();
  if (!reg.marketplaces.some((m) => m.repo === clean || m.name === fallbackName)) {
    reg.marketplaces.push({ name: fallbackName, repo: clean });
    await writeRegistry(reg);
  }
  return { name: fallbackName, repo: clean, source: 'user' };
}

export async function removeMarketplace(name: string): Promise<boolean> {
  if (DEFAULT_MARKETPLACES.some((m) => m.name === name)) return false;
  const reg = await readRegistry();
  const before = reg.marketplaces.length;
  reg.marketplaces = reg.marketplaces.filter((m) => m.name !== name);
  if (reg.marketplaces.length === before) return false;
  await writeRegistry(reg);
  return true;
}

/** Clone/read a marketplace's `marketplace.json` and parse its plugins. */
export async function loadMarketplace(
  mp: Marketplace,
  opts: { refresh?: boolean } = {},
): Promise<LoadedMarketplace> {
  try {
    const dir = await ensureRepo(mp.repo, { refresh: opts.refresh });
    const raw = await showFile(dir, MARKETPLACE_JSON);
    if (!raw) {
      return { ...mp, plugins: [], error: `no ${MARKETPLACE_JSON} in ${mp.repo}` };
    }
    const json = JSON.parse(raw) as {
      name?: string;
      owner?: { name?: string };
      plugins?: unknown[];
    };
    const name = typeof json.name === 'string' ? json.name : mp.name;
    const owner = json.owner?.name;
    const entries = Array.isArray(json.plugins) ? json.plugins : [];
    const plugins: Plugin[] = [];
    for (const e of entries) {
      const p = parseEntry(name, mp.repo, e as Record<string, unknown>);
      if (p) plugins.push(p);
    }
    return { ...mp, name, owner, plugins };
  } catch (e) {
    return { ...mp, plugins: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export async function loadAllMarketplaces(
  opts: { refresh?: boolean } = {},
): Promise<LoadedMarketplace[]> {
  const mps = await listMarketplaces();
  return Promise.all(mps.map((m) => loadMarketplace(m, opts)));
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];
}

/** Coerce one raw `marketplace.json` plugin entry into a catalog `Plugin`. */
export function parseEntry(
  marketplace: string,
  marketplaceRepo: string,
  o: Record<string, unknown>,
): Plugin | null {
  if (!o || typeof o !== 'object') return null;
  const id = str(o.name);
  if (!id || o.source == null) return null;
  const authorObj = o.author as { name?: string } | undefined;
  return {
    id,
    name: str(o.displayName) || id,
    description: str(o.description),
    author: authorObj?.name ? String(authorObj.name) : undefined,
    category: str(o.category) || undefined,
    tags: [...strArray(o.tags), ...strArray(o.keywords)],
    homepage: str(o.homepage) || undefined,
    marketplace,
    marketplaceRepo,
    source: o.source as PluginSource,
    strict: o.strict !== false,
    skillPaths: strArray(o.skills),
    agentPaths: strArray(o.agents),
  };
}
