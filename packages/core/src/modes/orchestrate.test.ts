import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Adapter } from '../adapters/types.js';
import { EDITABLE_ADAPTERS } from '../catalog/resolve.js';
import { defaultProviders, ProviderRegistry } from '../providers/registry.js';
import { exec, gitOrThrow } from '../sandbox/exec.js';
import type { AdapterCapabilities, RouteRef } from '../types.js';
import type { ModeContext } from './types.js';
import {
  orderSubtasks,
  parseSubtasks,
  routeForSubtask,
  runOrchestrateMode,
  type Subtask,
} from './orchestrate.js';

function st(partial: Partial<Subtask> & { id: string }): Subtask {
  return { title: partial.id, kind: 'feature', details: partial.id, dependsOn: [], ...partial };
}

describe('parseSubtasks', () => {
  it('parses a clean JSON object', () => {
    const out = parseSubtasks(
      '{"subtasks":[{"id":"s1","title":"Design","kind":"architecture","details":"do x","dependsOn":[]}]}',
    );
    expect(out).not.toBeNull();
    expect(out).toHaveLength(1);
    expect(out![0]).toMatchObject({ id: 's1', kind: 'architecture', title: 'Design' });
  });

  it('extracts JSON wrapped in prose / code fences', () => {
    const out = parseSubtasks(
      'Sure! Here is the plan:\n```json\n{"subtasks":[{"id":"a","title":"T","kind":"test","details":"d"}]}\n```\nDone.',
    );
    expect(out).not.toBeNull();
    expect(out![0].kind).toBe('test');
  });

  it('clamps unknown kinds to feature and fills missing ids/details', () => {
    const out = parseSubtasks('{"subtasks":[{"title":"X","kind":"banana"}]}');
    expect(out).not.toBeNull();
    expect(out![0].kind).toBe('feature');
    expect(out![0].id).toBe('s1');
    expect(out![0].details).toBe('X');
  });

  it('returns null on garbage / empty', () => {
    expect(parseSubtasks('no json here')).toBeNull();
    expect(parseSubtasks('{"subtasks":[]}')).toBeNull();
    expect(parseSubtasks('{"nope":1}')).toBeNull();
  });
});

