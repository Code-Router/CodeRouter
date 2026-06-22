import React, { useState } from 'react';
import { Tabs } from '../components/common';
import { OverviewPage } from './Overview';
import { UsagePage } from './Usage';

/** Insights hub: at-a-glance overview plus the detailed usage breakdown. */
export function OverviewArea(): React.ReactElement {
  const [tab, setTab] = useState('overview');
  return (
    <div>
      <Tabs
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'usage', label: 'Usage' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'overview' ? <OverviewPage /> : <UsagePage />}
    </div>
  );
}
