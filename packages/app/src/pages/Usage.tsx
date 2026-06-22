import React, { useEffect, useState } from 'react';
import { api, type Breakdown, type UsageReport } from '../lib/api';
import { Heatmap } from '../components/Heatmap';
import { Section, Spinner, money, timeAgo } from '../components/common';

export function UsagePage(): React.ReactElement {
  const [data, setData] = useState<UsageReport | null>(null);
  useEffect(() => {
    void api.usage().then(setData).catch(() => {});
  }, []);
  if (!data) return <Spinner />;
  const t = data.totals;

  return (
    <div>
      <div className="mb-4 text-sm text-muted">
        Aggregated across {data.project.projectCount} project{data.project.projectCount === 1 ? '' : 's'} on this machine.
      </div>
      <div className="mb-6 grid grid-cols-4 gap-3">
        <Metric label="Runs" value={String(t.runs)} />
        <Metric label="Total cost" value={money(t.costUsd)} />
        <Metric label="This month" value={money(t.monthCostUsd)} />
        <Metric label="Success" value={`${Math.round(t.successRate * 100)}%`} />
      </div>

      <Section title="Activity">
        <div className="card">
          <Heatmap days={data.heatmap} />
        </div>
      </Section>

      <div className="grid gap-6 md:grid-cols-3">
        <BreakdownTable title="By mode" nameLabel="Mode" rows={data.byMode} />
        <BreakdownTable title="By provider" nameLabel="Provider · model" rows={data.byProvider} />
        <BreakdownTable title="By task type" nameLabel="Task type" rows={data.byTaskType} />
      </div>

      <Section title="Recent runs">
        <div className="card p-0 text-sm">
          <div className="flex items-center gap-3 border-b border-border px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted">
            <span className="w-16 shrink-0">Mode</span>
            <span className="min-w-0 flex-1">Prompt</span>
            <span className="hidden w-48 shrink-0 lg:block">Route</span>
            <span className="w-16 shrink-0 text-right">Cost</span>
            <span className="w-16 shrink-0 text-right">When</span>
          </div>
          <div className="divide-y divide-border">
            {data.recentRuns.slice(0, 25).map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-3 py-2">
                <span className="w-16 shrink-0 truncate text-xs text-muted">{r.mode}</span>
                <span className="min-w-0 flex-1 truncate" title={r.prompt}>{r.prompt}</span>
                <span className="hidden w-48 shrink-0 truncate text-xs text-muted lg:block" title={r.route}>{r.route}</span>
                <span className="w-16 shrink-0 text-right text-xs tabular-nums">{money(r.costUsd)}</span>
                <span className="w-16 shrink-0 text-right text-xs text-muted">{timeAgo(r.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      </Section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="card">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function BreakdownTable({ title, nameLabel, rows }: { title: string; nameLabel: string; rows: Breakdown[] }): React.ReactElement {
  const maxCost = Math.max(1e-9, ...rows.map((r) => r.costUsd));
  return (
    <Section title={title}>
      <div className="card p-0 text-sm">
        <div className="flex items-center gap-3 border-b border-border px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted">
          <span className="min-w-0 flex-1 truncate">{nameLabel}</span>
          <span className="w-10 shrink-0 text-right">Runs</span>
          <span className="w-16 shrink-0 text-right">Cost</span>
        </div>
        {rows.length === 0 && <div className="px-3 py-3 text-muted">No data yet.</div>}
        <div className="divide-y divide-border/60">
          {rows.map((r) => (
            <div key={r.key} className="px-3 py-2">
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate" title={r.label}>{r.label}</span>
                <span className="w-10 shrink-0 text-right tabular-nums text-muted">{r.runs}</span>
                <span className="w-16 shrink-0 text-right tabular-nums">{money(r.costUsd)}</span>
              </div>
              <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-panel2">
                <div className="h-full rounded-full bg-accent/70" style={{ width: `${(r.costUsd / maxCost) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}
