import React, { useEffect, useMemo, useState } from 'react';
import {
  Blocks,
  ChevronRight,
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

type TopItem = { id: Nav; label: string; icon: LucideIcon };

const TOP_NAV: TopItem[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'chat', label: 'New chat', icon: SquarePen },
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const connected = useDaemonConnected();
  const mac = isMac();

  useEffect(() => {
    void api
      .projects()
      .then((r) => {
        setProjects(r.projects);
        const first = r.projects[0]?.cwd ?? null;
        setProject((p) => p ?? first);
        if (first) setExpanded((e) => (e.size ? e : new Set([first])));
      })
      .catch(() => {});
  }, []);

  // All chats across every project; grouped under their project in the tree.
  useEffect(() => {
    void api
      .chats()
      .then((r) => setChats(r.chats))
      .catch(() => setChats([]));
  }, [chatsKey]);

  const chatsByProject = useMemo(() => {
    const map = new Map<string, ChatSummary[]>();
    for (const c of chats) {
      const list = map.get(c.cwd) ?? [];
      list.push(c);
      map.set(c.cwd, list);
    }
    return map;
  }, [chats]);

  const newChat = (): void => {
    setChatId('new');
    setNav('chat');
  };
  const openChat = (c: ChatSummary): void => {
    setProject(c.cwd);
    setChatId(c.id);
    setNav('chat');
  };
  const toggleProject = (cwd: string): void => {
    setProject(cwd);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(cwd)) next.delete(cwd);
      else next.add(cwd);
      return next;
    });
  };

  const titleBar = mac ? 'pt-[44px]' : 'pt-3';
  const activeName = projects.find((p) => p.cwd === project)?.name;

  return (
    <div className="flex h-full">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-panel">
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
            const active = n.id === 'chat' ? nav === 'chat' && (chatId === 'new' || chatId == null) : nav === n.id;
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
          {projects.map((p) => {
            const open = expanded.has(p.cwd);
            const pChats = chatsByProject.get(p.cwd) ?? [];
            return (
              <div key={p.cwd}>
                <button
                  onClick={() => toggleProject(p.cwd)}
                  title={p.cwd}
                  className={cls(
                    'no-drag flex w-full items-center gap-1 rounded-md px-1.5 py-1.5 text-left text-sm transition-colors',
                    project === p.cwd ? 'text-text' : 'text-muted hover:text-text',
                    'hover:bg-panel2',
                  )}
                >
                  <ChevronRight className={cls('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-90')} strokeWidth={2.5} />
                  <span className="truncate">{p.name}</span>
                  {pChats.length > 0 && <span className="ml-auto pl-1 text-[10px] text-muted/70">{pChats.length}</span>}
                </button>
                {open && (
                  <div className="mb-1 ml-3 border-l border-border pl-2">
                    {pChats.length === 0 && <div className="px-2 py-1 text-xs text-muted/60">No chats yet</div>}
                    {pChats.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => openChat(c)}
                        title={c.title}
                        className={cls(
                          'no-drag flex w-full items-center rounded-md px-2 py-1 text-left text-[13px] transition-colors',
                          nav === 'chat' && chatId === c.id ? 'bg-panel2 text-text' : 'text-muted hover:bg-panel2 hover:text-text',
                        )}
                      >
                        <span className="truncate">{c.title || 'Untitled'}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
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
        <header className={cls('drag flex items-center justify-between border-b border-border px-5 pb-3', titleBar)}>
          <h1 className="text-sm font-semibold">{nav === 'chat' ? 'Chat' : TOP_NAV.find((n) => n.id === nav)?.label ?? 'Settings'}</h1>
          {(nav === 'loops' || nav === 'chat') && activeName && <span className="no-drag truncate text-xs text-muted">{activeName}</span>}
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
                if (project) setExpanded((e) => new Set(e).add(project));
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
