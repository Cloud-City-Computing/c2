/**
 * Cloud Codex - Account Settings Menu Component
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useEffect } from 'react';
import { getSessStorage, getSessionTokenFromCookie, serverReq } from '../util';

export function AccountInfoUpdatePanel() {
  const [fields, setFields] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [status, setStatus] = useState(null); // { type: 'success'|'error', message: string }

  useEffect(() => {
    const loadUser = async () => {
      const userId = getSessStorage('currentUser')?.id;
      const token  = getSessionTokenFromCookie();
      if (!userId || !token) { setStatus({ type: 'error', message: 'Not authenticated. Please log in again.' }); return; }

      const res = await serverReq('POST', '/api/get-user', { token, userId });
      if (res.success) {
        setFields(f => ({ ...f, name: res.user.name ?? '', email: res.user.email ?? '' }));
      } else {
        setStatus({ type: 'error', message: `Error fetching user data: ${res.message}` });
      }
    };
    loadUser();
  }, []);

  const handleChange = (e) => setFields(f => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus(null);

    if (fields.password && fields.password !== fields.confirmPassword) {
      setStatus({ type: 'error', message: 'Passwords do not match.' });
      return;
    }

    const userId = getSessStorage('currentUser')?.id;
    const token  = getSessionTokenFromCookie();
    if (!userId || !token) { setStatus({ type: 'error', message: 'Not authenticated. Please log in again.' }); return; }

    const payload = { token, userId, name: fields.name, email: fields.email };
    // Only send password if the user actually filled it in
    if (fields.password) payload.password = fields.password;

    const res = await serverReq('POST', '/api/update-account', payload);
    setStatus(res.success
      ? { type: 'success', message: 'Account updated successfully.' }
      : { type: 'error',   message: `Error updating account: ${res.message}` }
    );
  };

  return (
    <div className="account-settings-panel">
      <h2 className="panel-title">Update Account Information</h2>
      {status && <p className={`panel-status ${status.type}`}>{status.message}</p>}
      <form className="account-form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="name">Name</label>
          <input id="name" name="name" type="text" value={fields.name} onChange={handleChange} />
        </div>
        <div className="form-group">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" value={fields.email} onChange={handleChange} />
        </div>
        <div className="form-group">
          <label htmlFor="password">New Password</label>
          <input id="password" name="password" type="password" value={fields.password} onChange={handleChange} />
        </div>
        <div className="form-group">
          <label htmlFor="confirmPassword">Confirm New Password</label>
          <input id="confirmPassword" name="confirmPassword" type="password" value={fields.confirmPassword} onChange={handleChange} />
        </div>
        <button type="submit" className="c2-btn stretched-button">Update Info</button>
      </form>
    </div>
  );
}

function AccountPreferencesPanel() {
  return (
    <div className="account-settings-panel">
      <h2 className="panel-title">Account Preferences</h2>
      <form className="account-form">
        <div className="checkbox-group">
          <label><input type="checkbox" name="newsletter" /> Receive Newsletter</label>
        </div>
        <div className="checkbox-group">
          <label><input type="checkbox" name="2fa" /> Enable Two-Factor Authentication</label>
        </div>
        <button type="submit" className="c2-btn stretched-button">Update Preferences</button>
      </form>
    </div>
  );
}

function ManageOrganizationsPanel() {
  return (
    <div className="account-settings-panel">
      <h2 className="panel-title">Manage Organizations</h2>
      <p className="panel-muted">This feature is coming soon. Please check back later.</p>
    </div>
  );
}

const PANELS = [
  { label: 'Change Account Info',    Panel: AccountInfoUpdatePanel    },
  { label: 'Change Preferences',     Panel: AccountPreferencesPanel   },
  { label: 'Manage Organizations',   Panel: ManageOrganizationsPanel  },
];

function AccountMenu({ onPanelChange }) {
  return (
    <div className="account-menu">
      <p>Account Actions</p>
      <ul>
        {PANELS.map(({ label, Panel }) => (
          <li key={label}>
            <a href="#" onClick={(e) => { e.preventDefault(); onPanelChange(<Panel />); }}>
              {label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default AccountMenu;