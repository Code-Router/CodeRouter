import React, { useEffect, useMemo, useState } from 'react';
import {
  Blocks,
  ChevronRight,
  Folder,
  FolderOpen,
  LayoutDashboard,
  type LucideIcon,
  PanelBottom,
  PanelLeft,
  PanelRight,
  RefreshCw,
  Settings as SettingsIcon,
  SquarePen,
} from 'lucide-react';
import { api, isMac, type ChatSummary, type ProjectSummary } from './lib/api';
import { LoopEventsProvider, useDaemonConnected } from './lib/events';
import { cls } from './components/common';
import { Logo } from './components/Logo';
import { Terminal } from './components/Terminal';
import { ChangesPanel } from './components/ChangesPanel';
import { LoopsPage } from './pages/Loops';
import { ChatPage, type ChatChanges } from './pages/Chat';
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [bottomPanelOpen, setBottomPanelOpen] = useState(false);
  const [changes, setChanges] = useState<ChatChanges | null>(null);
  const connected = useDaemonConnected();
  const mac = isMac();

  // ⌘J / Ctrl+J toggles the bottom terminal panel, matching Codex.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setBottomPanelOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
      {sidebarOpen && (
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-panel">
        <div className={cls('drag flex items-center gap-2 px-3 pb-3', mac ? 'pt-[44px]' : 'pt-4')}>
          <Logo className="h-12 w-12" />
          <span className="text-lg font-semibold tracking-tight text-accent">CodeRouter</span>
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
                    'no-drag flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-sm transition-colors hover:bg-panel2',
                    project === p.cwd ? 'text-text' : 'text-muted hover:text-text',
                  )}
                >
                  <ChevronRight className={cls('h-3 w-3 shrink-0 transition-transform', open && 'rotate-90')} strokeWidth={2.5} />
                  {open ? (
                    <FolderOpen className="h-[15px] w-[15px] shrink-0" strokeWidth={2} />
                  ) : (
                    <Folder className="h-[15px] w-[15px] shrink-0" strokeWidth={2} />
                  )}
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
              'no-drag flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
              nav === 'settings' ? 'bg-accent/20 text-text' : 'text-muted hover:bg-panel2 hover:text-text',
            )}
          >
            <SettingsIcon className="h-[15px] w-[15px] shrink-0" strokeWidth={2} />
            Settings
            {!connected && <span className="ml-auto h-2 w-2 rounded-full bg-bad" title="daemon offline" />}
          </button>
        </div>
      </aside>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <header
          className={cls(
            'drag flex items-center gap-2 border-b border-border pb-3 pr-5',
            titleBar,
            !sidebarOpen && mac ? 'pl-[80px]' : 'pl-4',
          )}
        >
          <button
            onClick={() => setSidebarOpen((o) => !o)}
            className="no-drag flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-panel2 hover:text-text"
            title={sidebarOpen ? 'Collapse sidebar' : 'Open sidebar'}
          >
            <PanelLeft className="h-[17px] w-[17px]" strokeWidth={2} />
          </button>
          <h1 className="text-sm font-semibold">{nav === 'chat' ? 'Chat' : TOP_NAV.find((n) => n.id === nav)?.label ?? 'Settings'}</h1>
          <div className="no-drag ml-auto flex items-center gap-1">
            {(nav === 'loops' || nav === 'chat') && activeName && (
              <span className="mr-1 max-w-[180px] truncate text-xs text-muted">{activeName}</span>
            )}
            <PanelToggle icon={PanelRight} active={sidePanelOpen} onClick={() => setSidePanelOpen((o) => !o)} title="Toggle changes panel" />
            <PanelToggle icon={PanelBottom} active={bottomPanelOpen} onClick={() => setBottomPanelOpen((o) => !o)} title="Toggle terminal (⌘J)" />
          </div>
        </header>
        <div className="flex min-h-0 flex-1">
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {nav === 'overview' && <OverviewArea />}
            {nav === 'chat' && (
              <ChatPage
                chatId={chatId}
                project={project}
                projects={projects}
                onProjectChange={setProject}
                onChanges={setChanges}
                onSessionCreated={(id) => {
                  setChatId(id);
                  setChatsKey((k) => k + 1);
                  if (project) setExpanded((e) => new Set(e).add(project));
                }}
              />
            )}
            {nav === 'loops' && <LoopsPage projects={projects} project={project} />}
            {nav === 'plugins' && <PluginsPage project={project} />}
            {nav === 'settings' && <SettingsArea />}
          </div>
          {sidePanelOpen && (
            <aside className="w-96 shrink-0 border-l border-border bg-panel">
              <ChangesPanel changes={changes} />
            </aside>
          )}
        </div>
        {bottomPanelOpen && (
          <div className="h-64 shrink-0 border-t border-border">
            <Terminal project={project} />
          </div>
        )}
      </main>
    </div>
  );
}

function PanelToggle({
  icon: Icon,
  active,
  onClick,
  title,
}: {
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
  title: string;
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cls(
        'flex h-7 w-7 items-center justify-center rounded-md transition-colors',
        active ? 'bg-accent/20 text-accent' : 'text-muted hover:bg-panel2 hover:text-text',
      )}
    >
      <Icon className="h-[17px] w-[17px]" strokeWidth={2} />
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="px-2 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-muted">{children}</div>;
}

function Empty({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="px-2 py-1 text-xs text-muted/70">{children}</div>;
}
