/**
 * Fallback parser for tool calls emitted as plain text.
 *
 * Native OpenAI-style function calling returns a structured `tool_calls`
 * array. But many open models served through OpenRouter (Qwen, Hermes,
 * smaller Llama/Mistral fine-tunes, ...) don't reliably use it — instead
 * they print the call into the assistant's `content` using one of a few
 * ad-hoc text formats. When that happens the orchestrator would see an
 * empty `tool_calls`, treat the text as a final answer and stop mid-task.
 *
 * This module recognises the two formats we see in the wild and converts
 * them into the same `ToolCall` shape the loop already handles:
 *
 *   1. Hermes / Qwen JSON:
 *        <tool_call>
 *        {"name": "web_search", "arguments": {"query": "x", "limit": 5}}
 *        </tool_call>
 *
 *   2. Qwen XML ("function=" / "parameter="):
 *        <tool_call>
 *        <function=web_search>
 *        <parameter=query>
 *        x
 *        </parameter>
 *        <parameter=limit>
 *        5
 *        </parameter>
 *        </function>
 *        </tool_call>
 *
 * The wrapping `<tool_call>` tags are optional (some models omit them).
 * Closing tags may also be missing when the model stops at the budget,
 * so the regexes tolerate end-of-string.
 */

import type { ToolCall } from '../transport/types.js';

export type ParsedTextualToolCalls = {
  toolCalls: ToolCall[];
  /** `content` with the recognised tool-call blocks stripped out. */
  cleanedContent: string;
};

let seq = 0;
function nextId(): string {
  seq += 1;
  return `txt-${Date.now().toString(36)}-${seq}`;
}

/**
 * Coerce a raw string parameter value into a JS value. Models write
 * `5`, `true`, `["a","b"]` etc. as bare text; tool schemas often expect
 * the typed form, so we best-effort parse and fall back to the string.
 */
function coerceValue(raw: string): unknown {
  const v = raw.trim();
  if (v === '') return '';
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null') return null;
  if (/^-?\d+$/.test(v)) return Number(v);
  if (/^-?\d*\.\d+$/.test(v)) return Number(v);
  if ((v.startsWith('{') && v.endsWith('}')) || (v.startsWith('[') && v.endsWith(']'))) {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
}

function parseXmlFunction(block: string): ToolCall | null {
  const fn = block.match(/<function\s*=\s*([^>\s]+)\s*>([\s\S]*?)(?:<\/function>|$)/i);
  if (!fn) return null;
  const name = fn[1]!.trim();
  const body = fn[2] ?? '';
  const args: Record<string, unknown> = {};
  const paramRe = /<parameter\s*=\s*([^>\s]+)\s*>([\s\S]*?)(?:<\/parameter>|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = paramRe.exec(body)) !== null) {
    const key = m[1]!.trim();
    args[key] = coerceValue(m[2] ?? '');
  }
  return {
    id: nextId(),
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  };
}

function parseJsonCall(block: string): ToolCall | null {
  // Pull the first balanced-looking JSON object out of the block.
  const start = block.indexOf('{');
  const end = block.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(block.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const rec = obj as Record<string, unknown>;
  const name = typeof rec.name === 'string' ? rec.name : typeof rec.tool === 'string' ? rec.tool : null;
  if (!name) return null;
  const rawArgs = rec.arguments ?? rec.parameters ?? rec.args ?? {};
  const argString = typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs ?? {});
  return {
    id: nextId(),
    type: 'function',
    function: { name, arguments: argString },
  };
}

/**
 * Extract textual tool calls from assistant content. Returns the parsed
 * calls plus the content with those blocks removed (so we don't echo raw
 * XML/JSON to the user or persist it into the transcript).
 *
 * `knownTools`, when provided, filters out parsed calls whose name isn't
 * a real tool — avoids misfiring on prose that merely mentions a tag.
 */
export function parseTextualToolCalls(
  content: string,
  knownTools?: Set<string>,
): ParsedTextualToolCalls {
  if (!content || (!content.includes('<tool_call') && !content.includes('<function='))) {
    return { toolCalls: [], cleanedContent: content };
  }

  const toolCalls: ToolCall[] = [];
  let cleaned = content;

  const consume = (re: RegExp, parse: (block: string) => ToolCall | null) => {
    const spans: Array<[number, number]> = [];
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(cleaned)) !== null) {
      const tc = parse(m[0]);
      if (tc && (!knownTools || knownTools.has(tc.function.name))) {
        toolCalls.push(tc);
        spans.push([m.index, m.index + m[0].length]);
      }
      if (m[0].length === 0) re.lastIndex++; // guard against zero-width
    }
    // Remove matched spans back-to-front so indices stay valid.
    for (let i = spans.length - 1; i >= 0; i--) {
      cleaned = cleaned.slice(0, spans[i]![0]) + cleaned.slice(spans[i]![1]);
    }
  };

  // 1) Wrapped blocks: <tool_call> ... </tool_call> (closing optional).
  consume(/<tool_call>\s*([\s\S]*?)(?:<\/tool_call>|$)/gi, (block) => {
    const inner = block.replace(/^<tool_call>/i, '').replace(/<\/tool_call>$/i, '');
    return inner.includes('<function=') ? parseXmlFunction(inner) : parseJsonCall(inner);
  });

  // 2) Bare <function=...> blocks that weren't wrapped in <tool_call>.
  if (cleaned.includes('<function=')) {
    consume(/<function\s*=\s*[^>\s]+\s*>[\s\S]*?(?:<\/function>|$)/gi, (block) =>
      parseXmlFunction(block),
    );
  }

  return { toolCalls, cleanedContent: cleaned.trim() };
}
