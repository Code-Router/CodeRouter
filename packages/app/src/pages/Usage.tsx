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
        <BreakdownTable title="By mode" rows={data.byMode} />
        <BreakdownTable title="By provider" rows={data.byProvider} />
        <BreakdownTable title="By task type" rows={data.byTaskType} />
      </div>

      <Section title="Recent runs">
        <div className="card divide-y divide-border p-0">
          {data.recentRuns.slice(0, 25).map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="w-16 shrink-0 text-xs text-muted">{r.mode}</span>
              <span className="min-w-0 flex-1 truncate">{r.prompt}</span>
              <span className="shrink-0 text-xs text-muted">{r.route}</span>
              <span className="w-16 shrink-0 text-right text-xs">{money(r.costUsd)}</span>
              <span className="w-16 shrink-0 text-right text-xs text-muted">{timeAgo(r.createdAt)}</span>
            </div>
          ))}
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

function BreakdownTable({ title, rows }: { title: string; rows: Breakdown[] }): React.ReactElement {
  return (
    <Section title={title}>
      <div className="card space-y-1">
        {rows.length === 0 && <div className="text-sm text-muted">—</div>}
        {rows.map((r) => (
          <div key={r.key} className="flex items-center justify-between text-sm">
            <span className="truncate text-muted">{r.label}</span>
            <span>
              {r.runs} · {money(r.costUsd)}
            </span>
          </div>
        ))}
      </div>
    </Section>
  );
}
