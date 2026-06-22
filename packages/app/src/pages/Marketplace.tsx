import React, { useEffect, useMemo, useState } from 'react';
import { api, type PluginItem, type PluginsReport } from '../lib/api';
import { EmptyState, Section, Spinner, cls } from '../components/common';

export function MarketplacePage(): React.ReactElement {
  const [data, setData] = useState<PluginsReport | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('');

  useEffect(() => {
    void api.plugins().then(setData).catch(() => setData({ catalog: [], marketplaces: [], categories: [], orphans: [] }));
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.catalog.filter((p) => {
      if (category && p.category !== category) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.description ?? '').toLowerCase().includes(q) ||
        (p.tags ?? []).some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [data, query, category]);

  if (!data) return <Spinner />;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          className="input max-w-xs"
          placeholder="Search plugins…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="input max-w-[200px]" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {data.categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <span className="ml-auto text-xs text-muted">
          {data.marketplaces.length} marketplace{data.marketplaces.length === 1 ? '' : 's'} · {data.catalog.length} plugins
        </span>
      </div>

      {filtered.length === 0 && <EmptyState title="No plugins match" />}
      <div className="grid gap-3 md:grid-cols-2">
        {filtered.map((p) => (
          <PluginCard key={`${p.marketplace}:${p.id}`} p={p} />
        ))}
      </div>

      {data.marketplaces.some((m) => m.error) && (
        <Section title="Marketplace errors">
          <div className="card text-sm text-warn">
            {data.marketplaces.filter((m) => m.error).map((m) => (
              <div key={m.name}>
                {m.name}: {m.error}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function PluginCard({ p }: { p: PluginItem }): React.ReactElement {
  const installed = p.installedProject || p.installedGlobal;
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <span className="font-medium">{p.name}</span>
        {installed && <span className="chip border-ok text-ok">installed</span>}
      </div>
      <div className="mt-1 text-sm text-muted">{p.description || 'No description.'}</div>
      <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted">
        {p.author && <span>{p.author}</span>}
        {p.category && <span className={cls('chip')}>{p.category}</span>}
        {(p.tags ?? []).slice(0, 4).map((t) => (
          <span key={t} className="chip">
            {t}
          </span>
        ))}
        <span className="ml-auto">{p.marketplace}</span>
      </div>
    </div>
  );
}
