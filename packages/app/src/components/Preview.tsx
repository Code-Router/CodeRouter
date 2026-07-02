import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ExternalLink, Globe, RotateCw, X } from 'lucide-react';
import { api } from '../lib/api';
import { cls } from './common';

/**
 * Minimal Electron `<webview>` surface. We only touch the handful of
 * imperative methods we need (navigation + reload); typed loosely so we
 * don't depend on Electron's renderer types in the web build. (`<webview>`
 * itself is already a known intrinsic element via the DOM lib.)
 */
type WebviewEl = {
  reload: () => void;
  goBack: () => void;
  canGoBack: () => boolean;
  getURL: () => string;
};

function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  return /^https?:\/\//i.test(t) ? t : `http://${t}`;
}

/**
 * In-app browser preview. Renders a localhost dev server (or any URL) the
 * agent started, so the user can see the running app without leaving the
 * window — the CodeRouter equivalent of Cursor's simple browser / Claude's
 * preview. Uses an Electron `<webview>` (a real embedded browser, immune to
 * X-Frame-Options) when available, and an `<iframe>` in the plain-browser
 * dev build.
 */
export function Preview({
  url,
  isElectron,
  onClose,
}: {
  url: string | null;
  isElectron: boolean;
  onClose?: () => void;
}): React.ReactElement {
  const [input, setInput] = useState(url ?? '');
  const [current, setCurrent] = useState(url ?? '');
  const [nonce, setNonce] = useState(0);
  const webviewRef = useRef<WebviewEl | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Follow the externally-selected URL (e.g. an auto-detected dev server).
  useEffect(() => {
    if (url) {
      setInput(url);
      setCurrent(url);
    }
  }, [url]);

  const navigate = (to: string): void => {
    const next = normalizeUrl(to);
    if (!next) return;
    setInput(next);
    if (next === current) {
      reload();
      return;
    }
    setCurrent(next);
  };

  const reload = (): void => {
    if (isElectron && webviewRef.current) {
      try {
        webviewRef.current.reload();
        return;
      } catch {
        /* fall through to remount */
      }
    }
    // Remount the iframe/webview to force a fresh load.
    setNonce((n) => n + 1);
  };

  const back = (): void => {
    if (isElectron && webviewRef.current) {
      try {
        if (webviewRef.current.canGoBack()) webviewRef.current.goBack();
      } catch {
        /* ignore */
      }
    }
  };

  return (
    <div className="flex h-full flex-col bg-panel">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
        <button
          onClick={back}
          disabled={!isElectron}
          title="Back"
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-panel2 hover:text-text disabled:opacity-40"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={2} />
        </button>
        <button
          onClick={reload}
          title="Reload"
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-panel2 hover:text-text"
        >
          <RotateCw className="h-4 w-4" strokeWidth={2} />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-panel2 px-2">
          <Globe className="h-3.5 w-3.5 shrink-0 text-muted" strokeWidth={2} />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') navigate(input);
            }}
            placeholder="localhost:3000"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent py-1 font-mono text-[12px] text-text outline-none placeholder:text-muted/60"
          />
        </div>
        <button
          onClick={() => current && void api.openUrl(current)}
          title="Open in external browser"
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-panel2 hover:text-text"
        >
          <ExternalLink className="h-4 w-4" strokeWidth={2} />
        </button>
        {onClose && (
          <button
            onClick={onClose}
            title="Close preview"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-panel2 hover:text-text"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        )}
      </div>

      {/* Viewport */}
      <div className="relative min-h-0 flex-1 bg-white">
        {!current ? (
          <div className={cls('flex h-full flex-col items-center justify-center gap-2 bg-panel text-center text-muted')}>
            <Globe className="h-8 w-8 opacity-40" strokeWidth={1.5} />
            <div className="text-sm">No preview yet</div>
            <div className="max-w-xs text-xs">
              Start a dev server (the agent can, with a background command) and it'll show up here.
            </div>
          </div>
        ) : isElectron ? (
          <webview
            key={`wv-${nonce}`}
            ref={webviewRef as unknown as React.Ref<HTMLWebViewElement>}
            src={current}
            // eslint-disable-next-line react/no-unknown-property
            allowpopups={true}
            className="h-full w-full"
            style={{ display: 'flex', width: '100%', height: '100%' }}
          />
        ) : (
          <iframe
            key={`if-${nonce}`}
            ref={iframeRef}
            src={current}
            title="preview"
            className="h-full w-full border-0"
          />
        )}
      </div>
    </div>
  );
}
