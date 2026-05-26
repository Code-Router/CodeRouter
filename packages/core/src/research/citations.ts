import type { Citation } from '../types.js';
import type { ResearchHit } from './types.js';

/**
 * Dedupes hits, assigns 1-based ids, and converts them to the typed
 * `Citation` shape (which is what the modes / report layer / MCP server
 * speak).
 *
 * Dedup is by (kind + url) for web/github/docs, with the most recent /
 * highest-snippet-length kept on conflicts.
 */
export function buildCitations(hits: ResearchHit[]): Citation[] {
  const byKey = new Map<string, ResearchHit>();
  for (const h of hits) {
    const key = `${h.kind}::${h.url || h.id}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, h);
      continue;
    }
    // Prefer the hit with more snippet content.
    if ((h.snippet?.length ?? 0) > (existing.snippet?.length ?? 0)) byKey.set(key, h);
  }
  const out: Citation[] = [];
  let id = 1;
  for (const h of byKey.values()) {
    out.push({
      id: id++,
      kind: h.kind,
      url: h.url || undefined,
      title: h.title,
      source: h.source,
      snippet: h.snippet,
      verified: false,
      fetchedAt: new Date().toISOString(),
    });
  }
  return out;
}

/**
 * Renders a numbered References section ready to append to a Masterplan
 * markdown body.
 */
export function renderReferences(citations: Citation[]): string {
  if (citations.length === 0) return '';
  const lines: string[] = ['## References', ''];
  for (const c of citations) {
    const verifiedTag = c.verified === false ? ' [UNVERIFIED]' : '';
    const where = c.url ? `[${c.title}](${c.url})` : c.title;
    lines.push(`${c.id}. ${where} - ${c.source}${verifiedTag}`);
  }
  return lines.join('\n');
}

/**
 * Inline `[N]` citation injector. For each occurrence of {{cite:keyword}}
 * in the body we resolve the best-matching citation by URL/title/snippet
 * keyword search and replace with `[N]`. Unmatched markers are left as
 * `[UNVERIFIED]`.
 */
export function injectInlineCitations(body: string, citations: Citation[]): string {
  if (citations.length === 0) return body;
  return body.replace(/\{\{cite:([^}]+)\}\}/g, (_, raw: string) => {
    const k = raw.toLowerCase();
    const hit = citations.find((c) => {
      const haystack = `${c.title} ${c.url ?? ''} ${c.snippet ?? ''}`.toLowerCase();
      return haystack.includes(k);
    });
    if (hit) return `[${hit.id}]`;
    return '[UNVERIFIED]';
  });
}

/**
 * Verification harness used by the masterplan critique phase. Walks the
 * citations, marks ones that resolve via fetch as verified, and flags
 * the rest as [UNVERIFIED] in the rendered output.
 */
export async function verifyCitations(citations: Citation[]): Promise<Citation[]> {
  const out = await Promise.all(
    citations.map(async (c) => {
      if (!c.url) return { ...c, verified: false };
      try {
        const res = await fetch(c.url, { method: 'HEAD' });
        return { ...c, verified: res.ok };
      } catch {
        return { ...c, verified: false };
      }
    }),
  );
  return out;
}
