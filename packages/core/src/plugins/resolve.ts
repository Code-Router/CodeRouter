import { parseFrontmatter } from '../customize/frontmatter.js';
import type { Effort } from '../types.js';
import { ensureRepo, lsTree, showFile } from './gitcache.js';
import type {
  Plugin,
  PluginAsset,
  PluginSource,
  ResolvedPlugin,
  SkippedComponents,
} from './types.js';

const VALID_EFFORTS: ReadonlySet<string> = new Set(['low', 'medium', 'high', 'max']);

/** Join path segments with `/`, dropping empties and leading `./`. */
function pjoin(...parts: Array<string | undefined>): string {
  return parts
    .map((p) => (p ?? '').replace(/^\.\//, '').replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
}

/** Determine which repo to clone and the plugin's prefix within it. */
function locate(plugin: Plugin): { repo: string; prefix: string; ref?: string; sha?: string } {
  const s: PluginSource = plugin.source;
  if (typeof s === 'string') {
    return { repo: plugin.marketplaceRepo, prefix: s.replace(/^\.\//, '').replace(/\/+$/, '') };
  }
  const repo = s.repo || s.url || plugin.marketplaceRepo;
  return {
    repo,
    prefix: (s.path ?? '').replace(/^\.\//, '').replace(/\/+$/, ''),
    ref: s.ref,
    sha: s.sha || s.commit,
  };
}

/**
 * Clone (blobless) the plugin's repo and read its `agents/` and
 * `skills/` into CodeRouter assets. Components we don't run yet
 * (commands/hooks/MCP/LSP) are counted but skipped.
 */
export async function resolvePlugin(plugin: Plugin): Promise<ResolvedPlugin> {
  const skipped: SkippedComponents = { commands: 0, hooks: 0, mcpServers: 0, lspServers: 0 };
  try {
    const { repo, prefix, ref } = locate(plugin);
    const dir = await ensureRepo(repo, { ref });

    // Read the plugin manifest, if present, for explicit component paths.
    const manifestRaw = await showFile(dir, pjoin(prefix, '.claude-plugin/plugin.json'));
    let manifest: Record<string, unknown> = {};
    if (manifestRaw) {
      try {
        manifest = JSON.parse(manifestRaw) as Record<string, unknown>;
      } catch {
        /* ignore malformed manifest; fall back to auto-discovery */
      }
    }

    const assets: PluginAsset[] = [];

    // Subagents (Claude `agents/`).
    const agentFiles = await collectAgentFiles(dir, prefix, manifest, plugin);
    for (const file of agentFiles) {
      const a = await readAgent(dir, file);
      if (a) assets.push(a);
    }

    // Skills (Claude `skills/<name>/SKILL.md`).
    const skillFiles = await collectSkillFiles(dir, prefix, manifest, plugin);
    for (const file of skillFiles) {
      const s = await readSkill(dir, file);
      if (s) assets.push(s);
    }

    // Count the components we don't import.
    const cmds = await lsTree(dir, pjoin(prefix, 'commands'));
    skipped.commands = cmds.filter((f) => f.endsWith('.md')).length + arrLen(manifest.commands);
    skipped.hooks =
      (await fileExists(dir, pjoin(prefix, 'hooks/hooks.json'))) || manifest.hooks ? 1 : 0;
    skipped.mcpServers =
      (await fileExists(dir, pjoin(prefix, '.mcp.json'))) || manifest.mcpServers ? 1 : 0;
    skipped.lspServers =
      (await fileExists(dir, pjoin(prefix, '.lsp.json'))) || manifest.lspServers ? 1 : 0;

    return { ...plugin, assets, skipped };
  } catch (e) {
    return { ...plugin, assets: [], skipped, error: e instanceof Error ? e.message : String(e) };
  }
}

function arrLen(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

async function fileExists(dir: string, path: string): Promise<boolean> {
  if (!path) return false;
  return (await showFile(dir, path)) != null;
}

async function collectAgentFiles(
  dir: string,
  prefix: string,
  manifest: Record<string, unknown>,
  plugin: Plugin,
): Promise<string[]> {
  const explicit = manifest.agents ?? (plugin.strict ? undefined : plugin.agentPaths);
  if (Array.isArray(explicit) && explicit.length) {
    const out: string[] = [];
    for (const p of explicit) {
      const full = pjoin(prefix, String(p));
      if (full.endsWith('.md')) out.push(full);
      else out.push(...(await lsTree(dir, full)).filter((f) => f.endsWith('.md')));
    }
    return out;
  }
  return (await lsTree(dir, pjoin(prefix, 'agents'))).filter((f) => f.endsWith('.md'));
}

async function collectSkillFiles(
  dir: string,
  prefix: string,
  manifest: Record<string, unknown>,
  plugin: Plugin,
): Promise<string[]> {
  const explicit = manifest.skills ?? (plugin.strict ? undefined : plugin.skillPaths);
  if (Array.isArray(explicit) && explicit.length) {
    const out: string[] = [];
    for (const p of explicit) {
      const full = pjoin(prefix, String(p));
      if (full.endsWith('SKILL.md')) out.push(full);
      else if (await fileExists(dir, pjoin(full, 'SKILL.md'))) out.push(pjoin(full, 'SKILL.md'));
      else out.push(...(await lsTree(dir, full)).filter((f) => f.endsWith('/SKILL.md')));
    }
    return out;
  }
  return (await lsTree(dir, pjoin(prefix, 'skills'))).filter((f) => f.endsWith('/SKILL.md'));
}

async function readAgent(dir: string, file: string): Promise<PluginAsset | null> {
  const raw = await showFile(dir, file);
  if (!raw) return null;
  const { data, body } = parseFrontmatter(raw);
  const name = str(data.name) || baseName(file).replace(/\.md$/, '');
  if (!name) return null;
  const effortRaw = str(data.effort);
  return {
    type: 'subagent',
    name,
    description: str(data.description) || undefined,
    effort: VALID_EFFORTS.has(effortRaw) ? (effortRaw as Effort) : undefined,
    body: body.trim(),
  };
}

async function readSkill(dir: string, file: string): Promise<PluginAsset | null> {
  const raw = await showFile(dir, file);
  if (!raw) return null;
  const { data, body } = parseFrontmatter(raw);
  // `skills/<slug>/SKILL.md` -> slug fallback for the name.
  const parts = file.split('/');
  const slug = parts.length >= 2 ? parts[parts.length - 2]! : 'skill';
  const name = str(data.name) || slug;
  return {
    type: 'skill',
    name,
    description: str(data.description) || undefined,
    body: body.trim(),
  };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function baseName(path: string): string {
  return path.split('/').pop() ?? path;
}
