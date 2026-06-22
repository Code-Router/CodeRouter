import React from 'react';
import type { ProjectSummary } from '../lib/api';
import { EmptyState, money, timeAgo } from '../components/common';

export function ProjectsPage({
  projects,
  onOpen,
}: {
  projects: ProjectSummary[];
  onOpen: (cwd: string) => void;
}): React.ReactElement {
  if (projects.length === 0)
    return <EmptyState title="No projects yet" hint="Run CodeRouter in any repo and it shows up here." />;
  return (
    <div>
      <p className="mb-4 text-sm text-muted">
        Every repository you’ve used CodeRouter in on this machine. Click one to focus its loops.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {projects.map((p) => (
          <button
            key={p.cwd}
            onClick={() => onOpen(p.cwd)}
            className="card text-left transition-colors hover:border-accent"
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">{p.name}</span>
              <span className="text-xs text-muted">{timeAgo(p.lastActivity)}</span>
            </div>
            <div className="mt-1 truncate text-xs text-muted">{p.cwd}</div>
            <div className="mt-3 flex gap-4 text-sm">
              <span><b>{p.runs}</b> <span className="text-muted">runs</span></span>
              <span><b>{p.loops}</b> <span className="text-muted">loops</span></span>
              <span><b>{p.chats}</b> <span className="text-muted">chats</span></span>
              <span className="ml-auto text-muted">{money(p.costUsd)}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
