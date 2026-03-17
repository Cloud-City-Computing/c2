import { useState } from 'react';
import StdLayout from '../page_layouts/Std_Layout';
import AccountMenu, { AccountInfoUpdatePanel } from '../components/AccountMenu';

function AccountSettings() {
  const [activePanel, setActivePanel] = useState(<AccountInfoUpdatePanel />);

  return (
    <StdLayout leftMargin={<AccountMenu onPanelChange={setActivePanel} />}>
      {activePanel}
    </StdLayout>
  );
}

export default AccountSettings;