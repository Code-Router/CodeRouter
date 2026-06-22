import { describe, expect, it } from 'vitest';
import { DuckDuckGoProvider, parseDuckDuckGoHtml } from './duckduckgo.js';

const SAMPLE_HTML = `
<div class="result results_links results_links_deep web-result">
  <div class="links_main">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnodejs.org%2Fapi%2Ffetch.html&amp;rut=abc">Node.js <b>fetch</b> docs</a>
    </h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnodejs.org">The global <b>fetch()</b> API is available.</a>
  </div>
</div>
<div class="result results_links results_links_deep web-result">
  <div class="links_main">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Ffoo&amp;rut=def">Example &amp; More</a>
    </h2>
    <a class="result__snippet" href="#">Second result snippet&#x27;s text.</a>
  </div>
</div>
`;

describe('parseDuckDuckGoHtml', () => {
  it('extracts titles, decoded URLs, and snippets', () => {
    const hits = parseDuckDuckGoHtml(SAMPLE_HTML, 5);
    expect(hits).toHaveLength(2);
    expect(hits[0]!.title).toBe('Node.js fetch docs');
    expect(hits[0]!.url).toBe('https://nodejs.org/api/fetch.html');
    expect(hits[0]!.snippet).toBe('The global fetch() API is available.');
    expect(hits[0]!.source).toBe('duckduckgo');
  });

  it('decodes HTML entities in titles and snippets', () => {
    const hits = parseDuckDuckGoHtml(SAMPLE_HTML, 5);
    expect(hits[1]!.title).toBe('Example & More');
    expect(hits[1]!.url).toBe('https://example.com/foo');
    expect(hits[1]!.snippet).toBe("Second result snippet's text.");
  });

  it('honors the limit', () => {
    const hits = parseDuckDuckGoHtml(SAMPLE_HTML, 1);
    expect(hits).toHaveLength(1);
  });

  it('returns [] for empty/garbage html', () => {
    expect(parseDuckDuckGoHtml('', 5)).toEqual([]);
    expect(parseDuckDuckGoHtml('<html><body>no results</body></html>', 5)).toEqual([]);
  });
});

describe('DuckDuckGoProvider', () => {
  it('parses results from an injected fetch', async () => {
    const fakeFetch = (async () =>
      new Response(SAMPLE_HTML, { status: 200 })) as unknown as typeof fetch;
    const provider = new DuckDuckGoProvider({ fetchImpl: fakeFetch });
    const hits = await provider.search({ query: 'node fetch' });
    expect(hits.length).toBe(2);
    expect(hits[0]!.url).toBe('https://nodejs.org/api/fetch.html');
  });

  it('returns [] on a non-ok response', async () => {
    const fakeFetch = (async () =>
      new Response('nope', { status: 503 })) as unknown as typeof fetch;
    const provider = new DuckDuckGoProvider({ fetchImpl: fakeFetch });
    expect(await provider.search({ query: 'x' })).toEqual([]);
  });

  it('returns [] when fetch throws', async () => {
    const fakeFetch = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const provider = new DuckDuckGoProvider({ fetchImpl: fakeFetch });
    expect(await provider.search({ query: 'x' })).toEqual([]);
  });
});
