import React, { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Tabs } from '../components/common';
import { SettingsPage } from './Settings';
import { ModelsPage } from './Models';
import { SpendingPage } from './Spending';

/** Settings hub: provider/host configuration plus model tier preferences. */
export function SettingsArea({ onBack }: { onBack?: () => void }): React.ReactElement {
  const [tab, setTab] = useState('general');
  return (
    <div className="mx-auto w-full max-w-3xl">
      {onBack && (
        <button
          onClick={onBack}
          className="mb-4 -ml-1 flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-text"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={2} />
          Back to app
        </button>
      )}
      <Tabs
        tabs={[
          { id: 'general', label: 'General' },
          { id: 'models', label: 'Models' },
          { id: 'spending', label: 'Spending' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'general' ? <SettingsPage /> : tab === 'models' ? <ModelsPage /> : <SpendingPage />}
    </div>
  );
}
