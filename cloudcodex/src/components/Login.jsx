/**
 * Cloud Codex - Login Component
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { destroyModal, serverReq, showModal, validateInviteToken } from '../util';
import WelcomeSetup from './WelcomeSetup';

/* ─── Password rules (mirrored from server) ─── */
const PASSWORD_RULES = [
  { key: 'length',  label: 'At least 8 characters',            test: (p) => p.length >= 8 },
  { key: 'upper',   label: 'One uppercase letter',             test: (p) => /[A-Z]/.test(p) },
  { key: 'lower',   label: 'One lowercase letter',             test: (p) => /[a-z]/.test(p) },
  { key: 'number',  label: 'One number',                       test: (p) => /[0-9]/.test(p) },
  { key: 'special', label: 'One special character (!@#$…)',     test: (p) => /[^A-Za-z0-9]/.test(p) },
];

function getPasswordStrength(password) {
  if (!password) return { score: 0, label: '', color: '' };
  const passed = PASSWORD_RULES.filter(r => r.test(password)).length;
  if (passed <= 1) return { score: 1, label: 'Weak', color: 'var(--color-danger)' };
  if (passed <= 2) return { score: 2, label: 'Fair', color: '#f0a030' };
  if (passed <= 3) return { score: 3, label: 'Good', color: '#e0c020' };
  if (passed <= 4) return { score: 4, label: 'Strong', color: '#6cbf6c' };
  return { score: 5, label: 'Excellent', color: '#4caf50' };
}

