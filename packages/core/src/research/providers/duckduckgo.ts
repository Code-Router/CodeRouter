import type { ResearchHit, ResearchProvider, ResearchQuery } from '../types.js';

export type DuckDuckGoOptions = {
  /** Override the HTML endpoint (mainly for tests). */
  endpoint?: string;
  timeoutMs?: number;
  /** Custom fetch implementation (mainly for tests). */
  fetchImpl?: typeof fetch;
};

/**
 * Keyless web search via DuckDuckGo's HTML endpoint.
 *
 * DuckDuckGo doesn't require an API key for its `html.duckduckgo.com`
 * results page, so we POST the query and scrape the result anchors +
 * snippets out of the returned markup. This keeps web search working
 * out of the box with no Tavily/Brave key to configure.
 *
 * The markup is unofficial and can shift, so parsing is defensive:
 * if the structure changes we just return fewer (or zero) hits rather
 * than throwing.
 */
export class DuckDuckGoProvider implements ResearchProvider {
  id = 'duckduckgo' as const;
  constructor(public readonly opts: DuckDuckGoOptions = {}) {}

  async search(q: ResearchQuery): Promise<ResearchHit[]> {
    const endpoint = this.opts.endpoint ?? 'https://html.duckduckgo.com/html/';
    const doFetch = this.opts.fetchImpl ?? fetch;
    const ctl = new AbortController();
    const timeout = setTimeout(() => ctl.abort(), this.opts.timeoutMs ?? 12_000);
    let html = '';
    try {
      const res = await doFetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // A browser-like UA avoids the empty/blocked response DDG
          // returns for unknown clients.
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        },
        body: new URLSearchParams({ q: q.query }).toString(),
        signal: ctl.signal,
      });
      if (!res.ok) return [];
      html = await res.text();
    } catch {
      return [];
    } finally {
      clearTimeout(timeout);
    }

    return parseDuckDuckGoHtml(html, q.limit ?? 5);
  }
}

/** Parse the html.duckduckgo.com results page into ResearchHits. */
export function parseDuckDuckGoHtml(html: string, limit: number): ResearchHit[] {
  const hits: ResearchHit[] = [];

  // Each result anchor: <a ... class="result__a" ... href="...">title</a>
  const anchorRe = /<a\b[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  // Snippets appear in document order alongside the anchors.
  const snippetRe = /<a\b[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;

  const snippets: string[] = [];
  for (const m of html.matchAll(snippetRe)) {
    snippets.push(cleanHtml(m[1] ?? ''));
  }

  let i = 0;
  for (const m of html.matchAll(anchorRe)) {
    if (hits.length >= limit) break;
    const rawHref = m[1] ?? '';
    const title = cleanHtml(m[2] ?? '');
    const url = resolveDdgUrl(rawHref);
    if (!url || !title) {
      i++;
      continue;
    }
    hits.push({
      id: `ddg-${i}`,
      kind: 'web',
      title,
      url,
      source: 'duckduckgo',
      snippet: snippets[i],
    });
    i++;
  }

  return hits;
}

/**
 * DuckDuckGo wraps result URLs in a redirect:
 *   //duckduckgo.com/l/?uddg=<encoded-url>&rut=...
 * Unwrap the `uddg` param; pass through already-absolute URLs.
 */
function resolveDdgUrl(href: string): string | null {
  let h = href.trim();
  if (!h) return null;
  if (h.startsWith('//')) h = `https:${h}`;
  try {
    const u = new URL(h);
    const uddg = u.searchParams.get('uddg');
    if (uddg) return uddg;
    return u.toString();
  } catch {
    return null;
  }
}

/** Strip HTML tags and decode the handful of entities DDG emits. */
function cleanHtml(s: string): string {
  const noTags = s.replace(/<[^>]+>/g, '');
  return noTags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
