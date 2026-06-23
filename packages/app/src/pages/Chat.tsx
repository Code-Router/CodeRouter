import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, Copy, Folder, ListTodo, Mic, Paperclip, Plus, Square, Target } from 'lucide-react';
import { api, sendChat, type ProjectSummary } from '../lib/api';
import { Spinner, cls, money } from '../components/common';
import { Markdown } from '../components/Markdown';
import { DiffView } from '../components/DiffView';
import { Dropdown } from '../components/Dropdown';

export type ChatChanges = { diff: string | null; filesChanged: string[] };

type Msg = {
  role: 'user' | 'assistant' | 'system';
  text: string;
  route?: string | null;
  costUsd?: number;
  pending?: boolean;
  diff?: string | null;
  filesChanged?: string[];
};

const EFFORTS = ['low', 'medium', 'high', 'max'] as const;
const MODES = ['agent', 'plan', 'debug', 'review'] as const;

/** Per-mode accent colors so the selector reads like Cursor's mode picker. */
const MODE_META: Record<string, { label: string; dot: string; text: string; chip: string }> = {
  agent: { label: 'Agent', dot: 'bg-emerald-500', text: 'text-emerald-500', chip: 'border-emerald-500/40 bg-emerald-500/10' },
  plan: { label: 'Plan', dot: 'bg-sky-500', text: 'text-sky-500', chip: 'border-sky-500/40 bg-sky-500/10' },
  debug: { label: 'Debug', dot: 'bg-amber-500', text: 'text-amber-500', chip: 'border-amber-500/40 bg-amber-500/10' },
  review: { label: 'Review', dot: 'bg-violet-500', text: 'text-violet-500', chip: 'border-violet-500/40 bg-violet-500/10' },
};
/** Sentinel option value: triggers the folder picker rather than selecting a project. */
const ADD_FOLDER = '__add_folder__';

const SUGGESTIONS = [
  'Fix the failing tests with minimal changes',
  'Explain how this codebase is structured',
  'Add tests for the most critical module',
];

