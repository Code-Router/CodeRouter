import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSkills, loadSubagents } from '../customize/store.js';
import { installPlugin, loadInstalled, loadManifest, uninstallPlugin } from './install.js';
import { parseEntry } from './marketplace.js';
import { resolvePlugin } from './resolve.js';
import { searchPlugins } from './types.js';
import type { Plugin, ResolvedPlugin } from './types.js';

let work: string;
let home: string;

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'cr-plug-work-'));
  home = await mkdtemp(join(tmpdir(), 'cr-plug-home-'));
  process.env.CODEROUTER_HOME = home;
});

afterEach(async () => {
  delete process.env.CODEROUTER_HOME;
  await rm(work, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

describe('parseEntry', () => {
  it('parses a relative-path entry', () => {
    const p = parseEntry('mp', 'owner/repo', {
      name: 'agent-sdk-dev',
      description: 'dev kit',
      author: { name: 'Anthropic' },
      source: './plugins/agent-sdk-dev',
      category: 'development',
      keywords: ['sdk'],
    })!;
    expect(p.id).toBe('agent-sdk-dev');
    expect(p.marketplace).toBe('mp');
    expect(p.marketplaceRepo).toBe('owner/repo');
    expect(p.source).toBe('./plugins/agent-sdk-dev');
    expect(p.strict).toBe(true);
    expect(p.tags).toContain('sdk');
  });

  it('parses a git-subdir entry and a strict:false bundle', () => {
    const sub = parseEntry('mp', 'o/r', {
      name: 'x',
      source: { source: 'git-subdir', url: 'https://github.com/a/b.git', path: 'plugins/x', sha: 'deadbeef' },
    })!;
    expect(typeof sub.source).toBe('object');

    const bundle = parseEntry('mp', 'o/r', {
      name: 'b',
      source: './bundle',
      strict: false,
      skills: ['./skill-a', './skill-b'],
    })!;
    expect(bundle.strict).toBe(false);
    expect(bundle.skillPaths).toEqual(['./skill-a', './skill-b']);
  });

  it('rejects entries without a name or source', () => {
    expect(parseEntry('mp', 'o/r', { description: 'x' })).toBeNull();
    expect(parseEntry('mp', 'o/r', { name: 'x' })).toBeNull();
  });

  it('searches across name/description/tags', () => {
    const plugins = [
      parseEntry('mp', 'o/r', { name: 'datadog', description: 'metrics', source: './a', tags: ['monitoring'] })!,
      parseEntry('mp', 'o/r', { name: 'stripe', description: 'payments', source: './b' })!,
    ];
    expect(searchPlugins(plugins, 'monitoring').map((p) => p.id)).toEqual(['datadog']);
    expect(searchPlugins(plugins, 'pay').map((p) => p.id)).toEqual(['stripe']);
  });
});

/** Build a tiny git repo that looks like a Claude plugin and return owner/repo-style local URL. */
async function makeFakePluginRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'cr-plug-repo-'));
  const root = join(repo, 'plugins', 'demo');
  await mkdir(join(root, '.claude-plugin'), { recursive: true });
  await mkdir(join(root, 'agents'), { recursive: true });
  await mkdir(join(root, 'skills', 'do-things'), { recursive: true });
  await mkdir(join(root, 'commands'), { recursive: true });
  await writeFile(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'demo', version: '1.0.0', description: 'd', author: { name: 'me' } }));
  await writeFile(join(root, 'agents', 'reviewer.md'), '---\nname: Reviewer\ndescription: reviews code\neffort: high\n---\nYou review code carefully.\n');
  await writeFile(join(root, 'skills', 'do-things', 'SKILL.md'), '---\nname: Do Things\ndescription: how to do things\n---\nStep 1. Do the thing.\n');
  await writeFile(join(root, 'commands', 'go.md'), '# go command');
  await writeFile(join(root, '.mcp.json'), '{"mcpServers":{}}');
  const git = (args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
  git(['init', '-q']);
  git(['config', 'user.email', 't@t.t']);
  git(['config', 'user.name', 't']);
  git(['add', '-A']);
  git(['commit', '-qm', 'init']);
  return repo;
}

describe('resolvePlugin + install/uninstall', () => {
  it('maps agents->subagents and skills->skills, counts skipped components', async () => {
    const repoPath = await makeFakePluginRepo();
    try {
      const plugin: Plugin = parseEntry('local', repoPath, {
        name: 'demo',
        description: 'demo plugin',
        source: './plugins/demo',
      })!;

      const resolved = await resolvePlugin(plugin);
      expect(resolved.error).toBeUndefined();
      const sub = resolved.assets.find((a) => a.type === 'subagent');
      const skill = resolved.assets.find((a) => a.type === 'skill');
      expect(sub && sub.type === 'subagent' && sub.name).toBe('Reviewer');
      expect(sub && sub.type === 'subagent' && sub.effort).toBe('high');
      expect(skill && skill.type === 'skill' && skill.name).toBe('Do Things');
      expect(resolved.skipped.commands).toBe(1);
      expect(resolved.skipped.mcpServers).toBe(1);

      // Install into the project scope (work dir) and verify files land.
      await installPlugin(work, resolved, 'project');
      expect((await loadSubagents(work)).some((s) => s.name === 'Reviewer')).toBe(true);
      expect((await loadSkills(work)).some((s) => s.name === 'Do Things')).toBe(true);
      expect((await loadManifest('project', work)).installed.demo).toBeTruthy();
      expect((await loadInstalled('project', work)).map((p) => p.id)).toContain('demo');

      // Uninstall removes the files + manifest entry.
      expect(await uninstallPlugin(work, 'demo', 'project')).toBe(true);
      expect((await loadSubagents(work)).some((s) => s.name === 'Reviewer')).toBe(false);
      expect((await loadManifest('project', work)).installed.demo).toBeUndefined();
    } finally {
      await rm(repoPath, { recursive: true, force: true });
    }
  });

  it('refuses to install a plugin with no importable assets', async () => {
    const empty: ResolvedPlugin = {
      id: 'empty',
      name: 'empty',
      description: '',
      tags: [],
      marketplace: 'mp',
      marketplaceRepo: 'o/r',
      source: './x',
      strict: true,
      assets: [],
      skipped: { commands: 0, hooks: 0, mcpServers: 1, lspServers: 0 },
    };
    await expect(installPlugin(work, empty, 'project')).rejects.toThrow();
  });
});
