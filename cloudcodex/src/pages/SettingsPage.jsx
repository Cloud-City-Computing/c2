import { useState } from 'react';
import StdLayout from '../page_layouts/Std_Layout';
import SettingsMenu from '../components/AccountMenu';

export default function SettingsPage() {
  const [activePanel, setActivePanel] = useState(null);

  return (
    <StdLayout>
      <div className="settings-layout">
        <SettingsMenu onPanelChange={setActivePanel} />
        <div className="settings-layout__content">
          {activePanel}
        </div>
      </div>
    </StdLayout>
  );
}
