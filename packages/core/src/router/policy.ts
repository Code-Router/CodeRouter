import type { ProviderRegistry } from '../providers/registry.js';
import type { Classification, CognitiveShape, Effort, RouteRef } from '../types.js';
import { effortProfile } from './effort.js';
import { matchInstant } from './instant.js';

/**
 * Router policy.
 *
 * Two entry points:
 *   - `pick(classification, opts)`: returns a single best route for the
 *     given classification, balancing cost vs effectiveness.
 *   - `pickStrong(classification, effort)`: returns the strongest route
 *     for a given cognitive shape, used by tournament/dualPlan when the
 *     workflow needs the high-end model regardless of cost.
 *
 * The router prefers the user's `routeOverrides` first, then consults
 * persistent memory (when supplied), then falls back to the built-in
 * cognitive-shape -> model mapping.
 */

export type RouterContext = {
  registry: ProviderRegistry;
  /** Repo-scoped persistent memory used to bias decisions. */
  memoryBias?: MemoryBias;
  /** Hard route override from config; if matched, returned verbatim. */
  routeOverrides?: { taskType?: Classification['taskType']; routeRef: RouteRef }[];
};

/** Read-only handle into the persistent memory shape the router actually uses. */
export type MemoryBias = {
  /** Routes the project has had repeated failures on (e.g. wrong shape). */
  forbiddenRoutes?: string[];
  /** Routes the project has had repeated success on. */
  preferredRoutes?: { route: string; reason: string }[];
  /** Last successful route for this repo (used by --fast). */
  lastSuccessfulRoute?: string;
};

export type PickOptions = {
  effort?: Effort;
  /** If true, callers want a cheap route even on high-shape requests (used for handoff-fix). */
  forceCheap?: boolean;
};

const SHAPES_NEED_REASONING: (keyof CognitiveShape)[] = [
  'deepReasoning',
  'algorithmic',
  'adversarial',
];

/**
 * Returns the cost-effective route across the cheap+strong tiers.
 * Cheap-task short-circuits go to Ollama/Haiku; complex-task signals
 * (deep reasoning, multi-file taste, huge context) escalate to the
 * appropriate strong model.
 */
export function pick(
  classification: Classification,
  ctx: RouterContext,
  opts: PickOptions = {},
): RouteRef {
  const effort = opts.effort ?? 'medium';
  const profile = effortProfile(effort);

  // 1) Hard overrides from config.
  for (const o of ctx.routeOverrides ?? []) {
    if (!o.taskType || o.taskType === classification.taskType) return o.routeRef;
  }

  // 2) Memory: preferred routes with stronger weight than the defaults.
  if (ctx.memoryBias?.preferredRoutes?.length) {
    const top = ctx.memoryBias.preferredRoutes[0];
    if (top) {
      const ref = parseRouteRef(top.route);
      if (ref && !isForbidden(ref, ctx)) return { ...ref, rationale: `memory: ${top.reason}` };
    }
  }

  // 3) Instant routes (typo, format, commit-message...) always win.
  const instant = matchInstant(classification.rationale);
  if (instant.matched) {
    const route = pickByHint(instant.pattern.route, ctx);
    if (route) return { ...route, rationale: instant.pattern.rationale };
  }

  // 4) Force-cheap (handoff-fix); pick the cheapest capable route.
  if (opts.forceCheap) {
    const cheap = pickByHint('cheap', ctx);
    if (cheap) return { ...cheap, rationale: 'force-cheap: handoff fix' };
  }

  // 5) Cognitive-shape driven selection.
  const { shape, taskType } = classification;
  if (taskType === 'trivial' || taskType === 'docs') {
    const cheap = pickByHint('cheap', ctx);
    if (cheap) return { ...cheap, rationale: `cheap-task:${taskType}` };
  }

  if (shape.hugeContext > 0.7) {
    const r = preferProvider(ctx, ['google'], 'gemini-2.5-pro');
    if (r) return { ...r, rationale: `shape:hugeContext=${shape.hugeContext.toFixed(2)}` };
  }
  if (shape.multiFileTaste > 0.75) {
    const r = preferProvider(ctx, ['anthropic', 'claude_code'], 'claude-opus-4-1');
    if (r) return { ...r, rationale: `shape:multiFileTaste=${shape.multiFileTaste.toFixed(2)}` };
  }
  if (SHAPES_NEED_REASONING.some((k) => shape[k] >= 0.7) && profile.reasoningEffort !== 'minimal') {
    const r = preferProvider(ctx, ['openai'], 'gpt-5-reasoning') ?? preferProvider(ctx, ['deepseek'], 'deepseek-reasoner');
    if (r) {
      return {
        ...r,
        rationale: `shape:deepReasoning=${shape.deepReasoning.toFixed(2)}, effort=${effort}`,
      };
    }
  }

  // 6) Default route: balanced agent.
  const def = preferProvider(ctx, ['claude_code'], 'sonnet') ?? preferProvider(ctx, ['anthropic'], 'claude-sonnet-4-5');
  if (def) return { ...def, rationale: `default:agent (taskType=${taskType})` };

  // 7) Last resort: any registered route.
  const first = ctx.registry.list()[0];
  if (!first) throw new Error('Router: no providers registered');
  const model = Object.keys(first.models)[0];
  if (!model) throw new Error(`Router: provider ${first.name} has no models`);
  return {
    provider: first.adapter,
    model,
    rationale: 'fallback: first registered route',
    via: first.name,
  };
}

