/**
 * Cloud Codex - Login Component
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState } from 'react';
import { destroyModal, serverReq } from '../util';

export default function Login() {
  const [tab, setTab] = useState('login'); // 'login' | 'signup'
  const [fields, setFields] = useState({ username: '', email: '', password: '' });
  const [error, setError] = useState(null);

  const handleChange = (e) => setFields(f => ({ ...f, [e.target.name]: e.target.value }));

  const switchTab = (t) => { setTab(t); setError(null); };

  const handleLogin = async () => {
    setError(null);
    const res = await serverReq('POST', '/api/login', { username: fields.username, password: fields.password });
    if (res.success) {
      document.cookie = `sessionToken=${res.token}; path=/; max-age=${7 * 24 * 60 * 60}; secure; samesite=strict`;
      window.location.reload();
    } else {
      setError(res.message ?? 'Login failed.');
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

  const handleSubmit = tab === 'login' ? handleLogin : handleSignup;

  return (
    <div className="modal-content">
      <span className="close-button" onClick={destroyModal}>&times;</span>
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
      </div>
    </div>
  );
}