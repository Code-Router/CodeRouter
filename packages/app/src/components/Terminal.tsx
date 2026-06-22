import React, { useEffect, useRef, useState } from 'react';
import { Plus, SquareTerminal, X } from 'lucide-react';
import { execCommand } from '../lib/api';
import { cls } from './common';

type Line = { kind: 'cmd' | 'out' | 'err' | 'info'; text: string };

/**
 * A lightweight terminal for the selected project. Each command is run as
 * its own `bash -lc` on the daemon (see /api/exec) — not a persistent PTY —
 * so we track `cwd` here and resolve `cd` with a `pwd` round-trip. Covers
 * git/npm/test/ls workflows; interactive TUIs (vim, etc.) aren't supported.
 */
export function Terminal({ project, onClose }: { project: string | null; onClose?: () => void }): React.ReactElement {
  const [cwd, setCwd] = useState<string>(project ?? '');
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setCwd(project ?? ''), [project]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);

  const push = (line: Line): void => setLines((l) => [...l, line]);

  const run = async (raw: string): Promise<void> => {
    const command = raw.trim();
    if (!command || busy) return;
    setHistory((h) => [...h, command]);
    setHistIdx(null);
    setInput('');
    push({ kind: 'cmd', text: `${shortCwd(cwd)} % ${command}` });

    if (command === 'clear') {
      setLines([]);
      return;
    }

    setBusy(true);
    const base = cwd || project || '';

    // `cd` has no persistent process, so resolve the new directory via pwd.
    const cdMatch = /^cd(\s+(.*))?$/.exec(command);
    if (cdMatch) {
      const arg = (cdMatch[2] ?? '').trim();
      let newCwd = '';
      let errText = '';
      try {
        await execCommand({ cwd: base, command: `cd ${arg || '~'} && pwd` }, (e) => {
          if (e.type === 'out') newCwd += e.text;
          else if (e.type === 'err') errText += e.text;
        });
      } catch (err) {
        errText = err instanceof Error ? err.message : String(err);
      }
      if (newCwd.trim()) setCwd(newCwd.trim().split('\n').pop() ?? base);
      else if (errText.trim()) push({ kind: 'err', text: errText.trimEnd() });
      setBusy(false);
      inputRef.current?.focus();
      return;
    }

    try {
      await execCommand({ cwd: base, command }, (e) => {
        if (e.type === 'out') push({ kind: 'out', text: e.text.replace(/\n$/, '') });
        else if (e.type === 'err') push({ kind: 'err', text: e.text.replace(/\n$/, '') });
        else if (e.type === 'exit' && e.code !== 0) push({ kind: 'info', text: `exited with code ${e.code}` });
      });
    } catch (err) {
      push({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void run(input);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;
      const idx = histIdx === null ? history.length - 1 : Math.max(0, histIdx - 1);
      setHistIdx(idx);
      setInput(history[idx]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (histIdx === null) return;
      const idx = histIdx + 1;
      if (idx >= history.length) {
        setHistIdx(null);
        setInput('');
      } else {
        setHistIdx(idx);
        setInput(history[idx]);
      }
    }
  };

  const name = shortCwd(cwd || project || '~');

  return (
    <div className="flex h-full flex-col bg-bg">
      {/* Tab bar (Codex-style) */}
      <div className="flex items-center gap-1 border-b border-border bg-panel px-2 pt-1.5">
        <div className="flex items-center gap-1.5 rounded-t-md border border-b-0 border-border bg-bg px-2.5 py-1 text-xs text-text">
          <SquareTerminal className="h-3.5 w-3.5 text-muted" strokeWidth={2} />
          <span className="max-w-[180px] truncate">{name}</span>
          {onClose && (
            <button
              onClick={onClose}
              title="Close terminal"
              className="ml-1 flex h-4 w-4 items-center justify-center rounded text-muted hover:bg-panel2 hover:text-text"
            >
              <X className="h-3 w-3" strokeWidth={2.5} />
            </button>
          )}
        </div>
        <button
          onClick={() => setLines([])}
          title="New terminal"
          className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-panel2 hover:text-text"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
        </button>
        {onClose && (
          <button
            onClick={onClose}
            title="Hide panel"
            className="ml-auto flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-panel2 hover:text-text"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        )}
      </div>

      {/* Output + inline prompt */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 py-2 font-mono text-xs leading-relaxed"
        onClick={() => inputRef.current?.focus()}
      >
        {lines.map((l, i) => (
          <div
            key={i}
            className={cls(
              'whitespace-pre-wrap break-words',
              l.kind === 'cmd' && 'text-text',
              l.kind === 'out' && 'text-muted',
              l.kind === 'err' && 'text-bad',
              l.kind === 'info' && 'text-warn',
            )}
          >
            {l.text}
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 text-accent">{name} %</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={busy}
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-muted/60 disabled:opacity-60"
            placeholder={busy ? 'running…' : ''}
          />
        </div>
      </div>
    </div>
  );
}

function shortCwd(p: string): string {
  if (!p) return '~';
  const parts = p.replace(/\/$/, '').split('/');
  return parts[parts.length - 1] || p;
}
