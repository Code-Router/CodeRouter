/**
 * Smart model selector.
 *
 * Given the live OpenRouter catalog and a routing intent, filter to
 * eligible models (capability + hard constraints), score them per
 * intent, and return them ranked best-first. This is what lets a user
 * with only an OpenRouter key get a sensible model auto-picked from the
 * hundreds available, and have that choice adapt as the lineup changes.
 *
 * Pure: no network, no registry. Feed it `OpenRouterModel[]` (e.g. from
 * `registry.listOpenRouterCatalogModels()`).
 */

import type { Intent } from '../../catalog/types.js';
import {
  type OpenRouterModel,
  isToolCapable,
  isVisionCapable,
  pricePer1MIn,
  pricePer1MOut,
} from '../../agent/providers/openrouter.js';
import { explain, scoreFor, type ScoreInput } from './score.js';

export type SmartConstraints = {
  /** Require tool-calling (agent / editing intents). Default false. */
  requireTools?: boolean;
  /** Require vision/image input capability. Default false. */
  requireVision?: boolean;
  /** Minimum context window in tokens. Default 0. */
  minContextWindow?: number;
  /** Hard price ceilings (USD per 1M). Undefined = no ceiling. */
  maxPricePer1MIn?: number;
  maxPricePer1MOut?: number;
  /**
   * Include $0/$0 "free" variants. Default false: free models are
   * usually preview / heavily rate-limited and make for flaky agent
   * runs, so we skip them in auto-selection (explicit --route still
   * works).
   */
  allowFree?: boolean;
};

export type ScoredModel = {
  id: string;
  score: number;
  pricePer1MIn: number;
  pricePer1MOut: number;
  contextWindow: number;
  rationale: string;
};

/** Per-intent default constraints layered under any caller overrides. */
const INTENT_DEFAULTS: Record<Intent, SmartConstraints> = {
  'balanced-agent': { minContextWindow: 16_000 },
  'multi-file': { minContextWindow: 60_000 },
  'deep-reasoning': { minContextWindow: 16_000 },
  'huge-context': { minContextWindow: 200_000 },
  'fast-cheap': { minContextWindow: 8_000 },
  'local-offline': {},
};

function toScoreInput(m: OpenRouterModel): ScoreInput {
  return {
    id: m.id,
    pricePer1MIn: pricePer1MIn(m),
    pricePer1MOut: pricePer1MOut(m),
    contextWindow: m.context_length ?? 0,
    supportedParameters: m.supported_parameters,
  };
}

function eligible(m: OpenRouterModel, c: SmartConstraints): boolean {
  if (c.requireTools && !isToolCapable(m)) return false;
  if (c.requireVision && !isVisionCapable(m)) return false;
  const inP = pricePer1MIn(m);
  const outP = pricePer1MOut(m);
  if (!c.allowFree && inP === 0 && outP === 0) return false;
  if (c.maxPricePer1MIn !== undefined && inP > c.maxPricePer1MIn) return false;
  if (c.maxPricePer1MOut !== undefined && outP > c.maxPricePer1MOut) return false;
  const ctx = m.context_length ?? 0;
  if (c.minContextWindow !== undefined && ctx < c.minContextWindow) return false;
  return true;
}

/**
 * Rank all eligible models for an intent, best-first. `local-offline`
 * always returns [] (OpenRouter isn't a local backend).
 */
export function selectSmartModels(
  models: OpenRouterModel[],
  intent: Intent,
  overrides: SmartConstraints = {},
): ScoredModel[] {
  if (intent === 'local-offline') return [];
  const constraints: SmartConstraints = { ...INTENT_DEFAULTS[intent], ...overrides };

  const scored = models
    .filter((m) => eligible(m, constraints))
    .map((m) => {
      const si = toScoreInput(m);
      const score = scoreFor(si, intent);
      return {
        id: m.id,
        score,
        pricePer1MIn: si.pricePer1MIn,
        pricePer1MOut: si.pricePer1MOut,
        contextWindow: si.contextWindow,
        rationale: explain(si, intent, score),
      } satisfies ScoredModel;
    });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Tie-break toward the cheaper model, then the larger context.
    const ap = a.pricePer1MIn + a.pricePer1MOut;
    const bp = b.pricePer1MIn + b.pricePer1MOut;
    if (ap !== bp) return ap - bp;
    return b.contextWindow - a.contextWindow;
  });
  return scored;
}

/** Best model for an intent, or null when nothing is eligible. */
export function selectSmartModel(
  models: OpenRouterModel[],
  intent: Intent,
  overrides: SmartConstraints = {},
): ScoredModel | null {
  return selectSmartModels(models, intent, overrides)[0] ?? null;
}
