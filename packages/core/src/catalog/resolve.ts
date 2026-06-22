import { detectCodexAuthMode } from '../adapters/codex.js';
import { isOllamaModelInstalled } from '../adapters/ollama.js';
import type { ProviderRegistry } from '../providers/registry.js';
import { selectSmartModel } from '../router/smart/index.js';
import type { RouteRef } from '../types.js';
import { CATALOG } from './entries.js';
import type { CatalogEntry, Intent } from './types.js';

/**
 * Cached codex auth mode. Reading ~/.codex/auth.json is cheap but it
 * can't change without a `codex login`, so we memoise it for the
 * lifetime of the process. `resetCodexAuthCache()` is exported for
 * tests.
 */
let codexAuthCache: ReturnType<typeof detectCodexAuthMode> | null = null;
function codexAuthMode(): ReturnType<typeof detectCodexAuthMode> {
  if (codexAuthCache === null) codexAuthCache = detectCodexAuthMode();
  return codexAuthCache;
}
export function resetCodexAuthCache(): void {
  codexAuthCache = null;
}

/**
 * Intents whose *whole point* is getting a top-tier model. When codex
 * is logged in via a ChatGPT account, the CLI ignores `-m` and picks
 * whatever model the user's plan allows - so we can't guarantee we'll
 * actually get a reasoning-strength model out of it. We still allow
 * codex as a last-resort candidate for these intents, just with a
 * heavy rank penalty so any configured cloud API wins.
 *
 * `balanced-agent` and `fast-cheap` aren't penalised because for those
 * the "any-model-from-codex" mystery box is genuinely fine.
 */
const STRONG_MODEL_INTENTS: ReadonlySet<Intent> = new Set(['deep-reasoning', 'multi-file']);
const CODEX_CHATGPT_RANK_PENALTY = 10;

export type ResolveIntentOptions = {
  /**
   * Names the caller wants tried first. Useful for taskType-specific
   * preferences (e.g. trivial tasks may want to bias toward `ollama`
   * before falling back to a paid provider).
   */
  preferProviders?: readonly string[];
  /**
   * Specific (provider, model) pairs the caller refuses to route to,
   * encoded as "provider,model" strings to match the shape we get from
   * `memoryBias.forbiddenRoutes`.
   */
  forbidRoutes?: readonly string[];
  /**
   * When true, only models with `capabilities.visionInput: true` in the
   * static catalog (or `isVisionCapable` in the dynamic OpenRouter
   * catalog) are eligible. Used when the prompt contains images.
   */
  requireVision?: boolean;
};

/**
 * Pick the best catalog entry for a given routing intent, restricted
 * to providers that are *actually configured* on the registry.
 *
 * Selection rules:
 *   1. Filter the catalog to entries that bind this intent.
 *   2. Drop entries whose provider isn't registered or isn't `isReady`.
 *   3. Drop entries whose provider is on the forbid list.
 *   4. Among the survivors:
 *      - Entries whose provider is in `preferProviders` win, in the
 *        order they appear in that list.
 *      - Otherwise, ties broken by the binding's `rank` (lower wins).
 *   5. Return null if nothing matches.
 *
 * Returns a `RouteRef` with the intent + entry rank baked into
 * `rationale` so the report tells the user *why* this provider got
 * picked.
 */
export function resolveIntent(
  intent: Intent,
  registry: ProviderRegistry,
  opts: ResolveIntentOptions = {},
): RouteRef | null {
  const forbidRoutes = new Set(opts.forbidRoutes ?? []);
  const prefer = opts.preferProviders ?? [];

  // Providers whose concrete model is chosen later from a live catalog
  // (OpenRouter). Their static catalog entry is a placeholder, so we must
  // NOT gate them on the placeholder's `visionInput` flag — the actual
  // vision filtering happens in `selectSmartModel` below (or, when the
  // catalog is offline, via the curated fallback model which is itself
  // vision-capable).
  const dynamicProviders = new Set(
    registry
      .list()
      .filter((p) => p.dynamicCatalog === 'openrouter')
      .map((p) => p.name),
  );

  const candidates = CATALOG.flatMap((entry) => {
    if (forbidRoutes.has(`${entry.provider},${entry.model}`)) return [];
    if (!registry.has(entry.provider)) return [];
    if (!registry.isReady(entry.provider)) return [];
    // Provider-level readiness isn't model-level readiness for
    // ollama: the registry says "ready" when ANY configured model is
    // pulled, but this specific catalog entry's model may not be.
    if (entry.provider === 'ollama' && !isOllamaModelInstalled(entry.model)) return [];
    if (
      opts.requireVision &&
      !entry.capabilities?.visionInput &&
      !dynamicProviders.has(entry.provider)
    ) {
      return [];
    }
    const binding = entry.intents.find((b) => b.intent === intent);
    if (!binding) return [];
    let rank = binding.rank;
    // Demote codex for strong-model intents when we can't pick the
    // model (see STRONG_MODEL_INTENTS for rationale). The penalty is
    // large enough to push codex below every other rank in the
    // catalog so it only wins when nothing else is configured.
    if (
      entry.provider === 'codex' &&
      STRONG_MODEL_INTENTS.has(intent) &&
      codexAuthMode() !== 'apikey'
    ) {
      rank += CODEX_CHATGPT_RANK_PENALTY;
    }
    return [{ entry, rank }];
  });
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    // preferProviders has highest priority
    const aPref = prefer.indexOf(a.entry.provider);
    const bPref = prefer.indexOf(b.entry.provider);
    if (aPref !== bPref) {
      if (aPref === -1) return 1;
      if (bPref === -1) return -1;
      return aPref - bPref;
    }
    if (a.rank !== b.rank) return a.rank - b.rank;
    // Final tiebreaker: prefer the entry that appeared first in the
    // catalog so the file ordering is meaningful (local CLIs sit at
    // the top of CATALOG by convention).
    return CATALOG.indexOf(a.entry) - CATALOG.indexOf(b.entry);
  });

  const top = candidates[0]!;
  // The registry stores the adapter kind separately from the provider
  // name (so e.g. provider "deepseek" runs on the "openai_compat"
  // adapter). Pull both so the returned RouteRef matches what the rest
  // of the router emits via `preferProvider`.
  const cfg = registry.list().find((p) => p.name === top.entry.provider);
  if (!cfg) return null;

  // Smart model selection: when the winning provider is backed by the
  // OpenRouter dynamic catalog and that catalog is loaded, let the smart
  // router pick the best *current* model for this intent instead of the
  // curated `entry.model`. This keeps routing adaptive as OpenRouter's
  // lineup changes. Falls back to the hardcoded model when the catalog
  // is empty (offline / no key) or nothing clears the constraints.
  let model = top.entry.model;
  let rationale = `intent:${intent}@rank${top.rank}`;
  if (cfg.dynamicCatalog === 'openrouter') {
    const catalog = registry.listOpenRouterCatalogModels();
    if (catalog.length > 0) {
      const smart = selectSmartModel(catalog, intent, {
        requireTools: cfg.adapter === 'coderouter_agent',
        requireVision: opts.requireVision,
      });
      if (smart) {
        model = smart.id;
        rationale = smart.rationale;
      }
    }
  }

  return {
    provider: cfg.adapter,
    model,
    via: top.entry.provider,
    rationale,
  };
}

/**
 * Look up a catalog entry by provider + model. Used by the report
 * layer (and the wizard) when we want to surface a model's context
 * window or price without parsing the registry.
 */
export function lookupModel(provider: string, model: string): CatalogEntry | undefined {
  return CATALOG.find((e) => e.provider === provider && e.model === model);
}
