import type { Adapter, AdapterCallInput, AdapterCallResult } from '../adapters/types.js';
import { maxTokens } from './maxTokens.js';
import { reasoning } from './reasoning.js';
import { streaming } from './streaming.js';
import { tooluse } from './tooluse.js';
import type { Transformer, TransformerContext } from './types.js';

export { reasoning, maxTokens, tooluse, streaming };
export { extractJsonBlock } from './tooluse.js';
export type { Transformer, TransformerContext } from './types.js';

const REGISTRY: Record<string, Transformer> = {
  reasoning,
  maxTokens,
  tooluse,
  streaming,
};

export function registerTransformer(t: Transformer): void {
  REGISTRY[t.name] = t;
}

export function getTransformer(name: string): Transformer | undefined {
  return REGISTRY[name];
}

/**
 * Wraps an Adapter so that its `run` (and `plan`) go through the named
 * transformer chain. Used by the provider registry, which carries
 * `transformer: string[]` on each route.
 *
 * Composition order: transformIn runs left->right (last input wins);
 * transformOut runs right->left (so the outermost in the chain has the
 * final say over the result).
 */
export function applyTransformers(
  adapter: Adapter,
  names: string[],
  providerName?: string,
): Adapter {
  if (names.length === 0) return adapter;
  const chain = names
    .map((n) => REGISTRY[n])
    .filter((t): t is Transformer => Boolean(t));
  if (chain.length === 0) return adapter;
  const ctx: TransformerContext = {
    providerName: providerName ?? adapter.name,
    model: (adapter as unknown as { opts?: { model?: string } }).opts?.model,
    capabilities: adapter.capabilities,
  };

  const wrapRun = (
    fn: (input: AdapterCallInput) => Promise<AdapterCallResult>,
  ): ((input: AdapterCallInput) => Promise<AdapterCallResult>) => {
    return async (input: AdapterCallInput): Promise<AdapterCallResult> => {
      let next = input;
      for (const t of chain) if (t.transformIn) next = t.transformIn(next, ctx);
      let result = await fn(next);
      for (const t of [...chain].reverse()) {
        if (t.transformOut) result = t.transformOut(result, ctx);
      }
      return result;
    };
  };

  const wrapped: Adapter = {
    id: adapter.id,
    name: adapter.name,
    capabilities: adapter.capabilities,
    estimateCost: adapter.estimateCost.bind(adapter),
    run: wrapRun(adapter.run.bind(adapter)),
  };
  if (adapter.plan) wrapped.plan = wrapRun(adapter.plan.bind(adapter));
  if (adapter.score) wrapped.score = adapter.score.bind(adapter);
  return wrapped;
}
