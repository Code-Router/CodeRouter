import React, { useEffect, useState } from 'react';
import { api, type CatalogModel, type OpenRouterCatalog, type SettingsReport } from '../lib/api';
import { Section, Spinner, cls } from '../components/common';
import { Dropdown, type DropdownOption } from '../components/Dropdown';

export function ModelsPage(): React.ReactElement {
  const [data, setData] = useState<SettingsReport | null>(null);
  const [catalog, setCatalog] = useState<OpenRouterCatalog | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = (): void => {
    void api.settings().then(setData).catch(() => {});
  };
  useEffect(refresh, []);
  useEffect(() => {
    void api
      .openrouterModels()
      .then(setCatalog)
      .catch(() => setCatalog({ models: [], error: 'Could not reach the OpenRouter catalog.' }));
  }, []);

  if (!data) return <Spinner />;

  const setPreferred = async (tier: 'strong' | 'cheap', model: string): Promise<void> => {
    setSaving(true);
    try {
      if (!model) await api.setPreferred(tier, null, null);
      else await api.setPreferred(tier, 'openrouter_agent', model);
      refresh();
    } finally {
      setSaving(false);
    }
  };

  const cur = (tier: 'strong' | 'cheap'): string => data.preferredModels[tier]?.model ?? '';

  const models = catalog?.models ?? [];
  const options: DropdownOption[] = [
    { value: '', label: <span className="text-muted">Automatic — let the router decide</span>, searchText: 'automatic router default' },
    ...models.map((m) => ({
      value: m.id,
      label: <ModelLabel m={m} />,
      buttonLabel: <span className="font-mono text-sm">{m.id}</span>,
      meta: priceHint(m),
      searchText: `${m.id} ${m.label}`,
    })),
  ];

  return (
    <div>
      <p className="mb-5 text-sm text-muted">
        Pin the models the router leans on. <b className="text-text">Strong</b> handles high-effort work;{' '}
        <b className="text-text">cheap</b> handles trivial / cost-sensitive tasks. Loops map roles to these tiers too.
      </p>

      {(['strong', 'cheap'] as const).map((tier) => (
        <Section key={tier} title={`${tier} tier`}>
          <Dropdown
            value={cur(tier)}
            onChange={(v) => void setPreferred(tier, v)}
            disabled={saving}
            searchable
            options={options}
            placeholder="Automatic — let the router decide"
            footer={
              catalog?.error
                ? 'Could not reach the OpenRouter catalog. Connect OpenRouter in Settings to pick specific models.'
                : models.length
                  ? `${models.length} models from the OpenRouter catalog`
                  : 'Loading the OpenRouter catalog…'
            }
          />
        </Section>
      ))}
    </div>
  );
}

function ModelLabel({ m }: { m: CatalogModel }): React.ReactElement {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 truncate font-mono">{m.id}</span>
      {m.tier && <Cap kind={`q-${m.tier}`}>{`${m.tier} ${Math.round(m.coding || 0)}`}</Cap>}
      {m.tools && <Cap kind="tools">tools</Cap>}
      {m.vision && <Cap kind="vision">vision</Cap>}
    </span>
  );
}

const CAP_COLORS: Record<string, string> = {
  tools: 'text-emerald-300 border-emerald-400/35',
  vision: 'text-violet-300 border-violet-400/35',
  'q-frontier': 'text-amber-300 border-amber-400/40',
  'q-strong': 'text-violet-300 border-violet-400/35',
  'q-mid': 'text-cyan-300 border-cyan-400/35',
  'q-small': 'text-muted border-border',
};

function Cap({ kind, children }: { kind: string; children: React.ReactNode }): React.ReactElement {
  return (
    <span
      className={cls(
        'shrink-0 whitespace-nowrap rounded border px-1 py-px text-[9px] font-semibold uppercase tracking-wide',
        CAP_COLORS[kind] ?? 'text-muted border-border',
      )}
    >
      {children}
    </span>
  );
}

function priceHint(m: CatalogModel): string {
  if (!m.pricePer1MIn && !m.pricePer1MOut) return 'free';
  const f = (n: number): string => (n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}`);
  return `${f(m.pricePer1MIn)} in / ${f(m.pricePer1MOut)} out`;
}
