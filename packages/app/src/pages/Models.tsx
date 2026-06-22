import React, { useEffect, useState } from 'react';
import { api, type SettingsReport } from '../lib/api';
import { Section, Spinner, cls } from '../components/common';

export function ModelsPage(): React.ReactElement {
  const [data, setData] = useState<SettingsReport | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = (): void => {
    void api.settings().then(setData).catch(() => {});
  };
  useEffect(refresh, []);
  if (!data) return <Spinner />;

  const setPreferred = async (tier: 'strong' | 'cheap', value: string): Promise<void> => {
    setSaving(true);
    try {
      if (!value) await api.setPreferred(tier, null, null);
      else {
        const [provider, ...rest] = value.split('::');
        await api.setPreferred(tier, provider, rest.join('::'));
      }
      refresh();
    } finally {
      setSaving(false);
    }
  };

  const cur = (tier: 'strong' | 'cheap'): string => {
    const p = data.preferredModels[tier];
    return p ? `${p.provider}::${p.model}` : '';
  };

  return (
    <div className="max-w-3xl">
      <p className="mb-4 text-sm text-muted">
        Pin the models the router leans on. <b>Strong</b> handles high-effort work; <b>cheap</b> handles trivial /
        cost-sensitive tasks. Loops map roles to these tiers too.
      </p>
      {(['strong', 'cheap'] as const).map((tier) => (
        <Section key={tier} title={`${tier} tier`}>
          <select
            className="input"
            disabled={saving}
            value={cur(tier)}
            onChange={(e) => void setPreferred(tier, e.target.value)}
          >
            <option value="">(router default)</option>
            {data.availableModels.map((m) => (
              <option key={`${m.provider}::${m.model}`} value={`${m.provider}::${m.model}`}>
                {m.label} — {m.provider} {m.tiers.length ? `(${m.tiers.join('/')})` : ''}
              </option>
            ))}
          </select>
        </Section>
      ))}

      <Section title={`Available models (${data.availableModels.length})`}>
        <div className="card grid grid-cols-2 gap-2">
          {data.availableModels.map((m) => (
            <div key={`${m.provider}::${m.model}`} className="flex items-center justify-between text-sm">
              <span className="truncate">{m.label}</span>
              <span className="flex gap-1">
                {m.tiers.map((t) => (
                  <span key={t} className={cls('chip', t === 'strong' && 'border-accent text-accent')}>
                    {t}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
