import { httpJson } from '../../adapters/http.js';
import type { ResearchHit, ResearchProvider, ResearchQuery } from '../types.js';

export type DocsOptions = {
  /** Mapping from library name to llms.txt URL. */
  registry?: Record<string, string>;
  timeoutMs?: number;
};

/**
 * Library docs fetcher. Resolves the library from the query, looks up
 * its `llms.txt` (or curated docs URL) in our registry, and returns a
 * single hit with the doc content as the snippet. Falls back to a web
 * search hint when the registry doesn't know the library.
 *
 * For v0 the registry is shipped inline; v0.1+ ships a community-
 * maintained docs-registry.json that we hot-load at startup.
 */
const DEFAULT_REGISTRY: Record<string, string> = {
  react: 'https://react.dev/llms.txt',
  vue: 'https://vuejs.org/llms.txt',
  fastapi: 'https://fastapi.tiangolo.com/llms.txt',
  django: 'https://www.djangoproject.com/llms.txt',
  express: 'https://expressjs.com/llms.txt',
  nextjs: 'https://nextjs.org/llms.txt',
  prisma: 'https://www.prisma.io/llms.txt',
};

const LIBRARY_REGEX = /\b(react|vue|svelte|fastapi|django|flask|express|nextjs|next\.js|prisma|drizzle|tailwind|pytorch|tensorflow|langchain)\b/i;

export class DocsProvider implements ResearchProvider {
  id = 'docs' as const;
  constructor(public readonly opts: DocsOptions = {}) {}

  async search(q: ResearchQuery): Promise<ResearchHit[]> {
    const registry = { ...DEFAULT_REGISTRY, ...(this.opts.registry ?? {}) };
    const m = LIBRARY_REGEX.exec(q.query);
    if (!m?.[1]) return [];
    const lib = m[1].toLowerCase().replace('.', '');
    const url = registry[lib];
    if (!url) return [];

    try {
      const text = await httpJson<string>({
        url,
        method: 'GET',
        timeoutMs: this.opts.timeoutMs ?? 8_000,
        headers: { Accept: 'text/plain' },
      });
      const snippet = typeof text === 'string' ? text.slice(0, 2_000) : '';
      return [
        {
          id: `docs-${lib}`,
          kind: 'docs' as const,
          title: `${lib} llms.txt`,
          url,
          source: 'docs-registry',
          snippet,
          language: q.language,
        },
      ];
    } catch {
      return [];
    }
  }
}
