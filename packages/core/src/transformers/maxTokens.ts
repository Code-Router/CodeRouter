import type { AdapterCallInput } from '../adapters/types.js';
import type { Transformer, TransformerContext } from './types.js';

/**
 * Clamps max-tokens to a sensible per-provider ceiling so we don't trip
 * over per-model output limits (e.g. Claude Sonnet 8k, GPT-5 16k, Gemini
 * Pro 64k). If unset, applies a default appropriate for the route.
 */
const CEILINGS: Record<string, number> = {
  openai: 16_000,
  anthropic: 8_000,
  google: 64_000,
  openai_compat: 8_000,
  ollama: 4_096,
};

export const maxTokens: Transformer = {
  name: 'maxTokens',
  transformIn(input: AdapterCallInput, ctx: TransformerContext): AdapterCallInput {
    const ceiling =
      CEILINGS[ctx.capabilities?.family === 'api-model' ? (ctx.providerName ?? '') : ''] ??
      8_000;
    if (input.maxTokens === undefined) return { ...input, maxTokens: ceiling };
    if (input.maxTokens > ceiling) return { ...input, maxTokens: ceiling };
    return input;
  },
};
