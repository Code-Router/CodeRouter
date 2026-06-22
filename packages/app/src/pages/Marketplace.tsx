import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Download, Loader2, Store, Trash2 } from 'lucide-react';
import { api, type PluginItem, type PluginsReport } from '../lib/api';
import { EmptyState, Section, Spinner, cls } from '../components/common';

type Scope = 'project' | 'global';

export function MarketplacePage({
  project,
  installedOnly,
  onBrowse,
}: {
  project: string | null;
  installedOnly?: boolean;
  onBrowse?: () => void;
}): React.ReactElement {
  const [data, setData] = useState<PluginsReport | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [scope, setScope] = useState<Scope>(project ? 'project' : 'global');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void api
      .plugins(project ?? undefined)
      .then(setData)
      .catch(() => setData({ catalog: [], marketplaces: [], categories: [], orphans: [] }));
  }, [project]);

  useEffect(() => load(), [load]);

  const isInstalled = useCallback((p: PluginItem) => p.installedProject || p.installedGlobal, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    const all = installedOnly ? [...data.catalog.filter(isInstalled), ...data.orphans] : data.catalog;
    const q = query.trim().toLowerCase();
    return all.filter((p) => {
      if (!installedOnly && category && p.category !== category) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.description ?? '').toLowerCase().includes(q) ||
        (p.tags ?? []).some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [data, query, category, installedOnly, isInstalled]);

  const act = async (p: PluginItem, install: boolean): Promise<void> => {
    setBusyId(p.id);
    setError(null);
    try {
      if (install) await api.installPlugin(p.id, { cwd: project ?? undefined, marketplace: p.marketplace, scope });
      else await api.uninstallPlugin(p.id, { cwd: project ?? undefined, scope });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  if (!data) return <Spinner />;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {!installedOnly && (
          <>
            <input className="input max-w-xs" placeholder="Search plugins…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <select className="input max-w-[200px]" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {data.categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </>
        )}
        {installedOnly && (
          <button onClick={onBrowse} className="btn btn-primary">
            <Store className="h-4 w-4" />
            Browse marketplace
          </button>
        )}
        <ScopeToggle scope={scope} setScope={setScope} hasProject={Boolean(project)} />
        <span className="ml-auto text-xs text-muted">
          {data.marketplaces.length} marketplace{data.marketplaces.length === 1 ? '' : 's'} · {data.catalog.length} plugins
        </span>
      </div>

      {error && <div className="mb-3 rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</div>}

      {filtered.length === 0 &&
        (installedOnly ? (
          <EmptyState title="No plugins installed" hint="Browse the marketplace to install your first plugin." />
        ) : (
          <EmptyState title="No plugins match" />
        ))}

      <div className="grid gap-3 md:grid-cols-2">
        {filtered.map((p) => (
          <PluginCard
            key={`${p.marketplace}:${p.id}`}
            p={p}
            scope={scope}
            busy={busyId === p.id}
            onInstall={() => act(p, true)}
            onUninstall={() => act(p, false)}
          />
        ))}
      </div>

      {!installedOnly && data.marketplaces.some((m) => m.error) && (
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

function ScopeToggle({ scope, setScope, hasProject }: { scope: Scope; setScope: (s: Scope) => void; hasProject: boolean }): React.ReactElement {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-border text-xs">
      <button
        onClick={() => setScope('project')}
        disabled={!hasProject}
        className={cls('px-2.5 py-1.5 transition-colors disabled:opacity-40', scope === 'project' ? 'bg-accent/20 text-text' : 'text-muted hover:text-text')}
        title={hasProject ? 'Install into the selected project' : 'Select a project first'}
      >
        Project
      </button>
      <button
        onClick={() => setScope('global')}
        className={cls('px-2.5 py-1.5 transition-colors', scope === 'global' ? 'bg-accent/20 text-text' : 'text-muted hover:text-text')}
        title="Install for all projects"
      >
        Global
      </button>
    </div>
  );
}

function PluginCard({
  p,
  scope,
  busy,
  onInstall,
  onUninstall,
}: {
  p: PluginItem;
  scope: Scope;
  busy: boolean;
  onInstall: () => void;
  onUninstall: () => void;
}): React.ReactElement {
  const installedHere = scope === 'global' ? p.installedGlobal : p.installedProject;
  return (
    <div className="card flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium">{p.name}</span>
        {(p.installedProject || p.installedGlobal) && (
          <span className="chip border-ok text-ok">
            <Check className="mr-1 h-3 w-3" />
            installed
          </span>
        )}
      </div>
      <div className="mt-1 flex-1 text-sm text-muted">{p.description || 'No description.'}</div>
      <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted">
        {p.author && <span>{p.author}</span>}
        {p.category && <span className="chip">{p.category}</span>}
        {(p.tags ?? []).slice(0, 3).map((t) => (
          <span key={t} className="chip">
            {t}
          </span>
        ))}
        <span className="ml-auto">{p.marketplace}</span>
      </div>
      <div className="mt-3 border-t border-border pt-3">
        {installedHere ? (
          <button onClick={onUninstall} disabled={busy} className="btn btn-danger w-full justify-center">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Remove ({scope})
          </button>
        ) : (
          <button onClick={onInstall} disabled={busy} className="btn btn-primary w-full justify-center">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Install ({scope})
          </button>
        )}
      </div>
    </div>
  );
}
