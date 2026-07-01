import React, { useCallback, useEffect, useState } from 'react';
import { ChevronRight, File as FileIcon, Folder, FolderOpen, RefreshCw } from 'lucide-react';
import { api, type FileEntry } from '../lib/api';
import { cls } from './common';

/**
 * IDE-style file explorer for the active project. Lazily loads each
 * directory's children as the user expands it (so huge repos stay
 * cheap). Clicking a file inserts an `@path` mention into the composer
 * — the fast way to reference code while prompting — and hovering
 * reveals an "open in editor" affordance.
 */
export function FileTree({
  project,
  onMention,
  onOpenFile,
}: {
  project: string | null;
  onMention?: (relPath: string) => void;
  onOpenFile?: (relPath: string) => void;
}): React.ReactElement {
  const name = project ? project.replace(/\/+$/, '').split('/').pop() || project : null;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5 text-sm font-medium">
        <FolderOpen className="h-4 w-4 text-muted" />
        <span className="truncate" title={project ?? undefined}>{name ?? 'Files'}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {project ? (
          <DirLevel key={project} project={project} dir="" depth={0} onMention={onMention} onOpenFile={onOpenFile} />
        ) : (
          <div className="px-3 py-2 text-xs text-muted/70">No folder selected</div>
        )}
      </div>
    </div>
  );
}

function DirLevel({
  project,
  dir,
  depth,
  onMention,
  onOpenFile,
}: {
  project: string;
  dir: string;
  depth: number;
  onMention?: (relPath: string) => void;
  onOpenFile?: (relPath: string) => void;
}): React.ReactElement {
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    void api
      .files(project, dir)
      .then((r) => setEntries(r.entries))
      .catch(() => {
        setEntries([]);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, [project, dir]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !entries) {
    return <div style={{ paddingLeft: depth * 12 + 12 }} className="py-1 text-xs text-muted/60">Loading…</div>;
  }
  if (error) {
    return (
      <button
        onClick={load}
        style={{ paddingLeft: depth * 12 + 12 }}
        className="flex items-center gap-1 py-1 text-xs text-muted/70 hover:text-text"
      >
        <RefreshCw className="h-3 w-3" /> retry
      </button>
    );
  }
  if (entries && entries.length === 0) {
    return <div style={{ paddingLeft: depth * 12 + 12 }} className="py-1 text-xs text-muted/50">empty</div>;
  }
  return (
    <div>
      {entries?.map((e) =>
        e.type === 'dir' ? (
          <DirRow key={e.path} project={project} entry={e} depth={depth} onMention={onMention} onOpenFile={onOpenFile} />
        ) : (
          <FileRow key={e.path} entry={e} depth={depth} onMention={onMention} onOpenFile={onOpenFile} />
        ),
      )}
    </div>
  );
}

function DirRow({
  project,
  entry,
  depth,
  onMention,
  onOpenFile,
}: {
  project: string;
  entry: FileEntry;
  depth: number;
  onMention?: (relPath: string) => void;
  onOpenFile?: (relPath: string) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ paddingLeft: depth * 12 + 6 }}
        className="flex w-full items-center gap-1 py-1 pr-2 text-left text-[13px] text-muted transition-colors hover:bg-panel2 hover:text-text"
        title={entry.path}
      >
        <ChevronRight className={cls('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-90')} strokeWidth={2.5} />
        {open ? <FolderOpen className="h-3.5 w-3.5 shrink-0" /> : <Folder className="h-3.5 w-3.5 shrink-0" />}
        <span className="truncate">{entry.name}</span>
      </button>
      {open && <DirLevel project={project} dir={entry.path} depth={depth + 1} onMention={onMention} onOpenFile={onOpenFile} />}
    </div>
  );
}

function FileRow({
  entry,
  depth,
  onMention,
  onOpenFile,
}: {
  entry: FileEntry;
  depth: number;
  onMention?: (relPath: string) => void;
  onOpenFile?: (relPath: string) => void;
}): React.ReactElement {
  return (
    <div
      className="group/file flex w-full items-center gap-1 pr-2 text-[13px] text-muted hover:bg-panel2 hover:text-text"
      style={{ paddingLeft: depth * 12 + 6 }}
    >
      <button
        onClick={() => onMention?.(entry.path)}
        className="flex min-w-0 flex-1 items-center gap-1 py-1 text-left"
        title={onMention ? `Reference @${entry.path} in the prompt` : entry.path}
      >
        <span className="w-3.5 shrink-0" />
        <FileIcon className="h-3.5 w-3.5 shrink-0 opacity-70" />
        <span className="truncate">{entry.name}</span>
      </button>
      {onOpenFile && (
        <button
          onClick={(ev) => {
            ev.stopPropagation();
            onOpenFile(entry.path);
          }}
          className="shrink-0 rounded px-1 text-[10px] text-muted opacity-0 transition-opacity hover:text-text group-hover/file:opacity-100"
          title="Open in editor"
        >
          open
        </button>
      )}
    </div>
  );
}
