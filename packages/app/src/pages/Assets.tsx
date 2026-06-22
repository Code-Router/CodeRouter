import React, { useEffect, useState } from 'react';
import { api, type Asset, type AssetsReport } from '../lib/api';
import { EmptyState, Section, Spinner, cls } from '../components/common';

export function AssetsPage(): React.ReactElement {
  const [data, setData] = useState<AssetsReport | null>(null);
  useEffect(() => {
    void api.assets().then(setData).catch(() => {});
  }, []);
  if (!data) return <Spinner />;

  const empty = data.rules.length + data.skills.length + data.subagents.length === 0;

  return (
    <div className="max-w-3xl">
      <p className="mb-4 text-sm text-muted">
        Rules, skills, and subagents are injected into prompts and per-subtask routing. Project scope overrides global.
        Manage files under <code className="text-text">{data.roots.project}</code> and{' '}
        <code className="text-text">{data.roots.global}</code>.
      </p>
      {empty && <EmptyState title="No customization assets yet" hint="Add rules/skills/subagents via the CLI or plugin marketplace." />}
      <AssetGroup title="Rules" items={data.rules} />
      <AssetGroup title="Skills" items={data.skills} />
      <AssetGroup title="Subagents" items={data.subagents} />
    </div>
  );
}

function AssetGroup({ title, items }: { title: string; items: Asset[] }): React.ReactElement | null {
  if (items.length === 0) return null;
  return (
    <Section title={`${title} (${items.length})`}>
      <div className="space-y-2">
        {items.map((a) => (
          <div key={`${a.scope}:${a.name}`} className="card flex items-center justify-between">
            <div>
              <div className="font-medium">{a.name}</div>
              {a.description && <div className="text-sm text-muted">{a.description}</div>}
            </div>
            <span className={cls('chip', a.scope === 'project' ? 'border-accent text-accent' : '')}>{a.scope}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}
