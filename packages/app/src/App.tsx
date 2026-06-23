import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Blocks,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  LayoutDashboard,
  type LucideIcon,
  PanelBottom,
  PanelLeft,
  PanelRight,
  RefreshCw,
  Settings as SettingsIcon,
  Sparkles,
  SquarePen,
} from 'lucide-react';
import { api, execCommand, isMac, type ChatSummary, type ProjectSummary } from './lib/api';
import { LoopEventsProvider, useDaemonConnected } from './lib/events';
import { useTheme, type ThemePref } from './lib/theme';
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
  const [prevNav, setPrevNav] = useState<Nav>('overview');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<string | null>(null);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [chatsKey, setChatsKey] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [addedProjects, setAddedProjects] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('cr.addedProjects') || '[]') as string[];
    } catch {
      return [];
    }
  });
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

  // Daemon-known projects plus any folders the user added manually (which
  // may not have CodeRouter history yet, so they aren't in the DB).
  const allProjects = useMemo(() => {
    const known = new Set(projects.map((p) => p.cwd));
    const extras: ProjectSummary[] = addedProjects
      .filter((cwd) => !known.has(cwd))
      .map((cwd) => ({
        cwd,
        name: cwd.replace(/\/+$/, '').split('/').pop() || cwd,
        lastSeen: 0,
        runs: 0,
        loops: 0,
        chats: 0,
        costUsd: 0,
        lastActivity: 0,
      }));
    return [...extras, ...projects];
  }, [projects, addedProjects]);

  const registerProject = (path: string): void => {
    setAddedProjects((prev) => {
      const next = prev.includes(path) ? prev : [path, ...prev];
      try {
        localStorage.setItem('cr.addedProjects', JSON.stringify(next));
      } catch {
        /* ignore quota errors */
      }
      return next;
    });
    setProject(path);
    setExpanded((e) => new Set(e).add(path));
    newChat();
  };

  // "Use an existing folder": native picker (Electron) or a path prompt.
  const openExistingFolder = async (): Promise<void> => {
    let dir: string | null = null;
    const picker = window.coderouter?.pickFolder;
    if (picker) dir = await picker();
    else {
      const typed = window.prompt('Open an existing project folder (absolute path):');
      dir = typed && typed.trim() ? typed.trim() : null;
    }
    if (dir) registerProject(dir.trim());
  };

  // "Start from scratch": create a new folder via the daemon, then register it.
  const createNewFolder = async (): Promise<void> => {
    const typed = window.prompt('Create a new project folder (absolute path):');
    const path = typed && typed.trim() ? typed.trim() : null;
    if (!path) return;
    try {
      await execCommand({ cwd: '', command: `mkdir -p '${path.replace(/'/g, `'\\''`)}'` }, () => {});
    } catch {
      /* best effort — still register so the user can point at it */
    }
    registerProject(path);
  };

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

  const activeName = allProjects.find((p) => p.cwd === project)?.name;

  return (
    <div className="flex h-full">
      {sidebarOpen && (
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-panel">
        <div className="drag">
          <div className={cls('flex items-center justify-end px-2', mac ? 'h-11' : 'h-9 pt-1')}>
            <button
              onClick={() => setSidebarOpen(false)}
              className="no-drag flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-panel2 hover:text-text"
              title="Collapse sidebar"
            >
              <PanelLeft className="h-[17px] w-[17px]" strokeWidth={2} />
            </button>
          </div>
          <div className="flex items-center gap-2 px-3 pb-3">
            <Logo className="h-12 w-12" />
            <span className="text-lg font-semibold tracking-tight text-accent">CodeRouter</span>
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
                  'no-drag mb-0.5 flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm font-medium transition-colors',
                  active ? 'bg-accent/20 text-text' : 'text-muted hover:bg-panel2 hover:text-text',
                )}
              >
                <Icon className="h-[17px] w-[17px] shrink-0" strokeWidth={2} />
                {n.label}
              </button>
            );
          })}

          <SectionLabel
            action={
              <AddProjectMenu
                onCreate={() => void createNewFolder()}
                onOpen={() => void openExistingFolder()}
              />
            }
          >
            Projects
          </SectionLabel>
          {allProjects.length === 0 && <Empty>No projects yet</Empty>}
          {allProjects.map((p) => {
            const open = expanded.has(p.cwd);
            const pChats = chatsByProject.get(p.cwd) ?? [];
            return (
              <div key={p.cwd}>
                <button
                  onClick={() => toggleProject(p.cwd)}
                  title={p.cwd}
                  className={cls(
                    'no-drag flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-sm font-medium transition-colors hover:bg-panel2',
                    project === p.cwd ? 'text-text' : 'text-muted hover:text-text',
                  )}
                >
                  <ChevronRight className={cls('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-90')} strokeWidth={2.5} />
                  {open ? (
                    <FolderOpen className="h-[17px] w-[17px] shrink-0" strokeWidth={2} />
                  ) : (
                    <Folder className="h-[17px] w-[17px] shrink-0" strokeWidth={2} />
                  )}
                  <span className="truncate">{p.name}</span>
                  {pChats.length > 0 && <span className="ml-auto pl-1 text-[11px] text-muted/70">{pChats.length}</span>}
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
          <SidebarSettings
            active={nav === 'settings'}
            connected={connected}
            onOpenSettings={() => {
              setPrevNav((p) => (nav === 'settings' ? p : nav));
              setNav('settings');
            }}
          />
        </div>
      </aside>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <header
          className={cls(
            'drag flex shrink-0 items-center gap-2 border-b border-border pr-4',
            mac ? 'h-11' : 'h-12',
            !sidebarOpen && mac ? 'pl-[80px]' : 'pl-4',
          )}
        >
          {!sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="no-drag flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-panel2 hover:text-text"
              title="Open sidebar"
            >
              <PanelLeft className="h-[17px] w-[17px]" strokeWidth={2} />
            </button>
          )}
          <h1 className="text-[15px] font-semibold">{nav === 'chat' ? 'Chat' : TOP_NAV.find((n) => n.id === nav)?.label ?? 'Settings'}</h1>
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
                projects={allProjects}
                onProjectChange={setProject}
                onAddFolder={() => void openExistingFolder()}
                onChanges={setChanges}
                onSessionCreated={(id) => {
                  setChatId(id);
                  setChatsKey((k) => k + 1);
                  if (project) setExpanded((e) => new Set(e).add(project));
                }}
              />
            )}
            {nav === 'loops' && <LoopsPage projects={allProjects} project={project} />}
            {nav === 'plugins' && <PluginsPage project={project} />}
            {nav === 'settings' && <SettingsArea onBack={() => setNav(prevNav)} />}
          </div>
          {sidePanelOpen && (
            <aside className="w-96 shrink-0 border-l border-border bg-panel">
              <ChangesPanel changes={changes} />
            </aside>
          )}
        </div>
        {bottomPanelOpen && (
          <div className="h-64 shrink-0 border-t border-border">
            <Terminal project={project} onClose={() => setBottomPanelOpen(false)} />
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

function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex items-center justify-between px-2 pb-1 pt-4">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{children}</span>
      {action}
    </div>
  );
}

/** Projects "+" button → popup with "start from scratch" / "open existing". */
function AddProjectMenu({ onCreate, onOpen }: { onCreate: () => void; onOpen: () => void }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (
        ref.current && !ref.current.contains(e.target as Node) &&
        menuRef.current && !menuRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const toggle = (): void => {
    if (open) {
      setOpen(false);
      return;
    }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, left: r.left });
    setOpen(true);
  };

  return (
    <div ref={ref} className="relative">
      <button
        ref={btnRef}
        onClick={toggle}
        title="Add a project folder"
        className={cls(
          'no-drag flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-panel2 hover:text-text',
          open ? 'text-text' : 'text-muted',
        )}
      >
        <FolderPlus className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
      {open && pos &&
        createPortal(
          <div
            ref={menuRef}
            style={{ top: pos.top, left: pos.left }}
            className="fixed z-50 w-60 overflow-hidden rounded-lg border border-border bg-panel py-1 shadow-xl shadow-black/40"
          >
            <AddProjectRow
              icon={Sparkles}
              label="Start from scratch"
              hint="Create a new empty folder"
              onClick={() => {
                setOpen(false);
                onCreate();
              }}
            />
            <AddProjectRow
              icon={FolderOpen}
              label="Use an existing folder"
              hint="Pick a folder on your machine"
              onClick={() => {
                setOpen(false);
                onOpen();
              }}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}

function AddProjectRow({
  icon: Icon,
  label,
  hint,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  hint: string;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button onClick={onClick} className="flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-panel2">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted" strokeWidth={2} />
      <span>
        <span className="block text-sm text-text">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </button>
  );
}

/** Bottom-left settings entry: opens a popup (Codex-style) rather than
 *  jumping straight into the settings section. */
function SidebarSettings({
  active,
  connected,
  onOpenSettings,
}: {
  active: boolean;
  connected: boolean;
  onOpenSettings: () => void;
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
        className={cls(
          'no-drag flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm font-medium transition-colors',
          active || open ? 'bg-accent/20 text-text' : 'text-muted hover:bg-panel2 hover:text-text',
        )}
      >
        <SettingsIcon className="h-[17px] w-[17px] shrink-0" strokeWidth={2} />
        Settings
        {!connected && <span className="ml-auto h-2 w-2 rounded-full bg-bad" title="daemon offline" />}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-lg border border-border bg-panel shadow-xl shadow-black/40">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
            <Logo className="h-5 w-5" />
            <span className="text-sm font-semibold text-text">CodeRouter</span>
            <span className="ml-auto flex items-center gap-1.5 text-xs text-muted">
              <span className={cls('h-1.5 w-1.5 rounded-full', connected ? 'bg-ok' : 'bg-bad')} />
              {connected ? 'Connected' : 'Offline'}
            </span>
          </div>
          <div className="p-1">
            <button
              onClick={() => {
                setOpen(false);
                onOpenSettings();
              }}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm text-text transition-colors hover:bg-panel2"
            >
              <SettingsIcon className="h-4 w-4 text-muted" strokeWidth={2} />
              Settings
            </button>
          </div>
          <div className="border-t border-border px-3 py-2.5">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Appearance</div>
            <ThemeToggle />
          </div>
        </div>
      )}
    </div>
  );
}

function ThemeToggle(): React.ReactElement {
  const { pref, setPref } = useTheme();
  const opts: Array<{ id: ThemePref; label: string }> = [
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
    { id: 'system', label: 'System' },
  ];
  return (
    <div className="inline-flex w-full overflow-hidden rounded-md border border-border">
      {opts.map((o) => (
        <button
          key={o.id}
          onClick={() => setPref(o.id)}
          className={cls(
            'flex-1 px-2 py-1 text-xs transition-colors',
            pref === o.id ? 'bg-accent/20 text-text' : 'text-muted hover:bg-panel2 hover:text-text',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="px-2 py-1 text-xs text-muted/70">{children}</div>;
}
