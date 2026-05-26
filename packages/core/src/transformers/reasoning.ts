import type { AdapterCallInput, AdapterCallResult } from '../adapters/types.js';
import type { Transformer, TransformerContext } from './types.js';

/**
 * Reasoning effort normalization across providers.
 *
 * - OpenAI o-series uses `reasoning_effort`.
 * - DeepSeek-Reasoner uses `reasoning_effort` too (different ladder).
 * - Anthropic Sonnet/Opus expose `thinking.budget_tokens`.
 *
 * Most provider differences are already handled in each adapter; this
 * transformer is the central place where a generic "low|medium|high|max"
 * effort hint is mapped to whatever the route needs. It also strips
 * reasoning markers from output so downstream consumers (judge, eval
 * harness) see clean text.
 */
const THINKING_BLOCK = /<thinking>[\s\S]*?<\/thinking>\s*/gi;
const REASONING_BLOCK = /<reasoning>[\s\S]*?<\/reasoning>\s*/gi;

export const reasoning: Transformer = {
  name: 'reasoning',
  transformIn(input: AdapterCallInput, ctx: TransformerContext): AdapterCallInput {
    if (!input.reasoningEffort) return input;
    if (!ctx.capabilities?.reasoning) {
      const next = { ...input };
      delete next.reasoningEffort;
      return next;
    }
    return input;
  },
  transformOut(result: AdapterCallResult): AdapterCallResult {
    if (!result.text) return result;
    const cleaned = result.text
      .replace(THINKING_BLOCK, '')
      .replace(REASONING_BLOCK, '')
      .trimStart();
    if (cleaned === result.text) return result;
    return { ...result, text: cleaned };
  },
};
