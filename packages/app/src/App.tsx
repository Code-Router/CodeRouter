import React, { useEffect, useState } from 'react';
import {
  Blocks,
  FolderGit2,
  LayoutDashboard,
  type LucideIcon,
  MessagesSquare,
  RefreshCw,
  Settings as SettingsIcon,
  SquarePen,
} from 'lucide-react';
import { api, isMac, type ProjectSummary } from './lib/api';
import { LoopEventsProvider, useDaemonConnected } from './lib/events';
import { cls } from './components/common';
import { Logo } from './components/Logo';
import { LoopsPage } from './pages/Loops';
import { ProjectsPage } from './pages/Projects';
import { ChatsPage } from './pages/Chats';
import { OverviewArea } from './pages/OverviewArea';
import { PluginsPage } from './pages/Plugins';
import { SettingsArea } from './pages/SettingsArea';

export type Nav = 'overview' | 'newchat' | 'projects' | 'chats' | 'loops' | 'plugins' | 'settings';

type NavItem = { id: Nav; label: string; icon: LucideIcon };

const MAIN_NAV: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'newchat', label: 'New chat', icon: SquarePen },
  { id: 'projects', label: 'Projects', icon: FolderGit2 },
  { id: 'chats', label: 'Chats', icon: MessagesSquare },
  { id: 'loops', label: 'Loops', icon: RefreshCw },
  { id: 'plugins', label: 'Plugins', icon: Blocks },
];

const TITLES: Record<Nav, string> = {
  overview: 'Overview',
  newchat: 'New chat',
  projects: 'Projects',
  chats: 'Chats',
  loops: 'Loops',
  plugins: 'Plugins',
  settings: 'Settings',
};

export function App(): React.ReactElement {
  return (
    <LoopEventsProvider>
      <Shell />
    </LoopEventsProvider>
  );
}

function Shell(): React.ReactElement {
  const [nav, setNav] = useState<Nav>('overview');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<string | null>(null);
  const connected = useDaemonConnected();
  const mac = isMac();

  useEffect(() => {
    void api
      .projects()
      .then((r) => {
        setProjects(r.projects);
        setProject((p) => p ?? r.projects[0]?.cwd ?? null);
      })
      .catch(() => {});
  }, []);

  // "New chat" has no compose flow in the desktop app yet; route to the
  // conversation browser for now.
  const go = (id: Nav): void => setNav(id === 'newchat' ? 'chats' : id);

  const renderNavButton = (n: NavItem): React.ReactElement => {
    const Icon = n.icon;
    const isAction = n.id === 'newchat';
    const active = !isAction && nav === n.id;
    return (
      <button
        key={n.id}
        onClick={() => go(n.id)}
        className={cls(
          'no-drag mb-0.5 flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
          active ? 'bg-accent/20 text-text' : 'text-muted hover:bg-panel2 hover:text-text',
        )}
      >
        <Icon className="h-[15px] w-[15px] shrink-0" strokeWidth={2} />
        {n.label}
      </button>
    );
  };

  return (
    <div className="flex h-full">
      <aside className="flex w-48 shrink-0 flex-col border-r border-border bg-panel">
        <div className={cls('drag flex items-center gap-2 px-3 pb-3', mac ? 'pt-9' : 'pt-3')}>
          <Logo className="h-6 w-6 rounded-md" />
          <div>
            <div className="text-sm font-semibold leading-tight">CodeRouter</div>
            <div className="text-[9px] uppercase tracking-widest text-muted">Studio</div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 pt-1">{MAIN_NAV.map(renderNavButton)}</nav>

        <div className="px-2 pb-2">
          <button
            onClick={() => setNav('settings')}
            className={cls(
              'no-drag mb-1 flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
              nav === 'settings' ? 'bg-accent/20 text-text' : 'text-muted hover:bg-panel2 hover:text-text',
            )}
          >
            <SettingsIcon className="h-[15px] w-[15px] shrink-0" strokeWidth={2} />
            Settings
          </button>
          <div className="flex items-center gap-2 border-t border-border px-2 pt-2 text-[11px] text-muted">
            <span className={cls('h-2 w-2 rounded-full', connected ? 'bg-ok' : 'bg-bad')} />
            {connected ? 'daemon connected' : 'daemon offline'}
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header
          className={cls(
            'drag flex items-center justify-between border-b border-border px-5',
            mac ? 'pb-2.5 pt-7' : 'py-2.5',
          )}
        >
          <h1 className="text-sm font-semibold">{TITLES[nav]}</h1>
          <div className="no-drag">
            <ProjectPicker projects={projects} value={project} onChange={setProject} />
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {nav === 'overview' && <OverviewArea />}
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
          {nav === 'loops' && <LoopsPage projects={projects} project={project} />}
          {nav === 'plugins' && <PluginsPage />}
          {nav === 'settings' && <SettingsArea />}
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
