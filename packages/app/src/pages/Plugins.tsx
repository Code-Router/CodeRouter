import React, { useState } from 'react';
import { Tabs } from '../components/common';
import { MarketplacePage } from './Marketplace';
import { AssetsPage } from './Assets';

/** Plugins hub: your installed plugins, the marketplace, and customization assets. */
export function PluginsPage({ project }: { project: string | null }): React.ReactElement {
  const [tab, setTab] = useState('installed');
  return (
    <div className="mx-auto w-full max-w-5xl">
      <Tabs
        tabs={[
          { id: 'installed', label: 'Plugins' },
          { id: 'marketplace', label: 'Marketplace' },
          { id: 'assets', label: 'Rules & Skills' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'installed' && <MarketplacePage project={project} installedOnly onBrowse={() => setTab('marketplace')} />}
      {tab === 'marketplace' && <MarketplacePage project={project} />}
      {tab === 'assets' && <AssetsPage project={project} />}
    </div>
  );
}
