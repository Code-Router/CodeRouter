import React, { useState } from 'react';
import { Tabs } from '../components/common';
import { SettingsPage } from './Settings';
import { ModelsPage } from './Models';

/** Settings hub: provider/host configuration plus model tier preferences. */
export function SettingsArea(): React.ReactElement {
  const [tab, setTab] = useState('general');
  return (
    <div>
      <Tabs
        tabs={[
          { id: 'general', label: 'General' },
          { id: 'models', label: 'Models' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'general' ? <SettingsPage /> : <ModelsPage />}
    </div>
  );
}
