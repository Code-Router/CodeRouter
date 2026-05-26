import { httpJson } from '../../adapters/http.js';
import type { ResearchHit, ResearchProvider, ResearchQuery } from '../types.js';

export type BraveOptions = {
  apiKey?: string;
  apiKeyEnv?: string;
  endpoint?: string;
  timeoutMs?: number;
};

/** Brave Search API alternative to Tavily. */
export class BraveProvider implements ResearchProvider {
  id = 'brave' as const;
  constructor(public readonly opts: BraveOptions = {}) {}

  async search(q: ResearchQuery): Promise<ResearchHit[]> {
    const apiKey = this.opts.apiKey ?? process.env[this.opts.apiKeyEnv ?? 'BRAVE_API_KEY'];
    if (!apiKey) return [];
    const url = new URL(this.opts.endpoint ?? 'https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', q.query);
    if (q.limit) url.searchParams.set('count', String(q.limit));
    const res = await httpJson<{
      web?: {
        results?: { title?: string; url?: string; description?: string; page_age?: string }[];
      };
    }>({
      url: url.toString(),
      method: 'GET',
      headers: { 'X-Subscription-Token': apiKey, Accept: 'application/json' },
      timeoutMs: this.opts.timeoutMs ?? 12_000,
    }).catch(() => ({ web: { results: [] } }));

    return (res.web?.results ?? []).map((r, i) => ({
      id: `brave-${i}`,
      kind: 'web' as const,
      title: r.title ?? r.url ?? '(no title)',
      url: r.url ?? '',
      source: 'brave',
      snippet: r.description?.slice(0, 400),
      publishedAt: r.page_age,
    }));
  }
}