/**
 * Returns the strongest available route for the given shape. Used by
 * tournament and dualPlan, which want the top contenders regardless of
 * cost ceilings.
 */
export function pickStrong(
  classification: Classification,
  ctx: RouterContext,
  effort: Effort = 'high',
): RouteRef[] {
  const profile = effortProfile(effort);
  const { shape } = classification;
  const out: RouteRef[] = [];

  if (shape.deepReasoning >= 0.5 || shape.algorithmic >= 0.5 || shape.adversarial >= 0.7) {
    const r = preferProvider(ctx, ['openai'], 'gpt-5-reasoning');
    if (r) out.push({ ...r, rationale: 'strong:gpt-5-reasoning (deep)' });
  }
  if (shape.multiFileTaste >= 0.5) {
    const r = preferProvider(ctx, ['anthropic'], 'claude-opus-4-1');
    if (r) out.push({ ...r, rationale: 'strong:claude-opus-4-1 (multi-file)' });
  }
  if (shape.hugeContext >= 0.4) {
    const r = preferProvider(ctx, ['google'], 'gemini-2.5-pro');
    if (r) out.push({ ...r, rationale: 'strong:gemini-2.5-pro (long context)' });
  }
  // Always include a balanced contender.
  const balanced = preferProvider(ctx, ['anthropic'], 'claude-sonnet-4-5');
  if (balanced) out.push({ ...balanced, rationale: 'strong:claude-sonnet-4-5 (balanced)' });

  // De-dupe by (provider, model) and trim to tournamentSize.
  const seen = new Set<string>();
  const uniq = out.filter((r) => {
    const k = `${r.via ?? r.provider},${r.model}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return uniq.slice(0, Math.max(1, profile.tournamentSize));
}

function preferProvider(
  ctx: RouterContext,
  providers: string[],
  model: string,
): RouteRef | null {
  for (const name of providers) {
    const cfg = ctx.registry.list().find((p) => p.name === name);
    if (!cfg) continue;
    if (cfg.models[model]) {
      const ref: RouteRef = {
        provider: cfg.adapter,
        model,
        via: cfg.name,
        rationale: '',
      };
      if (isForbidden(ref, ctx)) continue;
      return ref;
    }
  }
  return null;
}

function pickByHint(
  hint: 'cheap' | 'haiku' | 'local',
  ctx: RouterContext,
): RouteRef | null {
  if (hint === 'local') {
    const r = preferProvider(ctx, ['ollama'], 'qwen2.5-coder:7b') ?? preferProvider(ctx, ['ollama'], 'llama3.2');
    if (r) return r;
  }
  if (hint === 'haiku' || hint === 'cheap') {
    const r =
      preferProvider(ctx, ['anthropic'], 'claude-3-5-haiku-latest') ??
      preferProvider(ctx, ['openai'], 'gpt-4o-mini') ??
      preferProvider(ctx, ['deepseek'], 'deepseek-chat');
    if (r) return r;
  }
  if (hint === 'cheap') {
    const r = preferProvider(ctx, ['ollama'], 'qwen2.5-coder:7b') ?? preferProvider(ctx, ['ollama'], 'llama3.2');
    if (r) return r;
  }
  return null;
}

function parseRouteRef(route: string): RouteRef | null {
  const [provider, ...rest] = route.split(',');
  if (!provider || rest.length === 0) return null;
  return { provider: provider as RouteRef['provider'], model: rest.join(','), rationale: '', via: provider };
}

function isForbidden(ref: RouteRef, ctx: RouterContext): boolean {
  if (!ctx.memoryBias?.forbiddenRoutes) return false;
  const key = `${ref.via ?? ref.provider},${ref.model}`;
  return ctx.memoryBias.forbiddenRoutes.includes(key);
}
