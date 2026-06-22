import React, { useMemo, useState } from 'react';
import { ChevronRight, FileDiff } from 'lucide-react';
import { cls } from './common';

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
}: {
  diff?: string | null;
  filesChanged?: string[];
  defaultOpen?: boolean;
}): React.ReactElement | null {
  const files = useMemo(() => (diff ? parseDiff(diff) : []), [diff]);
  const fileCount = files.length || filesChanged?.length || 0;
  if (fileCount === 0) return null;

  const totalAdd = files.reduce((n, f) => n + f.additions, 0);
  const totalDel = files.reduce((n, f) => n + f.deletions, 0);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-panel">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm">
        <FileDiff className="h-4 w-4 text-muted" />
        <span className="font-medium">
          Edited {fileCount} file{fileCount === 1 ? '' : 's'}
        </span>
        {(totalAdd > 0 || totalDel > 0) && (
          <span className="ml-auto font-mono text-xs">
            <span className="text-ok">+{totalAdd}</span> <span className="text-bad">−{totalDel}</span>
          </span>
        )}
      </div>
      {files.length > 0 ? (
        <div className="divide-y divide-border">
          {files.map((f) => (
            <FileRow key={f.path} file={f} defaultOpen={defaultOpen} />
          ))}
        </div>
      ) : (
        <ul className="px-3 py-2 text-sm text-muted">
          {(filesChanged ?? []).map((p) => (
            <li key={p} className="truncate font-mono text-xs">
              {p}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FileRow({ file, defaultOpen }: { file: FileDiffEntry; defaultOpen?: boolean }): React.ReactElement {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left hover:bg-panel2">
        <ChevronRight className={cls('h-3.5 w-3.5 shrink-0 text-muted transition-transform', open && 'rotate-90')} />
        <span className="truncate font-mono text-xs text-text">{file.path}</span>
        <span className="ml-auto shrink-0 font-mono text-[11px]">
          <span className="text-ok">+{file.additions}</span> <span className="text-bad">−{file.deletions}</span>
        </span>
      </button>
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
