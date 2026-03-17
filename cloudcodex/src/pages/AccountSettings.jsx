/**
 * Cloud Codex - Account Settings Page
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import StdLayout from '../page_layouts/Std_Layout';
import { AccountInfoUpdatePanel, AccountPreferencesPanel, PersonalPermissionsPanel } from '../components/AccountMenu';

function AccountSettings() {
  return (
    <StdLayout>
      <div className="account-page">
        <h1 className="page-heading">Account</h1>
        <div className="account-page__panels">
          <AccountInfoUpdatePanel />
          <AccountPreferencesPanel />
          <PersonalPermissionsPanel />
        </div>
      </div>
    </StdLayout>
  );
}

export default AccountSettings;