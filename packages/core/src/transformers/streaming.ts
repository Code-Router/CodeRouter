import type { AdapterCallResult } from '../adapters/types.js';
import type { Transformer } from './types.js';

/**
 * Streaming-output passthrough.
 *
 * v0 of CodeRouter uses non-streaming JSON calls for API adapters (so we
 * can attribute cost and tokens accurately) and lets shell adapters
 * (Codex / Claude Code) stream natively through their CLI. This
 * transformer is the stable hook where future streaming adapters will
 * collapse partial events into the final `AdapterCallResult` shape.
 *
 * For now it acts as a passthrough and normalizes trailing whitespace.
 */
export const streaming: Transformer = {
  name: 'streaming',
  transformOut(result: AdapterCallResult): AdapterCallResult {
    if (!result.text) return result;
    const text = result.text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trimEnd();
    if (text === result.text) return result;
    return { ...result, text };
  },
};
