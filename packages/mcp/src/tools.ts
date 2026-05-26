import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  buildReport,
  ClassifierCascade,
  defaultProviders,
  detectClarifications,
  loadConfig,
  loadProjectMemory,
  loadSeedCorpus,
  matchInstant,
  openStore,
  pick,
  ProviderRegistry,
  renderReportJson,
  resolveDbPath,
  runMode,
} from '@coderouter/core';
import type {
  Classification,
  Effort,
  ProviderConfig,
  RouteRef,
  Citation,
} from '@coderouter/core';
import {
  buildCitations,
  DocsProvider,
  GitHubProvider,
  TavilyProvider,
} from '@coderouter/core/research';
import { z } from 'zod';

const EffortSchema = z.enum(['low', 'medium', 'high', 'max']).optional();
const PromptSchema = z.string().min(1, 'prompt cannot be empty');

/**
 * Tool registry. Each tool returns a JSON-string `text` content block;
 * MCP hosts (Claude Code, Codex) render or display this directly.
 */
export function registerTools(server: McpServer): void {
  const cwd = process.cwd();
  const registry = new ProviderRegistry(defaultProviders() as ProviderConfig[]);

  // --- Mode tools ---
  const modeInputSchema = {
    prompt: PromptSchema,
    cwd: z.string().optional(),
    effort: EffortSchema,
    sessionId: z.string().optional(),
    fast: z.boolean().optional(),
    apply: z.boolean().optional(),
    route: z.string().optional(),
  };

  for (const m of ['plan', 'masterplan', 'agent_run', 'debug', 'review'] as const) {
    const mode = m === 'agent_run' ? 'agent' : m;
    server.tool(m, modeInputSchema, async (args) => {
      const out = await runMode(
        mode as 'plan' | 'masterplan' | 'agent' | 'debug' | 'review',
        {
          prompt: args.prompt,
          cwd: args.cwd ?? cwd,
          effort: args.effort,
          sessionId: args.sessionId,
          fast: args.fast,
          apply: args.apply,
          route: args.route,
        },
        { registry, router: { registry } },
      );
      const report = buildReport(args.prompt, out);
      return {
        content: [{ type: 'text', text: renderReportJson(report) }],
      };
    });
  }

  // --- route tool: classify + select route without running anything ---
  server.tool(
    'route',
    { prompt: PromptSchema, effort: EffortSchema, cwd: z.string().optional() },
    async ({ prompt, effort, cwd: callCwd }) => {
      const instant = matchInstant(prompt);
      const seed = await loadSeedCorpus();
      const cascade = new ClassifierCascade({ corpus: seed });
      const classification: Classification = instant.matched
        ? instant.classification
        : await cascade.classify({ prompt, noLlm: true });
      const route = pick(classification, { registry }, { effort: (effort ?? 'medium') as Effort });
      const out = {
        classification,
        route,
        cwd: callCwd ?? cwd,
      };
      return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
    },
  );

  // --- delegate tool: run mode + return the result inline ---
  server.tool(
    'delegate',
    {
      prompt: PromptSchema,
      mode: z.enum(['plan', 'masterplan', 'agent', 'debug', 'review']).default('agent'),
      effort: EffortSchema,
      cwd: z.string().optional(),
      apply: z.boolean().optional(),
    },
    async ({ prompt, mode, effort, cwd: callCwd, apply }) => {
      const out = await runMode(
        mode,
        { prompt, cwd: callCwd ?? cwd, effort, apply },
        { registry, router: { registry } },
      );
      const report = buildReport(prompt, out);
      return { content: [{ type: 'text', text: renderReportJson(report) }] };
    },
  );

  // --- validate tool: run configured validators against a path ---
  server.tool(
    'validate',
    { cwd: z.string().optional() },
    async ({ cwd: callCwd }) => {
      const { runValidators, summarize } = await import('@coderouter/core/validate');
      const results = await runValidators({ cwd: callCwd ?? cwd });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ summary: summarize(results), validators: results }, null, 2),
          },
        ],
      };
    },
  );

  // --- clarify tool: returns clarification questions without running the mode ---
  server.tool('clarify', { prompt: PromptSchema }, async ({ prompt }) => {
    const seed = await loadSeedCorpus();
    const cascade = new ClassifierCascade({ corpus: seed });
    const classification = await cascade.classify({ prompt, noLlm: true });
    const questions = detectClarifications({ prompt, classification });
    return {
      content: [{ type: 'text', text: JSON.stringify({ questions, classification }, null, 2) }],
    };
  });

  // --- research_* tools ---
  server.tool(
    'research_web',
    { query: PromptSchema, limit: z.number().optional() },
    async ({ query, limit }) => {
      const hits = await new TavilyProvider().search({ query, limit }).catch(() => []);
      return { content: [{ type: 'text', text: JSON.stringify(hits, null, 2) }] };
    },
  );
  server.tool(
    'research_github',
    {
      query: PromptSchema,
      language: z.string().optional(),
      minStars: z.number().optional(),
      limit: z.number().optional(),
    },
    async (args) => {
      const hits = await new GitHubProvider().search(args).catch(() => []);
      return { content: [{ type: 'text', text: JSON.stringify(hits, null, 2) }] };
    },
  );
  server.tool('research_docs', { query: PromptSchema }, async ({ query }) => {
    const hits = await new DocsProvider().search({ query }).catch(() => []);
    return { content: [{ type: 'text', text: JSON.stringify(hits, null, 2) }] };
  });
  server.tool('fetch_source', { url: z.string().url() }, async ({ url }) => {
    const res = await fetch(url).catch((err: Error) => ({ ok: false, error: err.message }) as { ok: false; error: string });
    if (!('ok' in res) || !res.ok) {
      const reason = 'error' in res ? res.error : `HTTP ${('status' in res ? res.status : 'unknown')}`;
      return { content: [{ type: 'text', text: JSON.stringify({ ok: false, reason }) }] };
    }
    const text = await (res as Response).text();
    const citations: Citation[] = buildCitations([
      { id: '1', kind: 'web', title: url, url, source: 'fetch' },
    ]);
    return {
      content: [
        { type: 'text', text: text.slice(0, 100_000) },
        { type: 'text', text: JSON.stringify(citations) },
      ],
    };
  });

  // --- memory tools ---
  server.tool('memory_show', { cwd: z.string().optional() }, async ({ cwd: callCwd }) => {
    const root = callCwd ?? cwd;
    const projectMem = await loadProjectMemory(root);
    let runs: unknown[] = [];
    let learnedCount = 0;
    try {
      const store = await openStore(resolveDbPath(root));
      runs = store.runs.list(20);
      learnedCount = store.learned.count();
      store.db.close();
    } catch {
      // store not initialized yet
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              projectMemoryFiles: projectMem.fragments.map((f) => ({
                path: f.path,
                source: f.source,
                priority: f.priority,
              })),
              facts: projectMem.facts,
              learnedExamplesCount: learnedCount,
              recentRuns: runs,
            },
            null,
            2,
          ),
        },
      ],
    };
  });
  server.tool(
    'memory_forget',
    { key: z.string(), cwd: z.string().optional() },
    async ({ key, cwd: callCwd }) => {
      const store = await openStore(resolveDbPath(callCwd ?? cwd));
      store.facts.delete(key);
      store.db.close();
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, key }) }] };
    },
  );
  server.tool('memory_export', { cwd: z.string().optional() }, async ({ cwd: callCwd }) => {
    const store = await openStore(resolveDbPath(callCwd ?? cwd));
    const dump = {
      facts: store.facts.list(),
      overrides: store.overrides.list(),
      runs: store.runs.list(50),
      learnedExamples: store.learned.list(200),
    };
    store.db.close();
    return { content: [{ type: 'text', text: JSON.stringify(dump, null, 2) }] };
  });

  // --- plan_execute (loads a plan file, runs phases sequentially) ---
  server.tool(
    'plan_execute',
    { planId: z.string(), cwd: z.string().optional() },
    async ({ planId, cwd: callCwd }) => {
      const { loadPlanFile } = await import('@coderouter/core/modes');
      const root = callCwd ?? cwd;
      const path = `${root}/.coderouter/plans/${planId}.plan.md`;
      const plan = await loadPlanFile(path);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                planId,
                phases: plan.frontmatter.phases,
                note: 'phase execution wired through CLI/agent invocation; MCP returns the plan structure',
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // --- score / plan_dual stubs (use core workflow APIs directly) ---
  server.tool(
    'plan_dual',
    {
      task: PromptSchema,
      routes: z.tuple([z.string(), z.string()]),
      judgeRoute: z.string(),
    },
    async ({ task, routes, judgeRoute }) => {
      const { runDualPlan } = await import('@coderouter/core/workflows');
      const [a, b] = routes;
      const refA: RouteRef = parseRouteRef(a);
      const refB: RouteRef = parseRouteRef(b);
      const refJ: RouteRef = parseRouteRef(judgeRoute);
      const out = await runDualPlan({
        task,
        routes: [refA, refB],
        judgeRoute: refJ,
        registry,
      });
      return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
    },
  );

  // --- config_load tool: returns current loaded config (used by clients to verify install) ---
  server.tool('config_load', { cwd: z.string().optional() }, async ({ cwd: callCwd }) => {
    const { config, path } = await loadConfig(callCwd ?? cwd);
    return { content: [{ type: 'text', text: JSON.stringify({ path, config }, null, 2) }] };
  });
}

function parseRouteRef(route: string): RouteRef {
  const [provider, ...rest] = route.split(',');
  if (!provider || rest.length === 0) throw new Error(`Bad route ref: ${route}`);
  return {
    provider: provider as RouteRef['provider'],
    model: rest.join(','),
    rationale: '',
    via: provider,
  };
}
