import React, { useEffect, useState } from 'react';
import { api, type ProjectSummary } from './lib/api';
import { LoopEventsProvider, useDaemonConnected } from './lib/events';
import { cls } from './components/common';
import { LoopsPage } from './pages/Loops';
import { ProjectsPage } from './pages/Projects';
import { ChatsPage } from './pages/Chats';
import { UsagePage } from './pages/Usage';
import { OverviewPage } from './pages/Overview';
import { ModelsPage } from './pages/Models';
import { AssetsPage } from './pages/Assets';
import { MarketplacePage } from './pages/Marketplace';
import { SettingsPage } from './pages/Settings';

export type Nav =
  | 'loops'
  | 'projects'
  | 'chats'
  | 'overview'
  | 'usage'
  | 'models'
  | 'assets'
  | 'marketplace'
  | 'settings';

const NAV: Array<{ id: Nav; label: string; icon: string; group: string }> = [
  { id: 'loops', label: 'Loops', icon: '↻', group: 'Studio' },
  { id: 'projects', label: 'Projects', icon: '▣', group: 'Studio' },
  { id: 'chats', label: 'Chats', icon: '💬', group: 'Studio' },
  { id: 'overview', label: 'Overview', icon: '◔', group: 'Insights' },
  { id: 'usage', label: 'Usage', icon: '📊', group: 'Insights' },
  { id: 'models', label: 'Models', icon: '✦', group: 'Insights' },
  { id: 'assets', label: 'Rules & Skills', icon: '◈', group: 'Config' },
  { id: 'marketplace', label: 'Marketplace', icon: '🛍', group: 'Config' },
  { id: 'settings', label: 'Settings', icon: '⚙', group: 'Config' },
];

export function App(): React.ReactElement {
  return (
    <LoopEventsProvider>
      <Shell />
    </LoopEventsProvider>
  );
}

function Shell(): React.ReactElement {
  const [nav, setNav] = useState<Nav>('loops');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<string | null>(null);
  const connected = useDaemonConnected();

  useEffect(() => {
    void api
      .projects()
      .then((r) => {
        setProjects(r.projects);
        setProject((p) => p ?? r.projects[0]?.cwd ?? null);
      })
      .catch(() => {});
  }, []);

  const groups = Array.from(new Set(NAV.map((n) => n.group)));

  return (
    <div className="flex h-full">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-panel">
        <div className="flex items-center gap-2 px-4 py-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/20 text-accent">↻</div>
          <div>
            <div className="text-sm font-semibold leading-tight">CodeRouter</div>
            <div className="text-[10px] uppercase tracking-widest text-muted">Studio</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-2">
          {groups.map((g) => (
            <div key={g} className="mb-3">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted">{g}</div>
              {NAV.filter((n) => n.group === g).map((n) => (
                <button
                  key={n.id}
                  onClick={() => setNav(n.id)}
                  className={cls(
                    'mb-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                    nav === n.id ? 'bg-accent/20 text-text' : 'text-muted hover:bg-panel2 hover:text-text',
                  )}
                >
                  <span className="w-4 text-center text-xs">{n.icon}</span>
                  {n.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="border-t border-border px-4 py-3 text-xs text-muted">
          <div className="flex items-center gap-2">
            <span className={cls('h-2 w-2 rounded-full', connected ? 'bg-ok' : 'bg-bad')} />
            {connected ? 'daemon connected' : 'daemon offline'}
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-6 py-3">
          <h1 className="text-base font-semibold capitalize">{NAV.find((n) => n.id === nav)?.label}</h1>
          <ProjectPicker projects={projects} value={project} onChange={setProject} />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {nav === 'loops' && <LoopsPage projects={projects} project={project} />}
          {nav === 'projects' && (
            <ProjectsPage
              projects={projects}
              onOpen={(cwd) => {
                setProject(cwd);
                setNav('loops');
              }}
            />
          )}
          {nav === 'chats' && <ChatsPage project={project} />}
          {nav === 'overview' && <OverviewPage />}
          {nav === 'usage' && <UsagePage />}
          {nav === 'models' && <ModelsPage />}
          {nav === 'assets' && <AssetsPage />}
          {nav === 'marketplace' && <MarketplacePage />}
          {nav === 'settings' && <SettingsPage />}
        </div>
      </main>
    </div>
  );
}

function ProjectPicker({
  projects,
  value,
  onChange,
}: {
  projects: ProjectSummary[];
  value: string | null;
  onChange: (cwd: string) => void;
}): React.ReactElement {
  if (projects.length === 0) return <span className="text-xs text-muted">no projects yet</span>;
  return (
    <select className="input max-w-xs" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      {projects.map((p) => (
        <option key={p.cwd} value={p.cwd}>
          {p.name}
        </option>
      ))}
    </select>
  );
}
