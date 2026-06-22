import React, { useEffect, useRef, useState } from 'react';
import { Eraser, Plus, SquarePlus, SquareTerminal, X } from 'lucide-react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { resolveWsUrl } from '../lib/api';
import { useTheme } from '../lib/theme';
import { cls } from './common';

/**
 * Studio terminal: a real shell. The daemon spawns a genuine PTY (node-pty)
 * and streams it over a WebSocket (`/api/pty`); we render it with xterm.js.
 * It's a persistent, responsive session — full line editing, colors, vim,
 * etc. — not the old per-command exec.
 */
export function Terminal({ project, onClose }: { project: string | null; onClose?: () => void }): React.ReactElement {
  const { pref } = useTheme();
  const [sessionKey, setSessionKey] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;

    const term = new XTerm({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Code", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
      theme: buildTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termRef.current = term;
    safeFit(fit);

    let ws: WebSocket | null = null;

    function sendResize(): void {
      try {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'r', c: term.cols, r: term.rows }));
      } catch {
        /* ignore */
      }
    }

    void resolveWsUrl(
      `/api/pty?cwd=${encodeURIComponent(project ?? '')}&cols=${term.cols}&rows=${term.rows}`,
    ).then((url) => {
      if (disposed) return;
      ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => sendResize();
      ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') term.write(ev.data);
        else if (ev.data instanceof Blob) void ev.data.text().then((t) => term.write(t));
      };
      ws.onclose = () => {
        if (!disposed) term.write('\r\n\x1b[2m[process exited — press + for a new terminal]\x1b[0m\r\n');
      };
      ws.onerror = () => {
        if (!disposed) term.write('\r\n\x1b[31mCould not connect to the terminal backend.\x1b[0m\r\n');
      };
    });

    const dataSub = term.onData((d) => {
      try {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'i', d }));
      } catch {
        /* ignore */
      }
    });

    const ro = new ResizeObserver(() => {
      safeFit(fit);
      sendResize();
    });
    ro.observe(host);
    term.focus();

    return () => {
      disposed = true;
      ro.disconnect();
      dataSub.dispose();
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      term.dispose();
      termRef.current = null;
      wsRef.current = null;
    };
  }, [project, sessionKey]);

  // Re-theme in place when light/dark changes (no reconnect).
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = buildTheme();
  }, [pref]);

  const name = shortCwd(project ?? '~');
  const newTerminal = (): void => {
    setMenuOpen(false);
    setSessionKey((k) => k + 1);
  };
  const clear = (): void => {
    setMenuOpen(false);
    termRef.current?.clear();
  };

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

        <div className="relative">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            title="New terminal"
            className={cls(
              'flex h-6 w-6 items-center justify-center rounded hover:bg-panel2 hover:text-text',
              menuOpen ? 'text-text' : 'text-muted',
            )}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute left-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-lg border border-border bg-panel py-1 shadow-xl shadow-black/40">
                <TermMenuItem icon={SquarePlus} label="New terminal" onClick={newTerminal} />
                <TermMenuItem icon={Eraser} label="Clear" onClick={clear} />
              </div>
            </>
          )}
        </div>

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

      {/* xterm host */}
      <div
        ref={hostRef}
        className="min-h-0 flex-1 overflow-hidden px-2 py-1.5"
        onClick={() => termRef.current?.focus()}
      />
    </div>
  );
}

function TermMenuItem({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Plus;
  label: string;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-text hover:bg-panel2">
      <Icon className="h-4 w-4 shrink-0 text-muted" strokeWidth={2} />
      {label}
    </button>
  );
}

function safeFit(fit: FitAddon): void {
  try {
    fit.fit();
  } catch {
    /* container not measurable yet */
  }
}

function shortCwd(p: string): string {
  if (!p) return '~';
  const parts = p.replace(/\/$/, '').split('/');
  return parts[parts.length - 1] || p;
}

type Triple = [number, number, number];

function channels(name: string, fallback: Triple): Triple {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const parts = v.split(/\s+/).map(Number);
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) return [parts[0], parts[1], parts[2]];
  return fallback;
}

const rgb = (c: Triple): string => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
const rgba = (c: Triple, a: number): string => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;

/** Derive an xterm theme from the app's CSS variables so it matches light/dark. */
function buildTheme(): Record<string, string> {
  const bg = channels('--c-bg', [11, 13, 18]);
  const text = channels('--c-text', [230, 233, 240]);
  const accent = channels('--c-accent', [57, 211, 83]);
  const muted = channels('--c-muted', [139, 147, 167]);
  return {
    background: rgb(bg),
    foreground: rgb(text),
    cursor: rgb(accent),
    cursorAccent: rgb(bg),
    selectionBackground: rgba(accent, 0.3),
    brightBlack: rgb(muted),
  };
}
