import React, { useState } from 'react';
import { Tabs } from '../components/common';
import { MarketplacePage } from './Marketplace';
import { AssetsPage } from './Assets';

/** Plugins hub: the Marketplace and the installed Rules & Skills assets. */
export function PluginsPage(): React.ReactElement {
  const [tab, setTab] = useState('marketplace');
  return (
    <div>
      <Tabs
        tabs={[
          { id: 'marketplace', label: 'Marketplace' },
          { id: 'assets', label: 'Rules & Skills' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'marketplace' ? <MarketplacePage /> : <AssetsPage />}
    </div>
  );
}
