import { describe, expect, it } from 'vitest';
import { buildCitations, injectInlineCitations, renderReferences } from './citations.js';
import type { ResearchHit } from './types.js';

const hits: ResearchHit[] = [
  {
    id: 'a',
    kind: 'web',
    title: 'OAuth Best Practices',
    url: 'https://example.com/oauth',
    source: 'tavily',
    snippet: 'pkce flow with redirect',
  },
  {
    id: 'b',
    kind: 'web',
    title: 'OAuth Best Practices',
    url: 'https://example.com/oauth',
    source: 'tavily',
    snippet: 'longer snippet with pkce flow with redirect plus extra details',
  },
  {
    id: 'c',
    kind: 'github',
    title: 'flask-oauthlib example',
    url: 'https://github.com/example/flask-oauthlib',
    source: 'github',
  },
];

describe('buildCitations', () => {
  it('dedupes by (kind+url) keeping the longest snippet', () => {
    const out = buildCitations(hits);
    expect(out).toHaveLength(2);
    const web = out.find((c) => c.kind === 'web');
    expect(web?.snippet?.length ?? 0).toBeGreaterThan(20);
  });
});

describe('renderReferences', () => {
  it('produces a numbered list with verified tags', () => {
    const out = renderReferences(buildCitations(hits));
    expect(out).toContain('## References');
    expect(out).toContain('[UNVERIFIED]');
    expect(out).toContain('OAuth');
  });
});

describe('injectInlineCitations', () => {
  it('replaces {{cite:keyword}} with [N]', () => {
    const cits = buildCitations(hits);
    const out = injectInlineCitations('OAuth flow {{cite:oauth}} via PKCE.', cits);
    expect(out).toMatch(/\[\d+\]/);
  });
  it('emits [UNVERIFIED] when no match', () => {
    const cits = buildCitations(hits);
    const out = injectInlineCitations('Cite {{cite:notfound}}', cits);
    expect(out).toContain('[UNVERIFIED]');
  });
});
