/**
 * Cloud Codex - Account Panels
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useEffect, useRef } from 'react';
import {
  getSessStorage, apiFetch, getSessionTokenFromCookie,
} from '../util';
import { applyPrefsToDOM, loadUserPrefs, saveUserPrefs, ACCENT_COLORS, FONT_SIZES, DENSITIES } from '../userPrefs';

// ===========================
//  Account Panels (used by AccountSettings log)
// ===========================

export function AvatarUploadPanel() {
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState(null);
  const fileInputRef = useRef(null);

  const userId = getSessStorage('currentUser')?.id;

  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        const res = await apiFetch('POST', '/api/get-user', { userId, token: getSessionTokenFromCookie() });
        if (res.success && res.user.avatar_url) {
          setAvatarUrl(res.user.avatar_url);
        }
      } catch { /* ignore */ }
    })();
  }, [userId]);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !userId) return;

    // Client-side validation
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.type)) {
      setStatus({ type: 'error', message: 'Unsupported format. Use JPEG, PNG, WebP, or GIF.' });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setStatus({ type: 'error', message: 'Image too large. Maximum size is 5 MB.' });
      return;
    }

    setUploading(true);
    setStatus(null);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const token = getSessionTokenFromCookie();
      const response = await fetch(`/api/users/${userId}/avatar`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Upload failed');

      // Cache-bust: append timestamp
      setAvatarUrl(data.avatar_url + '?t=' + Date.now());
      setStatus({ type: 'success', message: 'Profile picture updated.' });

      // Update cached user
      const cached = getSessStorage('currentUser');
      if (cached) {
        cached.avatar_url = data.avatar_url;
        sessionStorage.setItem('c2-currentUser', JSON.stringify(cached));
      }
    } catch (err) {
      setStatus({ type: 'error', message: err.message || 'Upload failed.' });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemove = async () => {
    if (!userId) return;
    setStatus(null);
    try {
      await apiFetch('DELETE', `/api/users/${userId}/avatar`);
      setAvatarUrl(null);
      setStatus({ type: 'success', message: 'Profile picture removed.' });

      const cached = getSessStorage('currentUser');
      if (cached) {
        cached.avatar_url = null;
        sessionStorage.setItem('c2-currentUser', JSON.stringify(cached));
      }
    } catch (err) {
      setStatus({ type: 'error', message: err.body?.message ?? err.message ?? 'Remove failed.' });
    }
  };

  const userName = getSessStorage('currentUser')?.name || '';

  return (
    <div className="settings-panel">
      <h2 className="panel-title">Profile Picture</h2>
      {status && <p className={`panel-status ${status.type}`}>{status.message}</p>}
      <div className="avatar-upload">
        <div className="avatar-upload__preview">
          {avatarUrl ? (
            <img src={avatarUrl} alt="Profile" className="avatar-upload__img" />
          ) : (
            <span className="avatar-upload__placeholder">
              {userName.charAt(0)?.toUpperCase() || '?'}
            </span>
          )}
        </div>
        <div className="avatar-upload__actions">
          <label className={`btn btn-primary btn-sm${uploading ? ' disabled' : ''}`}>
            {uploading ? 'Uploading...' : 'Upload Image'}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={handleUpload}
              disabled={uploading}
              hidden
            />
          </label>
          {avatarUrl && (
            <button className="btn btn-ghost btn-sm" onClick={handleRemove}>
              Remove
            </button>
          )}
          <p className="text-muted text-sm">JPEG, PNG, WebP, or GIF. Max 5 MB. Resized to 256×256.</p>
        </div>
      </div>
    </div>
  );
}

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
//  User Preferences Panel
// ===========================

const COLOR_LABELS = {
  blue: 'Ocean Blue', violet: 'Soft Violet', emerald: 'Emerald', rose: 'Rose',
  amber: 'Amber', cyan: 'Cyan', pink: 'Fuchsia', lime: 'Lime',
};
const ACCENT_COLOR_LIST = Object.entries(ACCENT_COLORS).map(([id, c]) => ({ id, label: COLOR_LABELS[id], ...c }));

const FONT_SIZE_OPTIONS = Object.entries(FONT_SIZES).map(([id, value]) => ({
  id, value, label: id === 'sm' ? 'Small' : id === 'md' ? 'Medium' : 'Large',
}));

