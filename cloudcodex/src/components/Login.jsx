/**
 * Cloud Codex - Login Component
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState } from 'react';
import { destroyModal, serverReq } from '../util';

export default function Login() {
  const [tab, setTab] = useState('login'); // 'login' | 'signup' | 'forgot' | '2fa'
  const [fields, setFields] = useState({ username: '', email: '', password: '', code: '' });
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [twoFactorToken, setTwoFactorToken] = useState(null);
  const [twoFactorMethod, setTwoFactorMethod] = useState(null); // 'email' | 'totp'

  const handleChange = (e) => setFields(f => ({ ...f, [e.target.name]: e.target.value }));

  const switchTab = (t) => { setTab(t); setError(null); setInfo(null); };

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
    if (!fields.username || !fields.email || !fields.password) { setError('All fields are required.'); return; }
    const res = await serverReq('POST', '/api/create-account', fields);
    if (res.success) {
      document.cookie = `sessionToken=${res.token}; path=/; max-age=${7 * 24 * 60 * 60}; secure; samesite=strict`;
      window.location.reload();
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
            <button className={`login-tab ${tab === 'signup' ? 'active' : ''}`} onClick={() => switchTab('signup')}>Sign Up</button>
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-form">
            <label htmlFor="username">Username:</label>
            <input type="text" id="username" name="username" value={fields.username} onChange={handleChange}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()} />
            {tab === 'signup' && (
              <>
                <label htmlFor="email">Email:</label>
                <input type="email" id="email" name="email" value={fields.email} onChange={handleChange}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()} />
              </>
            )}
            <label htmlFor="password">Password:</label>
            <input type="password" id="password" name="password" value={fields.password} onChange={handleChange}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()} />
            <button className="btn btn-primary stretched-button" onClick={handleSubmit}>
              {tab === 'login' ? 'Login' : 'Create Account'}
            </button>
            {tab === 'login' && (
              <button className="btn btn-ghost btn-sm forgot-password-link" onClick={() => switchTab('forgot')}>
                Forgot Password?
              </button>
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