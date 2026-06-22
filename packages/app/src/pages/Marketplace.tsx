import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, FolderGit2, Globe, Loader2, RefreshCw, Store, Trash2, X } from 'lucide-react';
import { api, type PluginItem, type PluginsReport } from '../lib/api';
import { EmptyState, Spinner, cls } from '../components/common';

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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
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

  const act = async (p: PluginItem, install: boolean, scope: Scope): Promise<void> => {
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

  const addLibrary = async (repo: string): Promise<void> => {
    setError(null);
    try {
      await api.addMarketplace(repo);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeLibrary = async (name: string): Promise<void> => {
    setError(null);
    try {
      await api.removeMarketplace(name);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const refresh = async (): Promise<void> => {
    setRefreshing(true);
    setError(null);
    try {
      const next = await api.refreshPlugins(project ?? undefined);
      setData(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  };

  if (!data) return <Spinner />;

  const grid = (
    <>
      {error && <div className="mb-3 rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</div>}
      {filtered.length === 0 &&
        (installedOnly ? (
          <EmptyState title="No plugins installed" hint="Browse the marketplace to install your first plugin." />
        ) : (
          <EmptyState title="No plugins match" />
        ))}
      <div className="grid gap-3 sm:grid-cols-2">
        {filtered.map((p) => (
          <PluginCard
            key={`${p.marketplace}:${p.id}`}
            p={p}
            project={project}
            busy={busyId === p.id}
            onInstall={(scope) => act(p, true, scope)}
            onUninstall={(scope) => act(p, false, scope)}
          />
        ))}
      </div>
    </>
  );

  if (installedOnly) {
    return (
      <div>
        <div className="mb-4 flex items-center gap-2">
          <button onClick={onBrowse} className="btn btn-primary">
            <Store className="h-4 w-4" />
            Browse marketplace
          </button>
          <span className="ml-auto text-xs text-muted">{filtered.length} installed</span>
        </div>
        {grid}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 md:flex-row">
      <aside className="w-full shrink-0 space-y-6 md:w-52">
        <LibraryPanel
          marketplaces={data.marketplaces}
          refreshing={refreshing}
          onAdd={addLibrary}
          onRemove={removeLibrary}
          onRefresh={refresh}
        />
        <CategoryPanel categories={data.categories} active={category} onSelect={setCategory} />
      </aside>

      <div className="min-w-0 flex-1">
        <div className="mb-4 flex items-center gap-2">
          <input
            className="input"
            placeholder="Search plugins by name, tag, or description…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="shrink-0 text-xs text-muted">{filtered.length} plugins</span>
        </div>
        {grid}
      </div>
    </div>
  );
}

function LibraryPanel({
  marketplaces,
  refreshing,
  onAdd,
  onRemove,
  onRefresh,
}: {
  marketplaces: PluginsReport['marketplaces'];
  refreshing: boolean;
  onAdd: (repo: string) => void;
  onRemove: (name: string) => void;
  onRefresh: () => void;
}): React.ReactElement {
  const [repo, setRepo] = useState('');
  const submit = (): void => {
    const v = repo.trim();
    if (!v) return;
    onAdd(v);
    setRepo('');
  };
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Libraries</span>
        <button
          onClick={onRefresh}
          title="Refresh libraries"
          className="flex h-6 w-6 items-center justify-center rounded text-muted transition-colors hover:bg-panel2 hover:text-text"
        >
          <RefreshCw className={cls('h-3.5 w-3.5', refreshing && 'animate-spin')} />
        </button>
      </div>
      <div className="space-y-0.5">
        {marketplaces.map((m) => (
          <div key={m.name} className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-panel2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium">{m.name}</span>
                {m.error && (
                  <span className="chip border-bad/50 text-bad" title={m.error}>
                    error
                  </span>
                )}
              </div>
              <div className="truncate text-xs text-muted" title={m.repo}>
                {m.repo} · {m.count}
              </div>
            </div>
            {m.source === 'user' && (
              <button
                onClick={() => onRemove(m.name)}
                title="Remove library"
                className="shrink-0 text-muted opacity-0 transition-opacity hover:text-bad group-hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-1.5">
        <input
          className="input flex-1 px-2 py-1.5 text-xs"
          placeholder="owner/repo"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <button onClick={submit} className="btn px-2.5 py-1.5 text-xs">
          Add
        </button>
      </div>
    </div>
  );
}

function CategoryPanel({
  categories,
  active,
  onSelect,
}: {
  categories: string[];
  active: string;
  onSelect: (c: string) => void;
}): React.ReactElement {
  const items = ['', ...categories];
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Categories</div>
      <div className="space-y-0.5">
        {items.map((c) => (
          <button
            key={c || 'all'}
            onClick={() => onSelect(c)}
            className={cls(
              'block w-full truncate rounded-md px-2 py-1.5 text-left text-sm capitalize transition-colors',
              active === c ? 'bg-accent/15 font-medium text-text' : 'text-muted hover:bg-panel2 hover:text-text',
            )}
          >
            {c || 'All categories'}
          </button>
        ))}
      </div>
    </div>
  );
}

function PluginCard({
  p,
  project,
  busy,
  onInstall,
  onUninstall,
}: {
  p: PluginItem;
  project: string | null;
  busy: boolean;
  onInstall: (scope: Scope) => void;
  onUninstall: (scope: Scope) => void;
}): React.ReactElement {
  const installedScopes: Scope[] = [
    ...(p.installedProject ? (['project'] as Scope[]) : []),
    ...(p.installedGlobal ? (['global'] as Scope[]) : []),
  ];
  return (
    <div className="card flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium">{p.name}</span>
        {installedScopes.length > 0 && (
          <span className="chip border-ok text-ok">
            <Check className="mr-1 h-3 w-3" />
            installed
          </span>
        )}
      </div>
      <div className="mt-1 flex-1 text-sm text-muted">{p.description || 'No description.'}</div>
      <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted">
        {p.author && <span>{p.author}</span>}
        {p.category && <span className="chip capitalize">{p.category}</span>}
        {(p.tags ?? []).slice(0, 3).map((t) => (
          <span key={t} className="chip">
            {t}
          </span>
        ))}
        <span className="ml-auto">{p.marketplace}</span>
      </div>
      <div className="mt-3 flex justify-end border-t border-border pt-3">
        {installedScopes.length === 0 ? (
          <ScopeButton
            label="Use"
            variant="primary"
            busy={busy}
            options={[
              {
                scope: 'project',
                label: 'Use in this project',
                hint: project ? folderName(project) : 'Select a project first',
                icon: <FolderGit2 className="h-4 w-4" />,
                disabled: !project,
              },
              {
                scope: 'global',
                label: 'Use everywhere',
                hint: 'All projects on this machine',
                icon: <Globe className="h-4 w-4" />,
              },
            ]}
            onPick={onInstall}
          />
        ) : installedScopes.length === 1 ? (
          <button
            onClick={() => onUninstall(installedScopes[0])}
            disabled={busy}
            className="btn btn-danger px-3 py-1 text-xs"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Remove
          </button>
        ) : (
          <ScopeButton
            label="Remove"
            variant="danger"
            busy={busy}
            icon={<Trash2 className="h-3.5 w-3.5" />}
            options={[
              { scope: 'project', label: 'Remove from this project', icon: <FolderGit2 className="h-4 w-4" /> },
              { scope: 'global', label: 'Remove everywhere', icon: <Globe className="h-4 w-4" /> },
            ]}
            onPick={onUninstall}
          />
        )}
      </div>
    </div>
  );
}

type ScopeOption = { scope: Scope; label: string; hint?: string; icon: React.ReactNode; disabled?: boolean };

function ScopeButton({
  label,
  variant,
  busy,
  icon,
  options,
  onPick,
}: {
  label: string;
  variant: 'primary' | 'danger';
  busy: boolean;
  icon?: React.ReactNode;
  options: ScopeOption[];
  onPick: (scope: Scope) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        className={cls('btn px-3 py-1 text-xs', variant === 'danger' ? 'btn-danger' : 'btn-primary')}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
        {label}
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-50 mb-1.5 w-56 overflow-hidden rounded-lg border border-border bg-panel py-1 shadow-xl shadow-black/40">
          {options.map((o) => (
            <button
              key={o.scope}
              disabled={o.disabled}
              onClick={() => {
                setOpen(false);
                onPick(o.scope);
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-panel2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="text-muted">{o.icon}</span>
              <span className="min-w-0">
                <span className="block truncate text-sm text-text">{o.label}</span>
                {o.hint && <span className="block truncate text-xs text-muted">{o.hint}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function folderName(p: string): string {
  return p.replace(/\/+$/, '').split('/').pop() || p;
}
