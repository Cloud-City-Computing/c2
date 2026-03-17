/**
 * Cloud Codex - Account Panels
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useEffect } from 'react';
import {
  getSessStorage, apiFetch, getSessionTokenFromCookie,
  fetchPermissions, updatePermissions,
} from '../util';

// ===========================
//  Account Panels (used by AccountSettings page)
// ===========================

export function AccountInfoUpdatePanel() {
  const [fields, setFields] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [status, setStatus] = useState(null);

  useEffect(() => {
    const loadUser = async () => {
      const userId = getSessStorage('currentUser')?.id;
      if (!userId) { setStatus({ type: 'error', message: 'Not authenticated.' }); return; }
      try {
        const res = await apiFetch('POST', '/api/get-user', { userId, token: getSessionTokenFromCookie() });
        if (res.success) {
          setFields(f => ({ ...f, name: res.user.name ?? '', email: res.user.email ?? '' }));
        }
      } catch (e) {
        setStatus({ type: 'error', message: `Error fetching user data: ${e.body?.message ?? e.message}` });
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
    if (!userId) { setStatus({ type: 'error', message: 'Not authenticated.' }); return; }

    const payload = { userId, name: fields.name, email: fields.email };
    if (fields.password) payload.password = fields.password;

    try {
      await apiFetch('POST', '/api/update-account', payload);
      setStatus({ type: 'success', message: 'Account updated successfully.' });
    } catch (e) {
      setStatus({ type: 'error', message: `Error updating account: ${e.body?.message ?? e.message}` });
    }
  };

  return (
    <div className="settings-panel">
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
        <button type="submit" className="btn btn-primary stretched-button">Update Info</button>
      </form>
    </div>
  );
}

export function AccountPreferencesPanel() {
  return (
    <div className="settings-panel">
      <h2 className="panel-title">Account Preferences</h2>
      <form className="account-form">
        <div className="checkbox-group">
          <label><input type="checkbox" name="newsletter" /> Receive Newsletter</label>
        </div>
        <div className="checkbox-group">
          <label><input type="checkbox" name="2fa" /> Enable Two-Factor Authentication</label>
        </div>
        <button type="submit" className="btn btn-primary stretched-button">Update Preferences</button>
      </form>
    </div>
  );
}

// ===========================
//  Personal Permissions Panel (for Account page)
// ===========================

function PermissionToggles({ perms, fields, onToggle }) {
  const labels = {
    create_team:    { title: 'Create Teams',    desc: 'Create teams within organizations' },
    create_project: { title: 'Create Projects', desc: 'Create new projects' },
    create_page:    { title: 'Create Pages',    desc: 'Create pages within projects' },
  };

  return (
    <div className="permissions-grid">
      {fields.map(key => (
        <label key={key} className="permission-toggle">
          <input type="checkbox" checked={!!perms[key]} onChange={() => onToggle(key)} />
          <div>
            <strong>{labels[key].title}</strong>
            <p className="text-muted text-sm">{labels[key].desc}</p>
          </div>
        </label>
      ))}
    </div>
  );
}

export function PersonalPermissionsPanel() {
  const [myPerms, setMyPerms] = useState({ create_team: false, create_project: false, create_page: true });
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchPermissions();
        if (res.permissions) setMyPerms(res.permissions);
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, []);

  const handleToggle = async (key) => {
    const prev = { ...myPerms };
    const updated = { ...myPerms, [key]: !myPerms[key] };
    setMyPerms(updated);
    setStatus(null);
    const userId = getSessStorage('currentUser')?.id;
    if (!userId) return;
    try {
      await updatePermissions(userId, updated);
      setStatus({ type: 'success', message: 'Permissions updated.' });
    } catch (e) {
      setMyPerms(prev);
      setStatus({ type: 'error', message: e.body?.message ?? 'Error updating permissions.' });
    }
  };

  if (loading) return <p className="text-muted">Loading...</p>;

  return (
    <div className="settings-panel">
      <h2 className="panel-title">Permissions</h2>
      <p className="text-muted text-sm">Controls what you can do across the application.</p>
      {status && <p className={`panel-status ${status.type}`}>{status.message}</p>}
      <PermissionToggles perms={myPerms} fields={['create_team', 'create_project', 'create_page']} onToggle={handleToggle} />
    </div>
  );
}