import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  deleteRule,
  deleteSkill,
  deleteSubagent,
  scopeRoot,
  writeRule,
  writeSkill,
  writeSubagent,
} from '../customize/store.js';
import type { AssetScope } from '../customize/types.js';
import type { InstallManifest, InstalledPlugin, PluginAsset, ResolvedPlugin } from './types.js';

const MANIFEST = 'plugins.json';

function manifestPath(scope: AssetScope, cwd: string): string {
  return join(scopeRoot(scope, cwd), MANIFEST);
}

export async function loadManifest(scope: AssetScope, cwd: string): Promise<InstallManifest> {
  try {
    const raw = await readFile(manifestPath(scope, cwd), 'utf8');
    const parsed = JSON.parse(raw) as InstallManifest;
    return { installed: parsed.installed ?? {} };
  } catch {
    return { installed: {} };
  }
}

async function saveManifest(scope: AssetScope, cwd: string, m: InstallManifest): Promise<void> {
  await mkdir(scopeRoot(scope, cwd), { recursive: true });
  await writeFile(manifestPath(scope, cwd), `${JSON.stringify(m, null, 2)}\n`, 'utf8');
}

export async function loadInstalled(scope: AssetScope, cwd: string): Promise<InstalledPlugin[]> {
  const m = await loadManifest(scope, cwd);
  return Object.values(m.installed).sort((a, b) => b.installedAt - a.installedAt);
}

export async function loadAllInstalled(
  cwd: string,
): Promise<{ project: InstalledPlugin[]; global: InstalledPlugin[] }> {
  const [project, global] = await Promise.all([
    loadInstalled('project', cwd),
    loadInstalled('global', cwd),
  ]);
  return { project, global };
}

/**
 * Install a resolved plugin into the given scope: write each mapped
 * asset as a real file via the customize layer, then record the exact
 * asset identities in the scope's manifest so uninstall is precise.
 */
export async function installPlugin(
  cwd: string,
  plugin: ResolvedPlugin,
  scope: AssetScope,
): Promise<InstalledPlugin> {
  if (plugin.assets.length === 0) {
    throw new Error(
      plugin.error
        ? `nothing to install: ${plugin.error}`
        : 'this plugin has no CodeRouter-compatible assets (no agents or skills to import)',
    );
  }
  const written: InstalledPlugin['assets'] = [];
  for (const asset of plugin.assets) written.push(await writeAsset(cwd, scope, asset));

  const m = await loadManifest(scope, cwd);
  const record: InstalledPlugin = {
    id: plugin.id,
    name: plugin.name,
    marketplace: plugin.marketplace,
    sha: typeof plugin.source === 'object' ? plugin.source.sha || plugin.source.commit : undefined,
    installedAt: Date.now(),
    assets: written,
  };
  m.installed[plugin.id] = record;
  await saveManifest(scope, cwd, m);
  return record;
}

export async function uninstallPlugin(
  cwd: string,
  id: string,
  scope: AssetScope,
): Promise<boolean> {
  const m = await loadManifest(scope, cwd);
  const entry = m.installed[id];
  if (!entry) return false;
  for (const a of entry.assets) {
    if (a.type === 'rule') await deleteRule(cwd, scope, a.key);
    else if (a.type === 'skill') await deleteSkill(cwd, scope, a.key);
    else await deleteSubagent(cwd, scope, a.key);
  }
  delete m.installed[id];
  await saveManifest(scope, cwd, m);
  return true;
}

async function writeAsset(
  cwd: string,
  scope: AssetScope,
  asset: PluginAsset,
): Promise<InstalledPlugin['assets'][number]> {
  if (asset.type === 'rule') {
    const r = await writeRule(cwd, {
      scope,
      id: asset.id,
      description: asset.description,
      globs: asset.globs,
      alwaysApply: asset.alwaysApply,
      body: asset.body,
    });
    return { type: 'rule', key: r.id };
  }
  if (asset.type === 'skill') {
    const s = await writeSkill(cwd, {
      scope,
      name: asset.name,
      description: asset.description,
      body: asset.body,
    });
    return { type: 'skill', key: s.slug };
  }
  const s = await writeSubagent(cwd, {
    scope,
    name: asset.name,
    description: asset.description,
    kind: asset.kind,
    provider: asset.provider,
    model: asset.model,
    effort: asset.effort,
    body: asset.body,
  });
  return { type: 'subagent', key: s.slug };
}
