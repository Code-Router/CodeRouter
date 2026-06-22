/**
 * Minimal YAML-frontmatter parser for the customize layer.
 *
 * We deliberately avoid a YAML dependency: rules / skills / subagents
 * use a tiny, predictable subset (string / number / boolean scalars,
 * inline `[a, b]` arrays, and block `- item` arrays). This handles that
 * subset and nothing more — anything fancier falls back to a raw string
 * so a hand-written file never throws.
 */

export type Frontmatter = Record<string, string | number | boolean | string[]>;

export type ParsedDoc = {
  data: Frontmatter;
  body: string;
};

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Split a markdown doc into its frontmatter block + body. */
export function parseFrontmatter(raw: string): ParsedDoc {
  const m = FENCE.exec(raw);
  if (!m) return { data: {}, body: raw };
  const data = parseYamlBlock(m[1] ?? '');
  const body = raw.slice(m[0].length);
  return { data, body };
}

/** Serialize a doc back to `---\nfrontmatter\n---\nbody`. */
export function stringifyFrontmatter(data: Frontmatter, body: string): string {
  const lines: string[] = ['---'];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${quoteIfNeeded(String(item))}`);
    } else if (typeof value === 'boolean' || typeof value === 'number') {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${quoteIfNeeded(value)}`);
    }
  }
  lines.push('---', '');
  const trimmedBody = body.replace(/^\n+/, '');
  return `${lines.join('\n')}\n${trimmedBody.endsWith('\n') ? trimmedBody : `${trimmedBody}\n`}`;
}

function parseYamlBlock(block: string): Frontmatter {
  const out: Frontmatter = {};
  const lines = block.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    i++;
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    if (!key) continue;
    const rest = line.slice(colon + 1).trim();

    if (rest === '') {
      // Possible block-style array on the following indented `- ` lines.
      const items: string[] = [];
      while (i < lines.length && /^\s*-\s+/.test(lines[i]!)) {
        items.push(stripQuotes(lines[i]!.replace(/^\s*-\s+/, '').trim()));
        i++;
      }
      out[key] = items;
      continue;
    }

    out[key] = parseScalarOrInlineArray(rest);
  }
  return out;
}

function parseScalarOrInlineArray(rest: string): string | number | boolean | string[] {
  // Inline array: [a, b, "c d"]
  if (rest.startsWith('[') && rest.endsWith(']')) {
    const inner = rest.slice(1, -1).trim();
    if (!inner) return [];
    return splitTopLevel(inner).map((s) => stripQuotes(s.trim()));
  }
  const unq = stripQuotes(rest);
  // Only treat as boolean/number when it was unquoted.
  if (unq === rest) {
    if (rest === 'true') return true;
    if (rest === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(rest)) return Number(rest);
  }
  return unq;
}

/** Split on commas that aren't inside quotes. */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function stripQuotes(s: string): string {
  if (s.length >= 2 && ((s[0] === '"' && s.at(-1) === '"') || (s[0] === "'" && s.at(-1) === "'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function quoteIfNeeded(s: string): string {
  // Quote when the value could be misread (contains :, #, leading/trailing
  // space, or looks like a bool/number we don't mean literally).
  if (s === '' || /[:#]/.test(s) || /^\s|\s$/.test(s) || s.includes(',')) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}
