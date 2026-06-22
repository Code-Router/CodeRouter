/**
 * Resolve a model id to a normalized `ModelCard`.
 *
 * Two paths:
 *   1. Curated match (exact id or alias) -> the benchmark-grounded card,
 *      with live OpenRouter price / context / capabilities merged in
 *      when available (live always wins for price + context; caps are
 *      unioned so a curated `tools:true` is never downgraded by a stale
 *      live payload).
 *   2. Unknown model -> a *conservative* prior: capabilities come only
 *      from live metadata, and the coding score is pinned low (small
 *      tier). Critically NOT name-optimistic, so an unverified `*-9b`
 *      can never outrank a known frontier model on quality alone. This
 *      is the fix for the qwen-9b regression.
 */

import {
  type OpenRouterModel,
  isToolCapable,
  isVisionCapable,
  pricePer1MIn,
  pricePer1MOut,
} from '../agent/providers/openrouter.js';
import { type ModelCard, type Modality, findCard } from './cards.js';

/** Coding score assigned to models we have no benchmark prior for. */
export const UNKNOWN_CODING_PRIOR = 40;
export const UNKNOWN_REASONING_PRIOR = 38;

function liveInputs(m: OpenRouterModel): Modality[] {
  const mods = m.architecture?.input_modalities;
  if (Array.isArray(mods) && mods.length > 0) {
    const out: Modality[] = [];
    for (const mod of mods) {
      if (mod === 'text' || mod === 'image' || mod === 'audio' || mod === 'video') out.push(mod);
    }
    if (!out.includes('text')) out.unshift('text');
    return out;
  }
  return ['text'];
}

function liveReasoning(m: OpenRouterModel): boolean {
  const params = m.supported_parameters;
  if (!Array.isArray(params)) return false;
  return params.includes('reasoning') || params.includes('include_reasoning');
}

/**
 * Resolve a model id (curated or arbitrary) to a normalized card.
 *
 * @param id    The wire-level model id (e.g. `anthropic/claude-opus-4-5`,
 *              `gpt-5-codex`, `qwen/qwen3.5-9b`).
 * @param live  Optional live OpenRouter catalog entry to merge in.
 */
export function resolveCard(id: string, live?: OpenRouterModel | null): ModelCard {
  const curated = findCard(id);
  if (curated) {
    if (!live) return curated;
    // Merge live price/context/caps onto the curated prior.
    return {
      ...curated,
      contextWindow: live.context_length ?? curated.contextWindow,
      pricePer1MIn: pricePer1MIn(live) || curated.pricePer1MIn,
      pricePer1MOut: pricePer1MOut(live) || curated.pricePer1MOut,
      // Caps are unioned: never downgrade a curated capability.
      tools: curated.tools || isToolCapable(live),
      inputs: unionInputs(curated.inputs, liveInputs(live)),
      reasoning: curated.reasoning || liveReasoning(live),
    };
  }

  // Unknown model: conservative prior, capabilities only from live data.
  if (live) {
    return {
      id: live.id,
      aliases: [],
      family: familyOf(live.id),
      inputs: liveInputs(live),
      tools: isToolCapable(live),
      reasoning: liveReasoning(live),
      contextWindow: live.context_length ?? 0,
      quality: { coding: UNKNOWN_CODING_PRIOR, reasoning: UNKNOWN_REASONING_PRIOR },
      pricePer1MIn: pricePer1MIn(live),
      pricePer1MOut: pricePer1MOut(live),
      sources: ['unknown model: conservative prior'],
    };
  }

  // No curated match and no live metadata: minimal conservative card.
  return {
    id,
    aliases: [],
    family: familyOf(id),
    inputs: ['text'],
    tools: false,
    reasoning: false,
    contextWindow: 0,
    quality: { coding: UNKNOWN_CODING_PRIOR, reasoning: UNKNOWN_REASONING_PRIOR },
    sources: ['unknown model: conservative prior (no live metadata)'],
  };
}

function unionInputs(a: Modality[], b: Modality[]): Modality[] {
  const set = new Set<Modality>([...a, ...b]);
  return [...set];
}

function familyOf(id: string): string {
  const slug = id.includes('/') ? id.split('/')[1]! : id;
  const m = slug.toLowerCase().match(/^[a-z]+/);
  return m ? m[0] : 'unknown';
}
