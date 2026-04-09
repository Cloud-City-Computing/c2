/**
 * Cloud Codex - Account Settings Log
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import StdLayout from '../page_layouts/Std_Layout';
import { AvatarUploadPanel, AccountInfoUpdatePanel, AccountPreferencesPanel, UserPreferencesPanel, LinkedAccountsPanel } from '../components/AccountMenu';

function AccountSettings() {
  return (
    <StdLayout>
      <div className="account-log">
        <h1 className="log-heading">Account</h1>
        <div className="account-log__panels">
          <AvatarUploadPanel />
          <AccountInfoUpdatePanel />
          <LinkedAccountsPanel />
          <UserPreferencesPanel />
          <AccountPreferencesPanel />
        </div>
      </div>
    </StdLayout>
  );
}

export default AccountSettings;