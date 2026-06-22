import { loadAllMarketplaces } from './marketplace.js';
import type { LoadedMarketplace, Plugin } from './types.js';

export type Catalog = {
  plugins: Plugin[];
  marketplaces: Array<{
    name: string;
    repo: string;
    source: 'builtin' | 'user';
    owner?: string;
    count: number;
    error?: string;
  }>;
};

/** Load every registered marketplace and flatten their plugins. */
export async function loadCatalog(opts: { refresh?: boolean } = {}): Promise<Catalog> {
  const loaded: LoadedMarketplace[] = await loadAllMarketplaces(opts);
  const plugins: Plugin[] = [];
  const marketplaces: Catalog['marketplaces'] = [];
  for (const m of loaded) {
    plugins.push(...m.plugins);
    marketplaces.push({
      name: m.name,
      repo: m.repo,
      source: m.source,
      owner: m.owner,
      count: m.plugins.length,
      error: m.error,
    });
  }
  return { plugins, marketplaces };
}

/** Find one plugin across all marketplaces (optionally scoped to one). */
export async function findPlugin(
  id: string,
  marketplace?: string,
  opts: { refresh?: boolean } = {},
): Promise<Plugin | undefined> {
  const { plugins } = await loadCatalog(opts);
  return plugins.find((p) => p.id === id && (!marketplace || p.marketplace === marketplace));
}