const isValidUsername = (name) => /^[a-zA-Z0-9_]{3,32}$/.test(name);
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export default function Login({ inviteToken: propInviteToken, inviteEmail: propInviteEmail }) {
  const [tab, setTab] = useState(propInviteToken ? 'signup' : 'login'); // 'login' | 'signup' | 'forgot' | '2fa'
  const [fields, setFields] = useState({
    username: '', email: propInviteEmail || '', confirmEmail: propInviteEmail || '', password: '', confirmPassword: '', code: ''
  });
  const [inviteToken] = useState(propInviteToken || null);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [twoFactorToken, setTwoFactorToken] = useState(null);
  const [twoFactorMethod, setTwoFactorMethod] = useState(null); // 'email' | 'totp'
  const [oauthProviders, setOauthProviders] = useState({});

  // Signup-specific validation state
  const [usernameStatus, setUsernameStatus] = useState(null); // null | 'checking' | 'available' | 'taken' | 'invalid'
  const [usernameMsg, setUsernameMsg] = useState('');
  const [showPasswordRules, setShowPasswordRules] = useState(false);
  const usernameTimer = useRef(null);

  // Check which OAuth providers are available
  useEffect(() => {
    fetch('/api/oauth/providers')
      .then(r => r.json())
      .then(data => { if (data.success) setOauthProviders(data.providers || {}); })
      .catch(() => {});
  }, []);

  const handleChange = (e) => setFields(f => ({ ...f, [e.target.name]: e.target.value }));

  const switchTab = (t) => {
    setTab(t); setError(null); setInfo(null);
    setUsernameStatus(null); setUsernameMsg('');
  };

  /* ─── Username availability (debounced) ─── */
  const checkUsername = useCallback((name) => {
    clearTimeout(usernameTimer.current);
    if (!name) { setUsernameStatus(null); setUsernameMsg(''); return; }
    if (!isValidUsername(name)) {
      setUsernameStatus('invalid');
      setUsernameMsg('Letters, numbers, and underscores only (3-32 chars)');
      return;
    }
    setUsernameStatus('checking');
    setUsernameMsg('Checking…');
    usernameTimer.current = setTimeout(async () => {
      try {
        const resp = await fetch(`/api/check-username/${encodeURIComponent(name)}`);
        const res = await resp.json();
        setUsernameStatus(res.available ? 'available' : 'taken');
        setUsernameMsg(res.message);
      } catch {
        setUsernameStatus(null);
        setUsernameMsg('');
      }
    }, 400);
  }, []);

  const handleUsernameChange = (e) => {
    // Strip spaces as-you-type
    const val = e.target.value.replace(/\s/g, '');
    setFields(f => ({ ...f, username: val }));
    if (tab === 'signup') checkUsername(val);
  };

  const handleLogin = async () => {
    setError(null);
    const res = await serverReq('POST', '/api/login', { username: fields.username, password: fields.password });
    if (res.success && res.requires_2fa) {
      setTwoFactorToken(res.twoFactorToken);
      setTwoFactorMethod(res.method);
      setFields(f => ({ ...f, code: '' }));
      setTab('2fa');
      setInfo(res.method === 'email'
        ? 'A verification code has been sent to your email.'
        : 'Enter the code from your authenticator app.'
      );
      return;
    }
    if (res.success) {
      document.cookie = `sessionToken=${res.token}; path=/; max-age=${7 * 24 * 60 * 60}; secure; samesite=strict`;
      window.location.reload();
    } else {
      setError(res.message ?? 'Login failed.');
    }
  };

  const handleVerify2FA = async () => {
    setError(null);
    setInfo(null);
    if (!fields.code || fields.code.length !== 6) {
      setError('Please enter the 6-digit code.');
      return;
    }
    try {
      const res = await serverReq('POST', '/api/2fa/verify', { twoFactorToken, code: fields.code });
      if (res.success) {
        document.cookie = `sessionToken=${res.token}; path=/; max-age=${7 * 24 * 60 * 60}; secure; samesite=strict`;
        window.location.reload();
      } else {
        setError(res.message ?? 'Verification failed.');
      }
    } catch {
      setError('Invalid or expired verification code.');
    }
  };

  const handleSignup = async () => {
    setError(null);
    if (!fields.username || !fields.email || !fields.password) {
      setError('All fields are required.'); return;
    }
    if (!inviteToken) {
      setError('An invitation is required to create an account. Contact your administrator.'); return;
    }
    if (!isValidUsername(fields.username)) {
      setError('Username must be 3-32 characters: letters, numbers, and underscores only.'); return;
    }
    if (usernameStatus === 'taken') {
      setError('That username is already taken.'); return;
    }
    if (!isValidEmail(fields.email)) {
      setError('Please enter a valid email address.'); return;
    }
    if (fields.email !== fields.confirmEmail) {
      setError('Email addresses do not match.'); return;
    }
    const passwordFailures = PASSWORD_RULES.filter(r => !r.test(fields.password));
    if (passwordFailures.length > 0) {
      setError('Password does not meet all requirements.'); return;
    }
    if (fields.password !== fields.confirmPassword) {
      setError('Passwords do not match.'); return;
    }
    let res;
    try {
      const resp = await fetch('/api/create-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: fields.username, email: fields.email, password: fields.password, inviteToken })
      });
      res = await resp.json();
    } catch {
      setError('Network error. Please try again.');
      return;
    }
    if (res.success) {
      document.cookie = `sessionToken=${res.token}; path=/; max-age=${7 * 24 * 60 * 60}; secure; samesite=strict`;
      destroyModal();
      showModal(<WelcomeSetup onComplete={() => window.location.reload()} />);
    } else {
      setError(res.message ?? 'Error creating account.');
    }
  };

  const handleForgotPassword = async () => {
    setError(null);
    setInfo(null);
    if (!fields.email) { setError('Please enter your email address.'); return; }
    const res = await serverReq('POST', '/api/forgot-password', { email: fields.email });
    if (res.success) {
      setInfo(res.message);
    } else {
      setError(res.message ?? 'Something went wrong.');
    }
  };

  const handleSubmit = tab === 'forgot' ? handleForgotPassword : tab === '2fa' ? handleVerify2FA : tab === 'login' ? handleLogin : handleSignup;

  return (
    <div className="modal-content">
      <span className="close-button" onClick={destroyModal}>&times;</span>
      {tab === '2fa' ? (
        <>
          <h2 className="forgot-password-title">Two-Factor Verification</h2>
          {error && <p className="form-error">{error}</p>}
          {info && <p className="form-success">{info}</p>}
          <div className="modal-form">
            <label htmlFor="code">
              {twoFactorMethod === 'totp'
                ? 'Enter the 6-digit code from your authenticator app:'
                : 'Enter the 6-digit code sent to your email:'}
            </label>
            <input
              type="text"
              id="code"
              name="code"
              value={fields.code}
              onChange={handleChange}
              onKeyDown={(e) => e.key === 'Enter' && handleVerify2FA()}
              maxLength={6}
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]*"
              style={{ textAlign: 'center', fontSize: '24px', letterSpacing: '6px' }}
            />
            <button className="btn btn-primary stretched-button" onClick={handleVerify2FA}>
              Verify
            </button>
            <button className="btn btn-ghost btn-sm forgot-password-link" onClick={() => switchTab('login')}>
              Back to Login
            </button>
          </div>
        </>
      ) : tab !== 'forgot' ? (
        <>
          <div className="login-tabs">
            <button className={`login-tab ${tab === 'login' ? 'active' : ''}`} onClick={() => switchTab('login')}>Login</button>
            {inviteToken && (
              <button className={`login-tab ${tab === 'signup' ? 'active' : ''}`} onClick={() => switchTab('signup')}>Sign Up</button>
            )}
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-form">
            <label htmlFor="username">Username:</label>
            <div className="input-with-status">
              <input type="text" id="username" name="username" value={fields.username}
                onChange={handleUsernameChange}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                maxLength={32}
                autoComplete={tab === 'signup' ? 'off' : 'username'}
                className={tab === 'signup' && usernameStatus ? `input--${usernameStatus}` : ''} />
              {tab === 'signup' && usernameStatus && (
                <span className={`input-hint input-hint--${usernameStatus}`}>
                  {usernameStatus === 'checking' && '⏳ '}
                  {usernameStatus === 'available' && '✓ '}
                  {usernameStatus === 'taken' && '✗ '}
                  {usernameStatus === 'invalid' && '✗ '}
                  {usernameMsg}
                </span>
              )}
            </div>
            {tab === 'signup' && (
              <>
                <label htmlFor="email">Email:</label>
                <input type="email" id="email" name="email" value={fields.email} onChange={handleChange}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                  readOnly={!!inviteToken}
                  className={fields.email && !isValidEmail(fields.email) ? 'input--invalid' : fields.email ? 'input--available' : ''} />
                {fields.email && !isValidEmail(fields.email) && (
                  <span className="input-hint input-hint--invalid">Please enter a valid email</span>
                )}

                <label htmlFor="confirmEmail">Confirm Email:</label>
                <input type="email" id="confirmEmail" name="confirmEmail" value={fields.confirmEmail} onChange={handleChange}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                  className={fields.confirmEmail ? (fields.confirmEmail === fields.email ? 'input--available' : 'input--taken') : ''} />
                {fields.confirmEmail && fields.confirmEmail !== fields.email && (
                  <span className="input-hint input-hint--taken">Emails do not match</span>
                )}
              </>
            )}
            <label htmlFor="password">Password:</label>
            <input type="password" id="password" name="password" value={fields.password}
              onChange={handleChange}
              onFocus={() => tab === 'signup' && setShowPasswordRules(true)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()} />

            {tab === 'signup' && fields.password && (() => {
              const strength = getPasswordStrength(fields.password);
              return (
                <div className="password-strength">
                  <div className="password-strength__track">
                    <div className="password-strength__fill"
                      style={{ width: `${(strength.score / 5) * 100}%`, background: strength.color }} />
                  </div>
                  <span className="password-strength__label" style={{ color: strength.color }}>
                    {strength.label}
                  </span>
                </div>
              );
            })()}

            {tab === 'signup' && showPasswordRules && (
              <ul className="password-rules">
                {PASSWORD_RULES.map(r => {
                  const passed = fields.password && r.test(fields.password);
                  return (
                    <li key={r.key} className={passed ? 'rule--pass' : 'rule--fail'}>
                      <span className="rule-icon">{passed ? '✓' : '○'}</span> {r.label}
                    </li>
                  );
                })}
              </ul>
            )}

            {tab === 'signup' && (
              <>
                <label htmlFor="confirmPassword">Confirm Password:</label>
                <input type="password" id="confirmPassword" name="confirmPassword" value={fields.confirmPassword}
                  onChange={handleChange}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                  className={fields.confirmPassword ? (fields.confirmPassword === fields.password ? 'input--available' : 'input--taken') : ''} />
                {fields.confirmPassword && fields.confirmPassword !== fields.password && (
                  <span className="input-hint input-hint--taken">Passwords do not match</span>
                )}
              </>
            )}

            <button className="btn btn-primary stretched-button" onClick={handleSubmit}>
              {tab === 'login' ? 'Login' : 'Create Account'}
            </button>
            {tab === 'login' && (
              <button className="btn btn-ghost btn-sm forgot-password-link" onClick={() => switchTab('forgot')}>
                Forgot Password?
              </button>
            )}
            {tab === 'login' && oauthProviders.google && (
              <>
                <div className="oauth-divider"><span>or</span></div>
                <a href="/api/oauth/google" className="btn btn-oauth btn-google stretched-button">
                  <svg viewBox="0 0 24 24" width="18" height="18" style={{ marginRight: 8, flexShrink: 0 }}>
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Sign in with Google
                </a>
              </>
            )}
          </div>
        </>
      ) : (
        <>
          <h2 className="forgot-password-title">Reset Password</h2>
          {error && <p className="form-error">{error}</p>}
          {info && <p className="form-success">{info}</p>}
          <div className="modal-form">
            <label htmlFor="email">Email Address:</label>
            <input type="email" id="email" name="email" value={fields.email} onChange={handleChange}
              onKeyDown={(e) => e.key === 'Enter' && handleForgotPassword()} />
            <button className="btn btn-primary stretched-button" onClick={handleForgotPassword}>
              Send Reset Link
            </button>
            <button className="btn btn-ghost btn-sm forgot-password-link" onClick={() => switchTab('login')}>
              Back to Login
            </button>
          </div>
        </>
      )}
    </div>
  );
}