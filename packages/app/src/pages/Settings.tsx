import React, { useEffect, useState } from 'react';
import { api, type SettingsReport } from '../lib/api';
import { Section, Spinner, cls } from '../components/common';

export function SettingsPage(): React.ReactElement {
  const [data, setData] = useState<SettingsReport | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = (): void => {
    void api.settings().then(setData).catch(() => {});
  };
  useEffect(refresh, []);
  if (!data) return <Spinner />;

  const saveKey = async (name: string): Promise<void> => {
    const v = keys[name]?.trim();
    if (!v) return;
    setBusy(name);
    try {
      await api.saveKey(name, v);
      setKeys((k) => ({ ...k, [name]: '' }));
      refresh();
    } finally {
      setBusy(null);
    }
  };

  const toggleHost = async (provider: string, enabled: boolean): Promise<void> => {
    setBusy(provider);
    try {
      await api.setHost(provider, enabled);
      refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="max-w-3xl">
      <Section title="Cloud providers">
        <div className="space-y-2">
          {data.providers.map((p) => (
            <div key={p.name} className="card flex items-center gap-3">
              <div className="w-40 shrink-0">
                <div className="font-medium">{p.label}</div>
                <div className="text-xs text-muted">{p.envVar}</div>
              </div>
              {p.configured ? (
                <span className="chip border-ok text-ok">configured{p.source ? ` · ${p.source}` : ''}</span>
              ) : (
                <>
                  <input
                    className="input flex-1"
                    type="password"
                    placeholder={`set ${p.envVar}`}
                    value={keys[p.name] ?? ''}
                    onChange={(e) => setKeys((k) => ({ ...k, [p.name]: e.target.value }))}
                  />
                  <button className="btn" disabled={busy === p.name} onClick={() => void saveKey(p.name)}>
                    Save
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Local host CLIs">
        <div className="space-y-2">
          {data.hosts.map((h) => (
            <div key={h.provider} className="card flex items-center justify-between">
              <div>
                <div className="font-medium">{h.label}</div>
                <div className="text-xs text-muted">{h.binPath || h.cli || 'not detected'}</div>
              </div>
              <button
                className={cls('btn', h.enabled && 'btn-primary')}
                disabled={busy === h.provider}
                onClick={() => void toggleHost(h.provider, !h.enabled)}
              >
                {h.enabled ? 'Enabled' : 'Disabled'}
              </button>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Spending limit">
        <SpendingLimit current={data.limits.monthlyUsd} onSave={(v) => api.setLimit(v).then(refresh)} />
      </Section>

      <Section title="Paths">
        <div className="card text-xs text-muted">
          <div>credentials: {data.paths.credentials}</div>
          <div>database: {data.paths.db}</div>
        </div>
      </Section>
    </div>
  );
}

function SpendingLimit({
  current,
  onSave,
}: {
  current: number | null;
  onSave: (v: number | null) => Promise<unknown>;
}): React.ReactElement {
  const [val, setVal] = useState(current ? String(current) : '');
  return (
    <div className="card flex items-center gap-2">
      <span className="text-sm text-muted">Monthly cap ($)</span>
      <input className="input max-w-[140px]" type="number" value={val} onChange={(e) => setVal(e.target.value)} placeholder="none" />
      <button className="btn" onClick={() => void onSave(val ? Number(val) : null)}>
        Save
      </button>
    </div>
  );
}
