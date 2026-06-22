import React, { useEffect, useState } from 'react';
import { api, type SettingsReport, type UsageReport } from '../lib/api';
import { Heatmap } from '../components/Heatmap';
import { Section, Spinner, money } from '../components/common';
import { DEFAULT_LIMIT_USD, SpendingProgress } from './Spending';

export function OverviewPage(): React.ReactElement {
  const [data, setData] = useState<UsageReport | null>(null);
  const [settings, setSettings] = useState<SettingsReport | null>(null);
  useEffect(() => {
    void api.usage().then(setData).catch(() => {});
    void api.settings().then(setSettings).catch(() => {});
  }, []);
  if (!data) return <Spinner />;
  const t = data.totals;
  const h = data.highlights;
  const limit = settings?.limits.monthlyUsd ?? DEFAULT_LIMIT_USD;

  return (
    <div>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Big label="Runs" value={String(t.runs)} />
        <Big label="Spend" value={money(t.costUsd)} />
        <Big label="Tokens" value={fmt(t.tokens)} />
        <Big label="Projects" value={String(data.project.projectCount)} />
      </div>

      <Section title="Monthly spend">
        <div className="card">
          <div className="mb-3 flex items-baseline justify-between">
            <span className="text-sm text-muted">This month</span>
            <span className="text-sm">
              <span className="font-semibold">{money(t.monthCostUsd)}</span>
              <span className="text-muted"> / {money(limit)}</span>
            </span>
          </div>
          <SpendingProgress spent={t.monthCostUsd} limit={limit} />
        </div>
      </Section>

      <Section title="Activity">
        <div className="card">
          <Heatmap days={data.heatmap} />
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
            <span>Current streak: <b className="text-text">{h.currentStreakDays}d</b></span>
            <span>Longest streak: <b className="text-text">{h.longestStreakDays}d</b></span>
            {h.mostActiveDay && <span>Most active day: <b className="text-text">{h.mostActiveDay}</b></span>}
          </div>
        </div>
      </Section>

      <Section title="Recent">
        <div className="card divide-y divide-border p-0">
          {data.recentRuns.slice(0, 8).map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="w-16 shrink-0 text-xs text-muted">{r.mode}</span>
              <span className="min-w-0 flex-1 truncate">{r.prompt}</span>
              <span className="shrink-0 text-xs text-muted">{money(r.costUsd)}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Big({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-2 text-3xl font-semibold">{value}</div>
    </div>
  );
}

function fmt(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}
