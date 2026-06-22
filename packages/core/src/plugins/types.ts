import type { Effort } from '../types.js';

/**
 * One asset CodeRouter installs from a plugin. Claude plugins map onto
 * our customize layer: their `agents/` -> subagents, their `skills/` ->
 * skills. (Rules have no Claude equivalent; the type is kept so locally
 * authored bundles can still carry one.)
 */
export type PluginAsset =
  | {
      type: 'rule';
      id: string;
      description?: string;
      globs?: string[];
      alwaysApply?: boolean;
      body: string;
    }
  | { type: 'skill'; name: string; description?: string; body: string }
  | {
      type: 'subagent';
      name: string;
      description?: string;
      kind?: string;
      provider?: string;
      model?: string;
      effort?: Effort;
      body: string;
    };

/** A Claude plugin `source` (string = path within the marketplace repo). */
export type PluginSource =
  | string
  | {
      source?: string;
      url?: string;
      repo?: string;
      path?: string;
      ref?: string;
      sha?: string;
      commit?: string;
    };

/**
 * A catalog entry: one plugin as listed in a marketplace's
 * `marketplace.json`. Lightweight — its assets are only resolved
 * (cloned + parsed) on preview or install.
 */
export type Plugin = {
  /** kebab-case plugin name, unique within a marketplace. */
  id: string;
  name: string;
  description: string;
  author?: string;
  category?: string;
  tags: string[];
  homepage?: string;
  /** Marketplace this entry came from (its `name`). */
  marketplace: string;
  /** The marketplace repo (owner/repo or git URL) — used to resolve relative sources. */
  marketplaceRepo: string;
  /** Raw `source` field, used to locate the plugin's files. */
  source: PluginSource;
  /** Whether `plugin.json` is authoritative (default true). */
  strict: boolean;
  /** Explicit component paths declared on the marketplace entry (strict:false bundles). */
  skillPaths?: string[];
  agentPaths?: string[];
};

/** Components a plugin ships that CodeRouter does not (yet) run. */
export type SkippedComponents = {
  commands: number;
  hooks: number;
  mcpServers: number;
  lspServers: number;
};

/** A plugin with its assets resolved from the repo. */
export type ResolvedPlugin = Plugin & {
  assets: PluginAsset[];
  skipped: SkippedComponents;
  /** Populated when resolution partially failed. */
  error?: string;
};

/** A registered marketplace. */
export type Marketplace = {
  /** Stable name (from marketplace.json, or the repo until loaded). */
  name: string;
  /** owner/repo or git URL. */
  repo: string;
  /** builtin = seeded by CodeRouter; user = added by the user. */
  source: 'builtin' | 'user';
};

/** A loaded marketplace plus its plugins (or an error if it failed). */
export type LoadedMarketplace = Marketplace & {
  owner?: string;
  plugins: Plugin[];
  error?: string;
};

/** Record of one installed plugin, kept in `<scope>/plugins.json`. */
export type InstalledPlugin = {
  id: string;
  name: string;
  marketplace: string;
  sha?: string;
  installedAt: number;
  assets: Array<{ type: 'rule' | 'skill' | 'subagent'; key: string }>;
};

export type InstallManifest = {
  installed: Record<string, InstalledPlugin>;
};

/** Per-asset-type counts, handy for the UI. */
export function assetCounts(p: { assets: PluginAsset[] }): {
  rules: number;
  skills: number;
  subagents: number;
} {
  let rules = 0;
  let skills = 0;
  let subagents = 0;
  for (const a of p.assets) {
    if (a.type === 'rule') rules++;
    else if (a.type === 'skill') skills++;
    else subagents++;
  }
  return { rules, skills, subagents };
}

/** Filter plugins by a free-text query over name/description/tags/category. */
export function searchPlugins(plugins: Plugin[], query: string): Plugin[] {
  const q = query.trim().toLowerCase();
  if (!q) return plugins;
  const terms = q.split(/\s+/);
  return plugins.filter((p) => {
    const hay = [p.name, p.description, p.category ?? '', p.tags.join(' '), p.author ?? '']
      .join(' ')
      .toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}
