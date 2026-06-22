import React from 'react';
import type { LoopStatus } from '@coderouter/core';

export function cls(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function money(n: number | undefined): string {
  return `$${(n ?? 0).toFixed(n && n < 1 ? 4 : 2)}`;
}

export function timeAgo(ts: number): string {
  if (!ts) return '—';
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'text-muted border-border',
  queued: 'text-accent border-accent',
  running: 'text-accent border-accent',
  paused: 'text-warn border-warn',
  awaiting_approval: 'text-warn border-warn',
  succeeded: 'text-ok border-ok',
  failed: 'text-bad border-bad',
  stopped: 'text-muted border-border',
};

export function StatusBadge({ status }: { status: LoopStatus | string }): React.ReactElement {
  const color = STATUS_COLORS[status] ?? 'text-muted border-border';
  const label = String(status).replace('_', ' ');
  return (
    <span className={cls('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs', color)}>
      {(status === 'running' || status === 'queued') && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
      )}
      {label}
    </span>
  );
}

export function Spinner(): React.ReactElement {
  return <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />;
}

export function EmptyState({ title, hint }: { title: string; hint?: string }): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-20 text-center text-muted">
      <div className="text-base text-text">{title}</div>
      {hint && <div className="max-w-md text-sm">{hint}</div>}
    </div>
  );
}

export function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>
        {right}
      </div>
      {children}
    </div>
  );
}