const DENSITY_OPTIONS = Object.entries(DENSITIES).map(([id, padScale]) => ({
  id, padScale, label: id === 'compact' ? 'Compact' : id === 'comfortable' ? 'Comfortable' : 'Spacious',
}));

const EDITOR_MODE_OPTIONS = [
  { id: 'richtext', label: 'Rich Text' },
  { id: 'markdown', label: 'Markdown' },
];

export function UserPreferencesPanel() {
  const [prefs, setPrefs] = useState(() => {
    const saved = loadUserPrefs();
    return {
      accentColor: saved.accentColor || 'blue',
      fontSize: saved.fontSize || 'md',
      density: saved.density || 'comfortable',
      sidebarDefault: saved.sidebarDefault || 'expanded',
      preferredEditor: saved.preferredEditor === 'markdown' ? 'markdown' : 'richtext',
    };
  });

  const update = (key, value) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    saveUserPrefs(next);
    applyPrefsToDOM(next);
  };

  return (
    <div className="settings-panel">
      <h2 className="panel-title">Appearance</h2>

      {/* Accent Color */}
      <div className="pref-section">
        <h3 className="pref-section__title">Accent Color</h3>
        <p className="text-muted text-sm">Personalize the interface with your favorite color.</p>
        <div className="color-swatch-row">
          {ACCENT_COLOR_LIST.map(c => (
            <button
              key={c.id}
              className={`color-swatch${prefs.accentColor === c.id ? ' active' : ''}`}
              style={{ '--swatch-color': c.value }}
              onClick={() => update('accentColor', c.id)}
              title={c.label}
              aria-label={c.label}
            >
              {prefs.accentColor === c.id && (
                <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Editor Font Size */}
      <div className="pref-section">
        <h3 className="pref-section__title">Editor Font Size</h3>
        <div className="pref-toggle-group">
          {FONT_SIZE_OPTIONS.map(f => (
            <button
              key={f.id}
              className={`pref-toggle-btn${prefs.fontSize === f.id ? ' active' : ''}`}
              onClick={() => update('fontSize', f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* UI Density */}
      <div className="pref-section">
        <h3 className="pref-section__title">UI Density</h3>
        <div className="pref-toggle-group">
          {DENSITY_OPTIONS.map(d => (
            <button
              key={d.id}
              className={`pref-toggle-btn${prefs.density === d.id ? ' active' : ''}`}
              onClick={() => update('density', d.id)}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {/* Sidebar Default */}
      <div className="pref-section">
        <h3 className="pref-section__title">Sidebar Default</h3>
        <p className="text-muted text-sm">Choose how the sidebar appears when you load the app.</p>
        <div className="pref-toggle-group">
          <button
            className={`pref-toggle-btn${prefs.sidebarDefault === 'expanded' ? ' active' : ''}`}
            onClick={() => update('sidebarDefault', 'expanded')}
          >
            Expanded
          </button>
          <button
            className={`pref-toggle-btn${prefs.sidebarDefault === 'collapsed' ? ' active' : ''}`}
            onClick={() => update('sidebarDefault', 'collapsed')}
          >
            Collapsed
          </button>
        </div>
      </div>

      <div className="pref-section">
        <h3 className="pref-section__title">Preferred Editor</h3>
        <p className="text-muted text-sm">Choose which editor opens by default when you load a log.</p>
        <div className="pref-toggle-group">
          {EDITOR_MODE_OPTIONS.map(mode => (
            <button
              key={mode.id}
              className={`pref-toggle-btn${prefs.preferredEditor === mode.id ? ' active' : ''}`}
              onClick={() => update('preferredEditor', mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ===========================
//  Linked Accounts Panel (OAuth / SSO)
// ===========================

export function LinkedAccountsPanel() {
  const [accounts, setAccounts] = useState([]);
  const [hasPassword, setHasPassword] = useState(true);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [providers, setProviders] = useState({});

  useEffect(() => {
    Promise.all([
      apiFetch('GET', '/api/oauth/status').catch(() => ({ accounts: [], hasPassword: true })),
      fetch('/api/oauth/providers').then(r => r.json()).catch(() => ({ providers: {} })),
    ]).then(([oauthRes, provRes]) => {
      setAccounts(oauthRes.accounts || []);
      setHasPassword(oauthRes.hasPassword !== false);
      setProviders(provRes.providers || {});
      setLoading(false);
    });
  }, []);

  const handleLinkGoogle = () => {
    window.location.href = '/api/oauth/google';
  };

  const handleUnlinkGoogle = async () => {
    setStatus(null);
    try {
      const res = await apiFetch('POST', '/api/oauth/google/unlink');
      setAccounts(a => a.filter(acc => acc.provider !== 'google'));
      setStatus({ type: 'success', message: res.message });
    } catch (e) {
      setStatus({ type: 'error', message: e.body?.message ?? 'Failed to unlink account.' });
    }
  };

  const handleLinkGitHub = () => {
    window.location.href = '/api/oauth/github';
  };

  const handleUnlinkGitHub = async () => {
    setStatus(null);
    try {
      const res = await apiFetch('POST', '/api/oauth/github/unlink');
      setAccounts(a => a.filter(acc => acc.provider !== 'github'));
      setStatus({ type: 'success', message: res.message });
    } catch (e) {
      setStatus({ type: 'error', message: e.body?.message ?? 'Failed to unlink account.' });
    }
  };

  if (loading) return <div className="settings-panel"><p className="text-muted">Loading...</p></div>;

  // Only show if at least one provider is configured
  if (!providers.google && !providers.github) return null;

  const googleAccount = accounts.find(a => a.provider === 'google');
  const githubAccount = accounts.find(a => a.provider === 'github');

  return (
    <div className="settings-panel">
      <h2 className="panel-title">Linked Accounts</h2>
      {status && <p className={`panel-status ${status.type}`}>{status.message}</p>}

      <div className="linked-accounts-list">
        {providers.google && (
        <div className="linked-account-row">
          <div className="linked-account-info">
            <svg viewBox="0 0 24 24" width="20" height="20" style={{ flexShrink: 0 }}>
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            <div>
              <strong>Google</strong>
              {googleAccount && (
                <p className="text-muted text-sm">{googleAccount.provider_email}</p>
              )}
            </div>
          </div>
          <div className="linked-account-action">
            {googleAccount ? (
              <button
                className="btn btn-ghost btn-sm"
                onClick={handleUnlinkGoogle}
                disabled={!hasPassword}
                title={!hasPassword ? 'Set a password before unlinking' : 'Unlink Google account'}
              >
                Unlink
              </button>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={handleLinkGoogle}>
                Link Account
              </button>
            )}
          </div>
        </div>
        )}
        {providers.github && (
        <>
        <div className="linked-account-row">
          <div className="linked-account-info">
            {githubAccount?.provider_avatar_url ? (
              <img
                src={githubAccount.provider_avatar_url}
                alt=""
                width="20"
                height="20"
                style={{ flexShrink: 0, borderRadius: '50%' }}
              />
            ) : (
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" style={{ flexShrink: 0 }}>
                <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
              </svg>
            )}
            <div>
              <strong>GitHub</strong>
              {githubAccount && (
                <p className="text-muted text-sm">
                  {githubAccount.provider_username
                    ? `@${githubAccount.provider_username}`
                    : githubAccount.provider_email}
                </p>
              )}
            </div>
          </div>
          <div className="linked-account-action">
            {githubAccount ? (
              <button
                className="btn btn-ghost btn-sm"
                onClick={handleUnlinkGitHub}
                disabled={!hasPassword && accounts.length <= 1}
                title={!hasPassword && accounts.length <= 1 ? 'Set a password before unlinking' : 'Unlink GitHub account'}
              >
                Unlink
              </button>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={handleLinkGitHub}>
                Link Account
              </button>
            )}
          </div>
        </div>
        {githubAccount?.token_status === 'revoked' && (
          <div className="gh-reconnect-banner" role="alert">
            <span aria-hidden>⚠</span>
            <span style={{ flex: 1 }}>
              GitHub revoked your access. Reconnect to keep linked documents in sync.
            </span>
            <button className="btn btn-primary btn-sm" onClick={handleLinkGitHub}>
              Reconnect
            </button>
          </div>
        )}
        </>
        )}
        {(googleAccount || githubAccount) && !hasPassword && (
          <p className="text-muted text-sm" style={{ marginTop: 8 }}>
            Set a password in Account Info above before unlinking your linked accounts.
          </p>
        )}
      </div>
    </div>
  );
}