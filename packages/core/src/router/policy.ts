import { resolveIntent } from '../catalog/resolve.js';
import type { Intent } from '../catalog/types.js';
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
  /**
   * User-selected preferred models per tier (set via the dashboard's
   * Models tab). When present and the underlying provider is ready,
   * routing leans on these instead of the catalog default: `strong`
   * for high-effort intents, `cheap` for trivial / cost-sensitive ones.
   * A pick whose provider isn't ready is ignored so the router falls
   * back to its normal selection.
   */
  preferredModels?: { strong?: RouteRef; cheap?: RouteRef };
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
    const pref = usablePreferred(ctx, 'cheap');
    if (pref) return { ...pref, rationale: 'preferred-cheap: handoff fix' };
    const cheap = pickByHint('cheap', ctx);
    if (cheap) return { ...cheap, rationale: 'force-cheap: handoff fix' };
  }

  // 5) Cognitive-shape driven selection.
  const { shape, taskType } = classification;
  if (taskType === 'trivial' || taskType === 'docs') {
    const pref = usablePreferred(ctx, 'cheap');
    if (pref) return { ...pref, rationale: `preferred-cheap:${taskType}` };
    const cheap = pickByHint('cheap', ctx);
    if (cheap) return { ...cheap, rationale: `cheap-task:${taskType}` };
  }

  // 5a) Shape-driven routing: ask the catalog to satisfy an intent.
  //     The catalog handles "which concrete model" + "which configured
  //     provider"; the router just picks the intent. Local host CLIs
  //     (codex / claude_code / ollama) win ties because they sit at
  //     the top of the catalog by convention.
  const forbidRoutes = ctx.memoryBias?.forbiddenRoutes ?? [];
  const tryIntent = (intent: Intent, rationale: string): RouteRef | null => {
    const ref = resolveIntent(intent, ctx.registry, { forbidRoutes });
    return ref ? { ...ref, rationale } : null;
  };

  // When the shape calls for a strong model and the user pinned a
  // preferred strong model, honor it before consulting the catalog.
  const needsStrong =
    shape.hugeContext > 0.7 ||
    shape.multiFileTaste > 0.75 ||
    (SHAPES_NEED_REASONING.some((k) => shape[k] >= 0.7) && profile.reasoningEffort !== 'minimal');
  if (needsStrong) {
    const pref = usablePreferred(ctx, 'strong');
    if (pref) return { ...pref, rationale: 'preferred-strong' };
  }

  if (shape.hugeContext > 0.7) {
    const r = tryIntent('huge-context', `shape:hugeContext=${shape.hugeContext.toFixed(2)}`);
    if (r) return r;
  }
  if (shape.multiFileTaste > 0.75) {
    const r = tryIntent('multi-file', `shape:multiFileTaste=${shape.multiFileTaste.toFixed(2)}`);
    if (r) return r;
  }
  if (SHAPES_NEED_REASONING.some((k) => shape[k] >= 0.7) && profile.reasoningEffort !== 'minimal') {
    const r = tryIntent(
      'deep-reasoning',
      `shape:deepReasoning=${shape.deepReasoning.toFixed(2)}, effort=${effort}`,
    );
    if (r) return r;
  }

  // 6) Default route: balanced agent. The catalog has the local CLIs
  //    (codex / claude_code) tagged as balanced-agent contenders, so
  //    we'll prefer those over native APIs automatically.
  const def = tryIntent('balanced-agent', `default:agent (taskType=${taskType})`);
  if (def) return def;

  // 7) Last resort: the first ready provider in the registry.
  for (const p of ctx.registry.list()) {
    if (!ctx.registry.isReady(p.name)) continue;
    const model = Object.keys(p.models)[0];
    if (!model) continue;
    return {
      provider: p.adapter,
      model,
      rationale: 'fallback: first ready provider',
      via: p.name,
    };
  }
  throw new Error(
    'Router: no usable provider - configure an API key with /setup or export one of ' +
      'ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY, OPENROUTER_API_KEY, DEEPSEEK_API_KEY, GROQ_API_KEY',
  );
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
  const forbidRoutes = ctx.memoryBias?.forbiddenRoutes ?? [];
  const out: RouteRef[] = [];
  const pushIntent = (intent: Intent, rationale: string): void => {
    const r = resolveIntent(intent, ctx.registry, { forbidRoutes });
    if (r) out.push({ ...r, rationale });
  };

  // For tournaments we want a *deliberately diverse* set of strong
  // contenders, one per intent the shape triggers, plus a balanced
  // fallback so we always have at least one route.
  if (shape.deepReasoning >= 0.5 || shape.algorithmic >= 0.5 || shape.adversarial >= 0.7) {
    pushIntent('deep-reasoning', 'strong: deep-reasoning');
  }
  if (shape.multiFileTaste >= 0.5) {
    pushIntent('multi-file', 'strong: multi-file');
  }
  if (shape.hugeContext >= 0.4) {
    pushIntent('huge-context', 'strong: huge-context');
  }
  pushIntent('balanced-agent', 'strong: balanced');

  // De-dupe by (via, model) so we don't pit a model against itself.
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
    if (!cfg.models[model]) continue;
    // Don't surface a route the registry can't actually authenticate -
    // otherwise the run fails downstream with "API_KEY not set" even
    // though we know it ahead of time and could pick something else.
    if (!ctx.registry.isReady(name)) continue;
    const ref: RouteRef = {
      provider: cfg.adapter,
      model,
      via: cfg.name,
      rationale: '',
    };
    if (isForbidden(ref, ctx)) continue;
    return ref;
  }
  return null;
}

function pickByHint(
  hint: 'cheap' | 'haiku' | 'local',
  ctx: RouterContext,
): RouteRef | null {
  const forbidRoutes = ctx.memoryBias?.forbiddenRoutes ?? [];
  if (hint === 'local') {
    return resolveIntent('local-offline', ctx.registry, { forbidRoutes });
  }
  // 'haiku' and 'cheap' both resolve to fast-cheap; the haiku-specific
  // bias used to live in the explicit fallback order and now lives in
  // the catalog (Haiku is fast-cheap@rank2).
  return resolveIntent('fast-cheap', ctx.registry, { forbidRoutes });
}

function parseRouteRef(route: string): RouteRef | null {
  const [provider, ...rest] = route.split(',');
  if (!provider || rest.length === 0) return null;
  return { provider: provider as RouteRef['provider'], model: rest.join(','), rationale: '', via: provider };
}

/**
 * Resolve a tier's preferred model into a routable ref, or null when
 * unset / its provider isn't ready / it's been forbidden by memory. The
 * `via` (provider name) drives the readiness check; an unconfigured
 * preference is silently skipped so routing falls back to the catalog.
 */
function usablePreferred(ctx: RouterContext, tier: 'strong' | 'cheap'): RouteRef | null {
  const ref = ctx.preferredModels?.[tier];
  if (!ref) return null;
  const providerName = ref.via ?? ref.provider;
  if (!ctx.registry.has(providerName) || !ctx.registry.isReady(providerName)) return null;
  if (isForbidden(ref, ctx)) return null;
  return ref;
}

function isForbidden(ref: RouteRef, ctx: RouterContext): boolean {
  if (!ctx.memoryBias?.forbiddenRoutes) return false;
  const key = `${ref.via ?? ref.provider},${ref.model}`;
  return ctx.memoryBias.forbiddenRoutes.includes(key);
}