export function ChatPage({
  chatId,
  project,
  projects,
  onProjectChange,
  onAddFolder,
  onSessionCreated,
  onChanges,
}: {
  chatId: string | null;
  project: string | null;
  projects: ProjectSummary[];
  onProjectChange: (cwd: string) => void;
  onAddFolder?: () => void;
  onSessionCreated: (id: string) => void;
  onChanges?: (c: ChatChanges | null) => void;
}): React.ReactElement {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<string>('agent');
  const [effort, setEffort] = useState<string>('medium');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const sessionRef = useRef<string>(chatId && chatId !== 'new' ? chatId : crypto.randomUUID());
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setError(null);
    if (chatId && chatId !== 'new') {
      sessionRef.current = chatId;
      if (!project) return;
      setLoadingHistory(true);
      void api
        .chat(project, chatId)
        .then((r) =>
          setMessages(
            r.messages.map((m) => ({
              role: m.role,
              text: m.text,
              route: m.route,
              costUsd: m.costUsd,
              diff: m.diff,
              filesChanged: m.filesChanged,
            })),
          ),
        )
        .catch(() => setMessages([]))
        .finally(() => setLoadingHistory(false));
    } else {
      sessionRef.current = crypto.randomUUID();
      setMessages([]);
    }
  }, [chatId, project]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // Report the most recent assistant changes upward so the Changes side
  // panel can mirror them.
  useEffect(() => {
    if (!onChanges) return;
    const lastWithDiff = [...messages].reverse().find((m) => m.role === 'assistant' && (m.diff || m.filesChanged?.length));
    onChanges(lastWithDiff ? { diff: lastWithDiff.diff ?? null, filesChanged: lastWithDiff.filesChanged ?? [] } : null);
  }, [messages, onChanges]);

  const send = async (): Promise<void> => {
    const prompt = input.trim();
    if (!prompt || busy || !project) return;
    setInput('');
    setError(null);
    setBusy(true);
    const wasNew = !chatId || chatId === 'new';
    setMessages((m) => [...m, { role: 'user', text: prompt }, { role: 'assistant', text: '', pending: true }]);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await sendChat(
        { cwd: project, sessionId: sessionRef.current, prompt, mode, effort },
        (e) => {
          if (e.type === 'start') sessionRef.current = e.sessionId;
          else if (e.type === 'chunk') {
            setMessages((m) => {
              const next = [...m];
              const last = next[next.length - 1];
              if (last && last.role === 'assistant') last.text += e.text;
              return next;
            });
          } else if (e.type === 'done') {
            setMessages((m) => {
              const next = [...m];
              const last = next[next.length - 1];
              if (last && last.role === 'assistant') {
                last.text = e.text || last.text;
                last.route = e.route;
                last.costUsd = e.costUsd;
                last.diff = e.diff;
                last.filesChanged = e.filesChanged;
                last.pending = false;
              }
              return next;
            });
          } else if (e.type === 'error') {
            setError(e.error);
            setMessages((m) => m.filter((x) => !(x.role === 'assistant' && x.pending)));
          }
        },
        ctrl.signal,
      );
      if (wasNew) onSessionCreated(sessionRef.current);
    } catch (err) {
      if (!ctrl.signal.aborted) setError(err instanceof Error ? err.message : String(err));
      setMessages((m) => m.map((x) => (x.pending ? { ...x, pending: false } : x)));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const stop = (): void => abortRef.current?.abort();

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const composer = (
    <Composer
      input={input}
      setInput={setInput}
      onSend={send}
      onStop={stop}
      onKeyDown={onKeyDown}
      busy={busy}
      mode={mode}
      setMode={setMode}
      effort={effort}
      setEffort={setEffort}
      project={project}
      projects={projects}
      onProjectChange={onProjectChange}
      onAddFolder={onAddFolder}
      placeholder={messages.length ? 'Ask for follow-up changes…' : 'Do anything…'}
    />
  );

  const empty = messages.length === 0 && !loadingHistory;

  // Empty state: heading + composer centered together, Codex-style.
  if (empty) {
    return (
      <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center px-4">
        <h2 className="mb-6 text-3xl font-semibold tracking-tight">What should we build?</h2>
        <div className="w-full">{composer}</div>
        {error && <div className="mt-3 w-full rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</div>}
        <div className="mt-4 w-full divide-y divide-border/60 border-t border-border/60">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setInput(s)}
              className="flex w-full items-center gap-2 px-1 py-2.5 text-left text-sm text-muted transition-colors hover:text-text"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto py-2">
        {loadingHistory && <Spinner />}
        {messages.map((m, i) => (
          <MessageRow key={i} msg={m} />
        ))}
      </div>
      {error && <div className="mb-2 rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</div>}
      {composer}
    </div>
  );
}

function MessageRow({ msg }: { msg: Msg }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const copy = (): void => {
    void navigator.clipboard.writeText(msg.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-panel2 px-4 py-2.5 text-sm">{msg.text}</div>
      </div>
    );
  }
  return (
    <div className="group">
      {msg.text ? <Markdown text={msg.text} /> : msg.pending ? <span className="text-sm text-muted">Thinking…</span> : null}
      {!msg.pending && (msg.diff || msg.filesChanged?.length) ? (
        <div className="mt-2">
          <DiffView diff={msg.diff} filesChanged={msg.filesChanged} />
        </div>
      ) : null}
      {!msg.pending && msg.text && (
        <div className="mt-1.5 flex items-center gap-3 text-[11px] text-muted opacity-0 transition-opacity group-hover:opacity-100">
          <button onClick={copy} className="inline-flex items-center gap-1 hover:text-text">
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          {msg.route && <span>{msg.route}</span>}
          {msg.costUsd ? <span>{money(msg.costUsd)}</span> : null}
        </div>
      )}
    </div>
  );
}

function Composer({
  input,
  setInput,
  onSend,
  onStop,
  onKeyDown,
  busy,
  mode,
  setMode,
  effort,
  setEffort,
  project,
  projects,
  onProjectChange,
  onAddFolder,
  placeholder,
}: {
  input: string;
  setInput: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  busy: boolean;
  mode: string;
  setMode: (v: string) => void;
  effort: string;
  setEffort: (v: string) => void;
  project: string | null;
  projects: ProjectSummary[];
  onProjectChange: (cwd: string) => void;
  onAddFolder?: () => void;
  placeholder: string;
}): React.ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);
  const { supported: voiceSupported, listening, toggle: toggleVoice } = useVoiceInput((t) =>
    setInput(input ? `${input} ${t}` : t),
  );

  const append = (text: string): void => setInput(input ? `${input}${text}` : text);

  return (
    <div className="rounded-2xl border border-border bg-panel shadow-sm transition-colors focus-within:border-accent/60">
      <textarea
        className="max-h-60 min-h-[72px] w-full resize-none bg-transparent px-4 pt-3.5 text-[15px] leading-relaxed outline-none placeholder:text-muted"
        placeholder={placeholder}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        rows={3}
      />
      <div className="flex items-center gap-2 px-3 pb-3 pt-1">
        <div className="relative">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted transition-colors hover:text-text"
            title="Add"
          >
            <Plus className={cls('h-4 w-4 transition-transform', menuOpen && 'rotate-45')} />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute bottom-10 left-0 z-20 w-60 overflow-hidden rounded-xl border border-border bg-panel py-1 shadow-lg">
                <MenuItem
                  icon={Paperclip}
                  label="Attach file or folder"
                  hint="Reference a path with @"
                  onClick={() => {
                    setMenuOpen(false);
                    const p = window.prompt('Path to attach (added as @path):');
                    if (p && p.trim()) append(`${input && !input.endsWith(' ') ? ' ' : ''}@${p.trim()} `);
                  }}
                />
                <MenuItem
                  icon={Target}
                  label="Add a goal"
                  hint="Prefix the prompt with a goal"
                  onClick={() => {
                    setMenuOpen(false);
                    if (!input.toLowerCase().startsWith('goal:')) setInput(`Goal: ${input}`);
                  }}
                />
                <MenuItem
                  icon={ListTodo}
                  label={mode === 'plan' ? 'Plan mode: on' : 'Turn on plan mode'}
                  hint="Plan before editing"
                  active={mode === 'plan'}
                  onClick={() => {
                    setMenuOpen(false);
                    setMode(mode === 'plan' ? 'agent' : 'plan');
                  }}
                />
              </div>
            </>
          )}
        </div>

        <Pill
          value={project ?? ''}
          onChange={(v) => (v === ADD_FOLDER ? onAddFolder?.() : onProjectChange(v))}
          placeholder="no folder"
          title="Working folder"
          icon={<Folder className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />}
          options={[
            ...projects.map((p) => ({ value: p.cwd, label: p.name })),
            ...(onAddFolder ? [{ value: ADD_FOLDER, label: '+ Add folder…' }] : []),
          ]}
        />
        <ModePill value={mode} onChange={setMode} />
        <Pill value={effort} onChange={setEffort} title="Reasoning effort" capitalize options={EFFORTS.map((e) => ({ value: e, label: e }))} />

        <div className="ml-auto flex items-center gap-1.5">
          {voiceSupported && (
            <button
              onClick={toggleVoice}
              className={cls(
                'flex h-8 w-8 items-center justify-center rounded-full border transition-colors',
                listening ? 'border-bad bg-bad/10 text-bad' : 'border-border text-muted hover:text-text',
              )}
              title={listening ? 'Stop dictation' : 'Dictate'}
            >
              <Mic className="h-4 w-4" />
            </button>
          )}
          {busy ? (
            <button onClick={onStop} className="flex h-8 w-8 items-center justify-center rounded-full bg-panel2 text-text hover:bg-border" title="Stop">
              <Square className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              onClick={onSend}
              disabled={!input.trim() || !project}
              className={cls(
                'flex h-8 w-8 items-center justify-center rounded-full transition-colors',
                input.trim() && project ? 'bg-accent text-white hover:bg-accent/80' : 'bg-panel2 text-muted',
              )}
              title="Send"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  hint,
  active,
  onClick,
}: {
  icon: typeof Plus;
  label: string;
  hint?: string;
  active?: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button onClick={onClick} className="flex w-full items-start gap-2.5 px-3 py-2 text-left text-sm hover:bg-panel2">
      <Icon className={cls('mt-0.5 h-4 w-4 shrink-0', active ? 'text-accent' : 'text-muted')} />
      <span>
        <span className={cls('block', active && 'text-accent')}>{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </button>
  );
}

/**
 * Browser SpeechRecognition wrapper for dictation. Returns supported=false
 * when the API is unavailable so the mic button can hide itself.
 */
function useVoiceInput(onText: (t: string) => void): { supported: boolean; listening: boolean; toggle: () => void } {
  const recognitionRef = useRef<any>(null);
  const [listening, setListening] = useState(false);
  const Ctor: any =
    typeof window !== 'undefined' ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : undefined;
  const supported = Boolean(Ctor);

  const toggle = (): void => {
    if (!supported) return;
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const rec = new Ctor();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e: any) => {
      const t = Array.from(e.results)
        .map((r: any) => r[0]?.transcript ?? '')
        .join(' ')
        .trim();
      if (t) onText(t);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  };

  return { supported, listening, toggle };
}

/** Mode selector where each mode carries its own color, Cursor-style. */
function ModePill({ value, onChange }: { value: string; onChange: (v: string) => void }): React.ReactElement {
  const meta = MODE_META[value] ?? MODE_META.agent;
  return (
    <Dropdown
      value={value}
      onChange={onChange}
      title="Mode"
      size="sm"
      menuWidth="w-44"
      options={MODES.map((m) => {
        const mm = MODE_META[m];
        return {
          value: m,
          searchText: m,
          label: (
            <span className="flex items-center gap-2">
              <span className={cls('h-2 w-2 shrink-0 rounded-full', mm.dot)} />
              <span className={cls('font-medium', mm.text)}>{mm.label}</span>
            </span>
          ),
          buttonLabel: (
            <span className="flex items-center gap-1.5">
              <span className={cls('h-2 w-2 shrink-0 rounded-full', mm.dot)} />
              <span className={cls('font-medium', mm.text)}>{mm.label}</span>
            </span>
          ),
        };
      })}
      className={cls(
        'flex items-center justify-between gap-1.5 rounded-md border px-2 py-1 text-xs outline-none transition-colors',
        meta.chip,
      )}
    />
  );
}

function Pill({
  value,
  onChange,
  options,
  placeholder,
  capitalize,
  icon,
  title,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  capitalize?: boolean;
  icon?: React.ReactNode;
  title?: string;
}): React.ReactElement {
  return (
    <Dropdown
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      title={title}
      leadingIcon={icon}
      options={options.map((o) => ({ value: o.value, label: o.label }))}
      size="sm"
      menuWidth="w-56"
      className={cls(
        'flex items-center justify-between gap-1.5 rounded-md border border-border bg-panel2 px-2 py-1 text-xs text-muted outline-none transition-colors hover:border-accent hover:text-text',
        capitalize && 'capitalize',
      )}
    />
  );
}
