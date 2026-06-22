import React, { useEffect, useState } from 'react';
import {
  Blocks,
  Folder,
  LayoutDashboard,
  type LucideIcon,
  RefreshCw,
  Settings as SettingsIcon,
  SquarePen,
} from 'lucide-react';
import { api, isMac, type ChatSummary, type ProjectSummary } from './lib/api';
import { LoopEventsProvider, useDaemonConnected } from './lib/events';
import { cls } from './components/common';
import { Logo } from './components/Logo';
import { LoopsPage } from './pages/Loops';
import { ChatPage } from './pages/Chat';
import { OverviewArea } from './pages/OverviewArea';
import { PluginsPage } from './pages/Plugins';
import { SettingsArea } from './pages/SettingsArea';

export type Nav = 'overview' | 'chat' | 'loops' | 'plugins' | 'settings';

type TopItem = { id: Nav; label: string; icon: LucideIcon; action?: boolean };

const TOP_NAV: TopItem[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'chat', label: 'New chat', icon: SquarePen, action: true },
  { id: 'loops', label: 'Loops', icon: RefreshCw },
  { id: 'plugins', label: 'Plugins', icon: Blocks },
];

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
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [chatsKey, setChatsKey] = useState(0);
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

  useEffect(() => {
    if (!project) return;
    void api
      .chats(project)
      .then((r) => setChats(r.chats))
      .catch(() => setChats([]));
  }, [project, chatsKey]);

  const newChat = (): void => {
    setChatId('new');
    setNav('chat');
  };
  const openChat = (id: string): void => {
    setChatId(id);
    setNav('chat');
  };

  const titleBar = mac ? 'pt-[44px]' : '';

  return (
    <div className="flex h-full">
      <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-panel">
        <div className={cls('drag flex items-center gap-2 px-3 pb-3', mac ? 'pt-[44px]' : 'pt-4')}>
          <Logo className="h-6 w-6 rounded-md" />
          <div>
            <div className="text-sm font-semibold leading-tight">CodeRouter</div>
            <div className="text-[9px] uppercase tracking-widest text-muted">Studio</div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 pb-2">
          {TOP_NAV.map((n) => {
            const Icon = n.icon;
            const active = n.id === 'chat' ? nav === 'chat' : nav === n.id;
            return (
              <button
                key={n.id}
                onClick={() => (n.id === 'chat' ? newChat() : setNav(n.id))}
                className={cls(
                  'no-drag mb-0.5 flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                  active ? 'bg-accent/20 text-text' : 'text-muted hover:bg-panel2 hover:text-text',
                )}
              >
                <Icon className="h-[15px] w-[15px] shrink-0" strokeWidth={2} />
                {n.label}
              </button>
            );
          })}

          <SectionLabel>Projects</SectionLabel>
          {projects.length === 0 && <Empty>No projects yet</Empty>}
          {projects.map((p) => (
            <button
              key={p.cwd}
              onClick={() => setProject(p.cwd)}
              title={p.cwd}
              className={cls(
                'no-drag mb-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                project === p.cwd ? 'bg-panel2 text-text' : 'text-muted hover:bg-panel2 hover:text-text',
              )}
            >
              <Folder className="h-[14px] w-[14px] shrink-0" strokeWidth={2} />
              <span className="truncate">{p.name}</span>
            </button>
          ))}

          <SectionLabel>Chats</SectionLabel>
          {chats.length === 0 && <Empty>No chats</Empty>}
          {chats.map((c) => (
            <button
              key={c.id}
              onClick={() => openChat(c.id)}
              title={c.title}
              className={cls(
                'no-drag mb-0.5 flex w-full items-center rounded-md px-2 py-1.5 text-left text-[13px] transition-colors',
                nav === 'chat' && chatId === c.id ? 'bg-panel2 text-text' : 'text-muted hover:bg-panel2 hover:text-text',
              )}
            >
              <span className="truncate">{c.title || 'Untitled'}</span>
            </button>
          ))}
        </nav>

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
        <header className={cls('drag flex items-center justify-between border-b border-border px-5 pb-3', titleBar || 'pt-3')}>
          <h1 className="text-sm font-semibold">{nav === 'chat' ? 'Chat' : TOP_NAV.find((n) => n.id === nav)?.label ?? 'Settings'}</h1>
          {(nav === 'loops' || nav === 'chat') && project && (
            <span className="no-drag truncate text-xs text-muted">{projects.find((p) => p.cwd === project)?.name}</span>
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {nav === 'overview' && <OverviewArea />}
          {nav === 'chat' && (
            <ChatPage
              chatId={chatId}
              project={project}
              projects={projects}
              onProjectChange={setProject}
              onSessionCreated={(id) => {
                setChatId(id);
                setChatsKey((k) => k + 1);
              }}
            />
          )}
          {nav === 'loops' && <LoopsPage projects={projects} project={project} />}
          {nav === 'plugins' && <PluginsPage />}
          {nav === 'settings' && <SettingsArea />}
        </div>
      </main>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="px-2 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-muted">{children}</div>;
}

function Empty({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="px-2 py-1 text-xs text-muted/70">{children}</div>;
}
