import React from 'react';
import { GitCompare } from 'lucide-react';
import { DiffView } from './DiffView';
import type { ChatChanges } from '../pages/Chat';

/** Side panel mirroring the active chat's file changes (Codex "Files"). */
export function ChangesPanel({ changes }: { changes: ChatChanges | null }): React.ReactElement {
  const has = changes && (changes.diff || changes.filesChanged.length);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5 text-sm font-medium">
        <GitCompare className="h-4 w-4 text-muted" />
        Changes
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {has ? (
          <DiffView diff={changes!.diff} filesChanged={changes!.filesChanged} defaultOpen />
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center text-sm text-muted">
            <GitCompare className="mb-2 h-6 w-6 opacity-40" />
            No changes yet
            <span className="mt-1 text-xs">File edits from the current chat will appear here.</span>
          </div>
        )}
      </div>
    </div>
  );
}
