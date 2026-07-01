import React, { useMemo, useState } from 'react';
import { Check, ChevronRight, ExternalLink, FileDiff, Loader2, Undo2, X } from 'lucide-react';
import { cls } from './common';

/** Collapse an absolute path to a `~`-relative, readable form. */
function prettyDir(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~');
}

type FileDiffEntry = {
  path: string;
  additions: number;
  deletions: number;
  lines: string[];
};

/** Parse a unified `git diff` into per-file entries with +/- counts. */
function parseDiff(diff: string): FileDiffEntry[] {
  const files: FileDiffEntry[] = [];
  let current: FileDiffEntry | null = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git')) {
      const m = /b\/(.+)$/.exec(line);
      current = { path: m ? m[1] : line.replace('diff --git ', ''), additions: 0, deletions: 0, lines: [] };
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('index ')) continue;
    if (line.startsWith('rename to ')) {
      current.path = line.slice('rename to '.length);
    }
    current.lines.push(line);
    if (line.startsWith('+') && !line.startsWith('+++')) current.additions += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) current.deletions += 1;
  }
  return files;
}

/**
 * Codex-style change summary: an "Edited N files +X −Y" header with an
 * expandable, syntax-colored unified diff per file.
 */
export function DiffView({
  diff,
  filesChanged,
  defaultOpen,
  applied,
  cwd,
  onAccept,
  onRevert,
  onReject,
  onOpenFile,
}: {
  diff?: string | null;
  filesChanged?: string[];
  defaultOpen?: boolean;
  /** When true, the changes are already on disk (auto-applied or accepted). */
  applied?: boolean;
  /** Working directory the edits were made in (shown in the header). */
  cwd?: string | null;
  /** When provided, shows an "Accept changes" action that applies the diff. */
  onAccept?: () => Promise<void> | void;
  /** When provided, shows an "Undo" action that reverses an applied diff. */
  onRevert?: () => Promise<void> | void;
  /** Called when the user rejects (discards) an un-applied proposal. */
  onReject?: () => void;
  /** When provided, clicking a file path opens it in the user's editor. */
  onOpenFile?: (path: string) => void;
}): React.ReactElement | null {
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [reverted, setReverted] = useState(false);
  const [discarded, setDiscarded] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const files = useMemo(() => (diff ? parseDiff(diff) : []), [diff]);
  const fileCount = files.length || filesChanged?.length || 0;
  if (fileCount === 0) return null;

  const totalAdd = files.reduce((n, f) => n + f.additions, 0);
  const totalDel = files.reduce((n, f) => n + f.deletions, 0);
  const isApplied = (applied || accepted) && !reverted;

  if (discarded) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-panel px-3 py-2 text-xs text-muted">
        <FileDiff className="h-3.5 w-3.5 shrink-0" />
        <span>
          Change rejected · {fileCount} file{fileCount === 1 ? '' : 's'}
        </span>
        <button
          onClick={() => setDiscarded(false)}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 font-medium transition-colors hover:border-accent/50 hover:text-text"
          title="Show this proposed change again"
        >
          <Undo2 className="h-3 w-3" />
          Restore
        </button>
      </div>
    );
  }

  const accept = async (): Promise<void> => {
    if (!onAccept || accepting) return;
    setAccepting(true);
    setAcceptError(null);
    try {
      await onAccept();
      setAccepted(true);
      setReverted(false);
    } catch (e) {
      setAcceptError(e instanceof Error ? e.message : String(e));
    } finally {
      setAccepting(false);
    }
  };

  const revert = async (): Promise<void> => {
    if (!onRevert || reverting) return;
    setReverting(true);
    setAcceptError(null);
    try {
      await onRevert();
      setReverted(true);
      setAccepted(false);
    } catch (e) {
      setAcceptError(e instanceof Error ? e.message : String(e));
    } finally {
      setReverting(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-panel">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm">
        <FileDiff className="h-4 w-4 shrink-0 text-muted" />
        <span className="font-medium">
          Edited {fileCount} file{fileCount === 1 ? '' : 's'}
        </span>
        {(totalAdd > 0 || totalDel > 0) && (
          <span className="font-mono text-xs">
            <span className="text-ok">+{totalAdd}</span> <span className="text-bad">−{totalDel}</span>
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {isApplied ? (
            <>
              <span className="inline-flex items-center gap-1 text-xs font-medium text-ok">
                <Check className="h-3.5 w-3.5" />
                {applied ? 'Applied' : 'Accepted'}
              </span>
              {onRevert && (
                <button
                  onClick={() => void revert()}
                  disabled={reverting}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:border-bad/50 hover:text-bad disabled:opacity-60"
                  title="Revert these changes from your files"
                >
                  {reverting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                  {reverting ? 'Undoing…' : 'Undo'}
                </button>
              )}
            </>
          ) : (
            <>
              {reverted && <span className="text-xs font-medium text-muted">Reverted</span>}
              <button
                onClick={() => {
                  setDiscarded(true);
                  onReject?.();
                }}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:border-bad/50 hover:text-bad"
                title="Discard this proposed change"
              >
                <X className="h-3.5 w-3.5" />
                Reject
              </button>
              {onAccept && (
                <button
                  onClick={() => void accept()}
                  disabled={accepting}
                  className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-accent/80 disabled:opacity-60"
                  title="Apply these changes to your files"
                >
                  {accepting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  {accepting ? 'Applying…' : reverted ? 'Re-apply' : 'Accept'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {cwd && (
        <div className="flex items-center gap-1 border-b border-border/60 px-3 py-1 font-mono text-[11px] text-muted">
          <span className="shrink-0 opacity-70">in</span>
          <span className="truncate" title={cwd}>{prettyDir(cwd)}</span>
        </div>
      )}
      {acceptError && (
        <div className="border-b border-bad/40 bg-bad/10 px-3 py-1.5 text-xs text-bad">{acceptError}</div>
      )}
      {files.length > 0 ? (
        <div className="divide-y divide-border">
          {files.map((f) => (
            <FileRow key={f.path} file={f} defaultOpen={defaultOpen} onOpenFile={onOpenFile} />
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-border/60 px-1 py-1 text-sm text-muted">
          {(filesChanged ?? []).map((p) => (
            <li key={p}>
              <button
                onClick={onOpenFile ? () => onOpenFile(p) : undefined}
                disabled={!onOpenFile}
                className={cls(
                  'group/file flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left font-mono text-xs',
                  onOpenFile ? 'hover:bg-panel2 hover:text-text' : 'cursor-default',
                )}
                title={onOpenFile ? 'Open in editor' : undefined}
              >
                <span className="truncate">{p}</span>
                {onOpenFile && <ExternalLink className="ml-auto h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover/file:opacity-100" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FileRow({
  file,
  defaultOpen,
  onOpenFile,
}: {
  file: FileDiffEntry;
  defaultOpen?: boolean;
  onOpenFile?: (path: string) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <div>
      <div className="group/file flex w-full items-center gap-1.5 px-3 py-1.5 hover:bg-panel2">
        <button onClick={() => setOpen((o) => !o)} className="flex shrink-0 items-center" title={open ? 'Collapse' : 'Expand'}>
          <ChevronRight className={cls('h-3.5 w-3.5 text-muted transition-transform', open && 'rotate-90')} />
        </button>
        <button
          onClick={onOpenFile ? () => onOpenFile(file.path) : () => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          title={onOpenFile ? 'Open in editor' : undefined}
        >
          <span className="truncate font-mono text-xs text-text">{file.path}</span>
          {onOpenFile && <ExternalLink className="h-3 w-3 shrink-0 text-muted opacity-0 transition-opacity group-hover/file:opacity-100" />}
        </button>
        <span className="ml-auto shrink-0 font-mono text-[11px]">
          <span className="text-ok">+{file.additions}</span> <span className="text-bad">−{file.deletions}</span>
        </span>
      </div>
      {open && (
        <pre className="overflow-x-auto border-t border-border bg-bg/40 px-3 py-2 text-[11px] leading-[1.5]">
          <code>
            {file.lines.map((line, i) => (
              <div
                key={i}
                className={cls(
                  'whitespace-pre',
                  line.startsWith('+') && 'bg-ok/10 text-ok',
                  line.startsWith('-') && 'bg-bad/10 text-bad',
                  line.startsWith('@@') && 'text-accent',
                  !line.startsWith('+') && !line.startsWith('-') && !line.startsWith('@@') && 'text-muted',
                )}
              >
                {line || ' '}
              </div>
            ))}
          </code>
        </pre>
      )}
    </div>
  );
}
