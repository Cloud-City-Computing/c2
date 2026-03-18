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
  const [fields, setFields] = useState({ name: '', email: '' });
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

    const userId = getSessStorage('currentUser')?.id;
    if (!userId) { setStatus({ type: 'error', message: 'Not authenticated.' }); return; }

    try {
      await apiFetch('POST', '/api/update-account', { userId, name: fields.name, email: fields.email });
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
        <p className="text-muted text-sm">To change your password, use the "Forgot Password?" link on the login screen.</p>
        <button type="submit" className="btn btn-primary stretched-button">Update Info</button>
      </form>
    </div>
  );
}

export function AccountPreferencesPanel() {
  const [method, setMethod] = useState('none'); // 'none' | 'email' | 'totp'
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [totpSetup, setTotpSetup] = useState(null); // { setupToken } when awaiting TOTP confirmation
  const [totpCode, setTotpCode] = useState('');
  const [disableConfirm, setDisableConfirm] = useState(null); // { confirmToken } when awaiting disable confirmation
  const [disableCode, setDisableCode] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('GET', '/api/2fa/status');
        if (res.success) setMethod(res.method ?? 'none');
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, []);

  const handleDisable = async () => {
    setStatus(null);
    setTotpSetup(null);
    if (method === 'none') return;
    try {
      const res = await apiFetch('POST', '/api/2fa/disable');
      if (res.confirmToken) {
        setDisableConfirm({ confirmToken: res.confirmToken });
        setDisableCode('');
        setStatus({ type: 'success', message: res.message });
      } else {
        setMethod('none');
        setStatus({ type: 'success', message: res.message });
      }
    } catch (e) {
      setStatus({ type: 'error', message: e.body?.message ?? 'Error disabling 2FA.' });
    }
  };

  const handleConfirmDisable = async () => {
    setStatus(null);
    if (!disableCode || disableCode.length !== 6) {
      setStatus({ type: 'error', message: 'Please enter the 6-digit code sent to your email.' });
      return;
    }
    try {
      const res = await apiFetch('POST', '/api/2fa/disable/confirm', {
        confirmToken: disableConfirm.confirmToken,
        code: disableCode,
      });
      setMethod('none');
      setDisableConfirm(null);
      setDisableCode('');
      setStatus({ type: 'success', message: res.message });
    } catch (e) {
      setStatus({ type: 'error', message: e.body?.message ?? 'Invalid code.' });
    }
  };

  const handleEnableEmail = async () => {
    setStatus(null);
    setTotpSetup(null);
    try {
      const res = await apiFetch('POST', '/api/2fa/enable', { method: 'email' });
      setMethod('email');
      setStatus({ type: 'success', message: res.message });
    } catch (e) {
      setStatus({ type: 'error', message: e.body?.message ?? 'Error enabling email 2FA.' });
    }
  };

  const handleEnableTotp = async () => {
    setStatus(null);
    setTotpSetup(null);
    setTotpCode('');
    try {
      const res = await apiFetch('POST', '/api/2fa/enable', { method: 'totp' });
      setTotpSetup({ setupToken: res.setupToken });
      setStatus({ type: 'success', message: res.message });
    } catch (e) {
      setStatus({ type: 'error', message: e.body?.message ?? 'Error starting authenticator setup.' });
    }
  };

  const handleConfirmTotp = async () => {
    setStatus(null);
    if (!totpCode || totpCode.length !== 6) {
      setStatus({ type: 'error', message: 'Please enter the 6-digit code from your authenticator app.' });
      return;
    }
    try {
      const res = await apiFetch('POST', '/api/2fa/totp/confirm', { setupToken: totpSetup.setupToken, code: totpCode });
      setMethod('totp');
      setTotpSetup(null);
      setTotpCode('');
      setStatus({ type: 'success', message: res.message });
    } catch (e) {
      setStatus({ type: 'error', message: e.body?.message ?? 'Invalid code.' });
    }
  };

  if (loading) return <div className="settings-panel"><p className="text-muted">Loading...</p></div>;

  return (
    <div className="settings-panel">
      <h2 className="panel-title">Two-Factor Authentication</h2>
      {status && <p className={`panel-status ${status.type}`}>{status.message}</p>}

      <div className="tfa-method-options">
        <label className={`tfa-method-option${method === 'none' ? ' active' : ''}`}>
          <input type="radio" name="2fa-method" checked={method === 'none' && !totpSetup} onChange={handleDisable} />
          <div>
            <strong>Disabled</strong>
            <p className="text-muted text-sm">No two-factor authentication required at login.</p>
          </div>
        </label>

        <label className={`tfa-method-option${method === 'email' ? ' active' : ''}`}>
          <input type="radio" name="2fa-method" checked={method === 'email'} onChange={handleEnableEmail} />
          <div>
            <strong>Email Verification</strong>
            <p className="text-muted text-sm">A 6-digit code is sent to your email each time you log in.</p>
          </div>
        </label>

        <label className={`tfa-method-option${method === 'totp' ? ' active' : ''}`}>
          <input type="radio" name="2fa-method" checked={method === 'totp' && !totpSetup} onChange={handleEnableTotp} />
          <div>
            <strong>Authenticator App</strong>
            <p className="text-muted text-sm">Use an app like Google Authenticator or Authy to generate codes.</p>
          </div>
        </label>
      </div>

      {totpSetup && (
        <div className="totp-confirm-section">
          <p className="text-sm">Check your email for the QR code. Scan it with your authenticator app, then enter the code below:</p>
          <div className="totp-confirm-form">
            <input
              type="text"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => e.key === 'Enter' && handleConfirmTotp()}
              placeholder="000000"
              maxLength={6}
              inputMode="numeric"
              className="totp-code-input"
            />
            <button className="btn btn-primary" onClick={handleConfirmTotp}>Confirm</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setTotpSetup(null); setStatus(null); }}>Cancel</button>
          </div>
        </div>
      )}

      {disableConfirm && (
        <div className="totp-confirm-section" style={{ borderColor: 'var(--color-danger)' }}>
          <p className="text-sm">Enter the verification code sent to your email to confirm disabling 2FA:</p>
          <div className="totp-confirm-form">
            <input
              type="text"
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => e.key === 'Enter' && handleConfirmDisable()}
              placeholder="000000"
              maxLength={6}
              inputMode="numeric"
              className="totp-code-input"
            />
            <button className="btn btn-danger" onClick={handleConfirmDisable}>Disable 2FA</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setDisableConfirm(null); setDisableCode(''); setStatus(null); }}>Cancel</button>
          </div>
        </div>
      )}
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