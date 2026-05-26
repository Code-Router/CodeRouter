import { httpJson } from '../../adapters/http.js';
import type { ResearchHit, ResearchProvider, ResearchQuery } from '../types.js';

export type TavilyOptions = {
  apiKey?: string;
  apiKeyEnv?: string;
  endpoint?: string;
  timeoutMs?: number;
};

/**
 * Tavily web search adapter. Free tier is generous enough for everyday
 * Masterplan runs; the API is OpenAI-style "search + extract" so we
 * normalize its response into our `ResearchHit` shape.
 */
export class TavilyProvider implements ResearchProvider {
  id = 'tavily' as const;
  constructor(public readonly opts: TavilyOptions = {}) {}

  async search(q: ResearchQuery): Promise<ResearchHit[]> {
    const apiKey =
      this.opts.apiKey ?? process.env[this.opts.apiKeyEnv ?? 'TAVILY_API_KEY'];
    if (!apiKey) return [];
    const res = await httpJson<{
      results?: {
        title?: string;
        url?: string;
        content?: string;
        published_date?: string;
      }[];
    }>({
      url: this.opts.endpoint ?? 'https://api.tavily.com/search',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        api_key: apiKey,
        query: q.query,
        max_results: q.limit ?? 5,
        search_depth: 'basic',
      },
      timeoutMs: this.opts.timeoutMs ?? 12_000,
    }).catch(() => ({ results: [] }));

    return (res.results ?? []).map((r, i) => ({
      id: `tavily-${i}`,
      kind: 'web' as const,
      title: r.title ?? r.url ?? '(no title)',
      url: r.url ?? '',
      source: 'tavily',
      snippet: r.content?.slice(0, 400),
      publishedAt: r.published_date,
    }));
  }
}
