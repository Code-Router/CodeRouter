import React, { useEffect, useState } from 'react';
import { api, type SettingsReport, type UsageReport } from '../lib/api';
import { Section, Spinner, cls, money } from '../components/common';

/** Default cap mirrored from the daemon (`DEFAULT_MONTHLY_LIMIT_USD`). */
export const DEFAULT_LIMIT_USD = 50;

/** A Cursor-style spend-vs-limit progress bar. */
export function SpendingProgress({
  spent,
  limit,
}: {
  spent: number;
  limit: number;
}): React.ReactElement {
  const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
  const over = spent >= limit;
  return (
    <div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-panel2">
        <div
          className={cls('h-full rounded-full transition-all', over ? 'bg-bad' : 'bg-accent')}
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-xs">
        <span className={cls(over ? 'text-bad' : 'text-muted')}>
          {over ? 'Monthly limit reached' : `${money(Math.max(0, limit - spent))} remaining this month`}
        </span>
        <span className="text-muted">{Math.round(pct)}%</span>
      </div>
    </div>
  );
}

export function SpendingPage(): React.ReactElement {
  const [usage, setUsage] = useState<UsageReport | null>(null);
  const [settings, setSettings] = useState<SettingsReport | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const load = (): void => {
    void api.usage().then(setUsage).catch(() => {});
    void api
      .settings()
      .then((s) => {
        setSettings(s);
        setDraft(String(s.limits.monthlyUsd ?? DEFAULT_LIMIT_USD));
      })
      .catch(() => {});
  };
  useEffect(load, []);

  if (!usage || !settings) return <Spinner />;

  const t = usage.totals;
  const limit = settings.limits.monthlyUsd ?? DEFAULT_LIMIT_USD;
  const spent = t.monthCostUsd;
  const avgPerRun = t.runs > 0 ? t.costUsd / t.runs : 0;
  const maxProvider = Math.max(1, ...usage.byProvider.map((b) => b.costUsd));

  const save = async (): Promise<void> => {
    const val = Number(draft);
    setSaving(true);
    try {
      await api.setLimit(Number.isFinite(val) && val > 0 ? val : null);
      load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="mb-5 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Spending</h1>
        <span className="text-sm text-muted">{money(t.costUsd)} all-time</span>
      </div>

      {/* Monthly meter + limit editor */}
      <div className="card mb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted">Spending · {monthLabel(t.monthKey)}</div>
            <div className="mt-1 text-3xl font-semibold">{money(spent)}</div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">Monthly limit $</span>
            <input
              type="number"
              min={0}
              step={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="input w-28"
              placeholder={String(DEFAULT_LIMIT_USD)}
            />
            <button onClick={() => void save()} disabled={saving} className="btn btn-primary">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
        <div className="mt-4">
          <SpendingProgress spent={spent} limit={limit} />
        </div>
      </div>

      {/* Stat cards */}
      <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        <Stat label="This month" value={money(spent)} hint={monthLabel(t.monthKey)} />
        <Stat label="All-time cost" value={money(t.costUsd)} hint={`${t.runs} runs`} />
        <Stat label="Avg cost / run" value={money(avgPerRun)} hint="across all routes" />
      </div>

      <Section title="Cost by model / provider">
        <div className="card space-y-3">
          {usage.byProvider.length === 0 && <div className="text-sm text-muted">No spend recorded yet.</div>}
          {usage.byProvider.map((b) => (
            <div key={b.key}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="min-w-0 truncate">{b.label}</span>
                <span className="shrink-0 text-muted">{money(b.costUsd)}</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel2">
                <div className="h-full rounded-full bg-accent" style={{ width: `${(b.costUsd / maxProvider) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }): React.ReactElement {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

/** `YYYY-MM` → `June 2026`. */
function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  if (!y || !m) return monthKey;
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}
