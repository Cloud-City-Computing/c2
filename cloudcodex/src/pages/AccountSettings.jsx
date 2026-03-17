import StdLayout from '../page_layouts/Std_Layout';
import { AccountInfoUpdatePanel, AccountPreferencesPanel } from '../components/AccountMenu';

function AccountSettings() {
  return (
    <StdLayout>
      <div className="account-page">
        <h1 className="page-heading">Account Management</h1>
        <div className="account-page__panels">
          <AccountInfoUpdatePanel />
          <AccountPreferencesPanel />
        </div>
      </div>
    </StdLayout>
  );
}

export default AccountSettings;