describe('orderSubtasks', () => {
  it('orders by dependency (deps first)', () => {
    const ordered = orderSubtasks([
      st({ id: 'b', dependsOn: ['a'] }),
      st({ id: 'a' }),
      st({ id: 'c', dependsOn: ['b'] }),
    ]);
    expect(ordered.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('is cycle-safe (keeps every node)', () => {
    const ordered = orderSubtasks([
      st({ id: 'x', dependsOn: ['y'] }),
      st({ id: 'y', dependsOn: ['x'] }),
    ]);
    expect(new Set(ordered.map((s) => s.id))).toEqual(new Set(['x', 'y']));
  });
});

describe('routeForSubtask', () => {
  function ctxOpenRouterOnly(): ModeContext {
    // Only an OpenRouter key + local CLIs forced off => the only
    // edit-capable provider is `openrouter_agent` (coderouter_agent).
    // (We disable the CLIs via env rather than blanking PATH so other
    // tests in this file can still spawn `git`.)
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.GROQ_API_KEY;
    process.env.CODEROUTER_DISABLE_CODEX = '1';
    process.env.CODEROUTER_DISABLE_CLAUDE_CODE = '1';
    process.env.CODEROUTER_DISABLE_OLLAMA = '1';
    const registry = new ProviderRegistry(defaultProviders());
    return { registry, router: { registry } };
  }

  it('routes mechanical kinds to a cheap-but-editable adapter at low effort', () => {
    const ctx = ctxOpenRouterOnly();
    for (const kind of ['test', 'docs', 'mechanical'] as const) {
      const { route, effort } = routeForSubtask(st({ id: 's', kind }), ctx);
      expect(EDITABLE_ADAPTERS.has(route.provider)).toBe(true);
      expect(effort).toBe('low');
    }
  });

  it('routes architecture to a big editable model at high effort', () => {
    const ctx = ctxOpenRouterOnly();
    const { route, effort } = routeForSubtask(st({ id: 's', kind: 'architecture' }), ctx);
    expect(EDITABLE_ADAPTERS.has(route.provider)).toBe(true);
    expect(effort).toBe('high');
  });

  it('routes feature/bugfix/refactor to editable at medium effort', () => {
    const ctx = ctxOpenRouterOnly();
    for (const kind of ['feature', 'bugfix', 'refactor'] as const) {
      const { route, effort } = routeForSubtask(st({ id: 's', kind }), ctx);
      expect(EDITABLE_ADAPTERS.has(route.provider)).toBe(true);
      expect(effort).toBe('medium');
    }
  });

  it('honors a subagent that pins an editable model + effort', () => {
    const ctx = ctxOpenRouterOnly();
    const subagent = {
      slug: 'tester',
      scope: 'project' as const,
      path: '/x.md',
      name: 'Tester',
      description: '',
      kind: 'test',
      provider: 'coderouter_agent',
      model: 'anthropic/claude-opus-4-5',
      effort: 'high' as const,
      body: 'be thorough',
    };
    const { route, effort } = routeForSubtask(st({ id: 's', kind: 'test' }), ctx, subagent);
    expect(route.provider).toBe('coderouter_agent');
    expect(route.model).toBe('anthropic/claude-opus-4-5');
    expect(route.rationale).toContain('subagent:Tester');
    expect(effort).toBe('high');
  });
});

describe('runOrchestrateMode (end-to-end with fake adapters)', () => {
  let tmpRoot: string;
  let repoPath: string;

  beforeEach(async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    // Keep PATH intact so `git` is spawnable, but force the local
    // CLIs off so the only edit-capable provider is openrouter_agent.
    process.env.CODEROUTER_DISABLE_CODEX = '1';
    process.env.CODEROUTER_DISABLE_CLAUDE_CODE = '1';
    process.env.CODEROUTER_DISABLE_OLLAMA = '1';
    tmpRoot = await mkdtemp(join(tmpdir(), 'cr-orch-'));
    repoPath = join(tmpRoot, 'repo');
    await exec('git', ['init', '-q', '-b', 'main', repoPath]);
    await gitOrThrow(['config', 'user.email', 'test@coderouter.dev'], { cwd: repoPath });
    await gitOrThrow(['config', 'user.name', 'CodeRouter Test'], { cwd: repoPath });
    await writeFile(join(repoPath, 'README.md'), '# fixture\n');
    await gitOrThrow(['add', '-A'], { cwd: repoPath });
    await gitOrThrow(['commit', '-q', '-m', 'init'], { cwd: repoPath });
  });

  afterEach(async () => {
    delete process.env.CODEROUTER_DISABLE_CODEX;
    delete process.env.CODEROUTER_DISABLE_CLAUDE_CODE;
    delete process.env.CODEROUTER_DISABLE_OLLAMA;
    await rm(tmpRoot, { recursive: true, force: true });
  });

  function caps(): AdapterCapabilities {
    return {
      canEdit: true,
      canPlan: true,
      longContext: true,
      reasoning: true,
      tools: true,
      streaming: false,
      vision: false,
      pricePer1MIn: 1,
      pricePer1MOut: 1,
      contextWindow: 200_000,
      family: 'agent-loop',
    };
  }

  it('decomposes, runs each sub-task in one worktree, and aggregates the diff', async () => {
    const planJson = JSON.stringify({
      subtasks: [
        { id: 's1', title: 'Scaffold', kind: 'architecture', details: 'create core', dependsOn: [] },
        { id: 's2', title: 'Tests', kind: 'test', details: 'add tests', dependsOn: ['s1'] },
      ],
    });
    const runOrder: string[] = [];
    let step = 0;
    const fake: Adapter = {
      id: 'coderouter_agent',
      name: 'fake-agent',
      capabilities: caps(),
      estimateCost: () => 0,
      plan: async () => ({
        text: planJson,
        tokensIn: 5,
        tokensOut: 5,
        costUsd: 0.001,
        durationMs: 1,
      }),
      run: async (input) => {
        step += 1;
        const file = `step${step}.ts`;
        runOrder.push(
          input.prompt.includes('[architecture]: Scaffold')
            ? 's1'
            : input.prompt.includes('[test]: Tests')
              ? 's2'
              : `?${step}`,
        );
        await writeFile(join(input.cwd!, file), `export const v${step} = ${step};\n`);
        return { text: `did ${file}`, tokensIn: 10, tokensOut: 10, costUsd: 0.01, durationMs: 1 };
      },
    };

    const registry = new ProviderRegistry(defaultProviders());
    const ctx: ModeContext = {
      registry,
      router: { registry },
      resolveAdapter: (_route: RouteRef) => fake,
    };

    const out = await runOrchestrateMode(
      { prompt: 'build a thing', cwd: repoPath, fast: true, apply: false },
      ctx,
    );

    expect(out.mode).toBe('orchestrate');
    expect(out.status).toBe('success');
    // Two sub-tasks executed, in dependency order.
    expect(runOrder).toEqual(['s1', 's2']);
    // Cumulative diff carries BOTH steps' files (single worktree).
    expect(out.filesChanged?.sort()).toEqual(['step1.ts', 'step2.ts']);
    expect(out.diff).toContain('step1.ts');
    expect(out.diff).toContain('step2.ts');
    // planner route + at least one execution route surfaced.
    expect((out.routes?.length ?? 0)).toBeGreaterThanOrEqual(1);
    expect(out.costUsd).toBeGreaterThan(0);
  });

  it('applies the cumulative diff to the host repo when apply=true', async () => {
    const fake: Adapter = {
      id: 'coderouter_agent',
      name: 'fake-agent',
      capabilities: caps(),
      estimateCost: () => 0,
      plan: async () => ({
        text: '{"subtasks":[{"id":"s1","title":"One","kind":"feature","details":"d","dependsOn":[]}]}',
        tokensIn: 1,
        tokensOut: 1,
        costUsd: 0,
        durationMs: 1,
      }),
      run: async (input) => {
        await writeFile(join(input.cwd!, 'added.ts'), 'export const z = 7;\n');
        return { text: 'ok', tokensIn: 1, tokensOut: 1, costUsd: 0, durationMs: 1 };
      },
    };
    const registry = new ProviderRegistry(defaultProviders());
    const ctx: ModeContext = { registry, router: { registry }, resolveAdapter: () => fake };

    const out = await runOrchestrateMode(
      { prompt: 'add z', cwd: repoPath, fast: true, apply: true },
      ctx,
    );
    expect(out.applied).toBe(true);
    const merged = await readFile(join(repoPath, 'added.ts'), 'utf8');
    expect(merged).toBe('export const z = 7;\n');
  });

  it('falls back to a single sub-task when the planner emits no JSON', async () => {
    let runs = 0;
    const fake: Adapter = {
      id: 'coderouter_agent',
      name: 'fake-agent',
      capabilities: caps(),
      estimateCost: () => 0,
      plan: async () => ({ text: 'I cannot do that', tokensIn: 1, tokensOut: 1, costUsd: 0, durationMs: 1 }),
      run: async (input) => {
        runs += 1;
        await writeFile(join(input.cwd!, 'solo.ts'), 'export const s = 1;\n');
        return { text: 'ok', tokensIn: 1, tokensOut: 1, costUsd: 0, durationMs: 1 };
      },
    };
    const registry = new ProviderRegistry(defaultProviders());
    const ctx: ModeContext = { registry, router: { registry }, resolveAdapter: () => fake };

    const out = await runOrchestrateMode(
      { prompt: 'do the whole thing', cwd: repoPath, fast: true },
      ctx,
    );
    expect(runs).toBe(1);
    expect(out.filesChanged).toEqual(['solo.ts']);
  });
});
