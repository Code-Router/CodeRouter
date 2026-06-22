import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, Copy, Square } from 'lucide-react';
import { api, sendChat, type ProjectSummary } from '../lib/api';
import { Spinner, cls, money } from '../components/common';
import { Markdown } from '../components/Markdown';

type Msg = {
  role: 'user' | 'assistant' | 'system';
  text: string;
  route?: string | null;
  costUsd?: number;
  pending?: boolean;
};

const EFFORTS = ['low', 'medium', 'high', 'max'] as const;
const MODES = ['agent', 'plan', 'debug', 'review'] as const;

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
  onSessionCreated,
}: {
  chatId: string | null;
  project: string | null;
  projects: ProjectSummary[];
  onProjectChange: (cwd: string) => void;
  onSessionCreated: (id: string) => void;
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
        .then((r) => setMessages(r.messages.map((m) => ({ role: m.role, text: m.text, route: m.route, costUsd: m.costUsd }))))
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
  placeholder: string;
}): React.ReactElement {
  return (
    <div className="rounded-2xl border border-border bg-panel shadow-sm transition-colors focus-within:border-accent/60">
      <textarea
        className="max-h-52 min-h-[52px] w-full resize-none bg-transparent px-4 pt-3 text-sm outline-none placeholder:text-muted"
        placeholder={placeholder}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        rows={2}
      />
      <div className="flex items-center gap-2 px-3 pb-2.5 pt-1">
        <Pill value={project ?? ''} onChange={onProjectChange}>
          {projects.length === 0 && <option value="">no projects</option>}
          {projects.map((p) => (
            <option key={p.cwd} value={p.cwd}>
              {p.name}
            </option>
          ))}
        </Pill>
        <Pill value={mode} onChange={setMode}>
          {MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Pill>
        <Pill value={effort} onChange={setEffort} className="capitalize">
          {EFFORTS.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </Pill>
        <div className="ml-auto">
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

function Pill({
  value,
  onChange,
  children,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <select
      className={cls(
        'rounded-md border border-border bg-panel2 px-2 py-1 text-xs text-muted outline-none transition-colors hover:text-text',
        className,
      )}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {children}
    </select>
  );
}
