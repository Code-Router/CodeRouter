import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { api, sendChat, type ProjectSummary } from '../lib/api';
import { Spinner, cls, money } from '../components/common';

type Msg = {
  role: 'user' | 'assistant' | 'system';
  text: string;
  route?: string | null;
  costUsd?: number;
  pending?: boolean;
};

const EFFORTS = ['low', 'medium', 'high', 'max'] as const;
const MODES = ['agent', 'plan', 'debug', 'review'] as const;

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

  // Load history when opening an existing chat; reset for a new one.
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
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send();
    }
  };

  const empty = messages.length === 0 && !loadingHistory;

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {loadingHistory && <Spinner />}
        {empty && (
          <div className="flex h-full flex-col items-center justify-center pb-24 text-center">
            <h2 className="text-2xl font-semibold">What should we build?</h2>
            <p className="mt-2 text-sm text-muted">
              Describe a task. CodeRouter routes it to the right model and runs it in your project.
            </p>
          </div>
        )}
        <div className="space-y-4 py-2">
          {messages.map((m, i) => (
            <MessageBubble key={i} msg={m} />
          ))}
        </div>
      </div>

      {error && <div className="mb-2 rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</div>}

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
      />
    </div>
  );
}

function MessageBubble({ msg }: { msg: Msg }): React.ReactElement {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-accent/20 px-4 py-2 text-sm">{msg.text}</div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="whitespace-pre-wrap rounded-2xl bg-panel px-4 py-3 text-sm leading-relaxed">
        {msg.text || (msg.pending ? <span className="text-muted">Thinking…</span> : '')}
        {msg.pending && msg.text && <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-accent align-middle" />}
      </div>
      {(msg.route || msg.costUsd != null) && !msg.pending && (
        <div className="px-2 text-[11px] text-muted">
          {msg.route} {msg.costUsd ? `· ${money(msg.costUsd)}` : ''}
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
}): React.ReactElement {
  return (
    <div className="mb-2 rounded-2xl border border-border bg-panel2 p-2 shadow-sm">
      <textarea
        className="max-h-48 min-h-[44px] w-full resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted"
        placeholder="Do anything…  (⌘↵ to send)"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        rows={2}
      />
      <div className="flex items-center gap-2 px-1 pt-1">
        <select
          className="rounded-md border border-border bg-panel px-2 py-1 text-xs text-muted outline-none"
          value={project ?? ''}
          onChange={(e) => onProjectChange(e.target.value)}
        >
          {projects.length === 0 && <option value="">no projects</option>}
          {projects.map((p) => (
            <option key={p.cwd} value={p.cwd}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          className="rounded-md border border-border bg-panel px-2 py-1 text-xs text-muted outline-none"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          {MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select
          className="rounded-md border border-border bg-panel px-2 py-1 text-xs text-muted outline-none capitalize"
          value={effort}
          onChange={(e) => setEffort(e.target.value)}
        >
          {EFFORTS.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
        <div className="ml-auto">
          {busy ? (
            <button onClick={onStop} className="flex h-8 w-8 items-center justify-center rounded-full bg-panel text-text hover:bg-border" title="Stop">
              <Square className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              onClick={onSend}
              disabled={!input.trim() || !project}
              className={cls(
                'flex h-8 w-8 items-center justify-center rounded-full transition-colors',
                input.trim() && project ? 'bg-accent text-white hover:bg-accent/80' : 'bg-border text-muted',
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
