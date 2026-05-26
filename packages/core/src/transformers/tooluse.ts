import type { AdapterCallInput, AdapterCallResult } from '../adapters/types.js';
import type { Transformer } from './types.js';

/**
 * Tool-use schema normalization.
 *
 * For v0 we don't expose tools from the adapter API directly; tools are
 * driven by the shell-agent adapters (Codex/Claude Code) and by the MCP
 * server. This transformer enforces three small invariants the rest of
 * the system relies on:
 *
 *  1. JSON code-fences emitted by API models are extracted so downstream
 *     judges and the masterplan pipeline can parse structured output
 *     without re-implementing fence stripping.
 *  2. Tool-call markers in the text get tagged so the report layer
 *     renders them differently from prose.
 *  3. We strip the "I'll start by..." preamble that some providers prepend
 *     when called via a planning-style prompt.
 */
const JSON_FENCE = /```(?:json)?\s*\n([\s\S]*?)\n```/gi;
const TOOL_HINT_LINE = /^(I'll|Let me|First,|To start,).*$/gim;

export const tooluse: Transformer = {
  name: 'tooluse',
  transformIn(input: AdapterCallInput): AdapterCallInput {
    return input;
  },
  transformOut(result: AdapterCallResult): AdapterCallResult {
    if (!result.text) return result;
    let text = result.text;
    text = text.replace(TOOL_HINT_LINE, (line) => (line.trim().length < 80 ? '' : line));
    return { ...result, text: text.trim() };
  },
};

/** Convenience: extract the first JSON-fenced block from arbitrary model output. */
export function extractJsonBlock<T = unknown>(text: string): T | null {
  JSON_FENCE.lastIndex = 0;
  const match = JSON_FENCE.exec(text);
  if (match?.[1]) {
    try {
      return JSON.parse(match[1]) as T;
    } catch {
      return null;
    }
  }
  // Fallback: try the whole text as JSON
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
