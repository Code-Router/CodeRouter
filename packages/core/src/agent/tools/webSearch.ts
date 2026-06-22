import { BraveProvider } from '../../research/providers/brave.js';
import { DuckDuckGoProvider } from '../../research/providers/duckduckgo.js';
import { TavilyProvider } from '../../research/providers/tavily.js';
import type { ResearchHit, ResearchProvider } from '../../research/types.js';
import type { Tool, ToolResult } from '../types.js';
import { clip, oneLine, quoted, stringArg } from './helpers.js';

/** Hard cap on web_search output (bytes). */
const MAX_SEARCH_BYTES = 16 * 1024;
/** Default number of results to return. */
const DEFAULT_LIMIT = 5;

export const webSearchTool: Tool = {
  name: 'web_search',
  description:
    'Search the web for current information, documentation, library usage, error messages, or anything ' +
    'not present in the local codebase. Returns a ranked list of results with title, URL, and a short ' +
    'snippet. Works out of the box (no API key required). Use this when you need up-to-date facts or ' +
    'external references rather than relying on memory for fast-moving libraries.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query.' },
      limit: {
        type: 'number',
        description: `Max number of results to return (default ${DEFAULT_LIMIT}).`,
      },
    },
    required: ['query'],
  },
  describe: (args) => `Searched the web for ${quoted(oneLine(stringArg(args, 'query'), 60))}`,
  run: async (args, ctx) => {
    const query = stringArg(args, 'query');
    const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : DEFAULT_LIMIT;
    return runWebSearch(query, limit, ctx.signal);
  },
};

async function runWebSearch(
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<ToolResult> {
  if (signal?.aborted) {
    return { body: '(aborted)', ok: false, display: 'aborted' };
  }

  // Provider order: use Tavily/Brave only when a key is configured
  // (better snippets), otherwise fall back to the keyless DuckDuckGo
  // scraper so search always works with zero setup.
  const providers: ResearchProvider[] = [];
  if (process.env.TAVILY_API_KEY) providers.push(new TavilyProvider());
  if (process.env.BRAVE_API_KEY) providers.push(new BraveProvider());
  providers.push(new DuckDuckGoProvider());

  let hits: ResearchHit[] = [];
  for (const provider of providers) {
    hits = await provider.search({ query, limit }).catch(() => [] as ResearchHit[]);
    if (hits.length > 0) break;
  }

  if (hits.length === 0) {
    return { body: '(no results)', display: 'no results', ok: true };
  }

  const formatted = hits
    .slice(0, limit)
    .map((h, i) => {
      const parts = [`${i + 1}. ${h.title}`, `   ${h.url}`];
      if (h.snippet) parts.push(`   ${oneLine(h.snippet, 300)}`);
      if (h.publishedAt) parts.push(`   (${h.publishedAt})`);
      return parts.join('\n');
    })
    .join('\n\n');

  const { text, truncated } = clip(formatted, MAX_SEARCH_BYTES);
  return {
    body: `${text}${truncated ? '\n[truncated]' : ''}`,
    display: `${hits.length} result${hits.length === 1 ? '' : 's'}`,
    ok: true,
  };
}
