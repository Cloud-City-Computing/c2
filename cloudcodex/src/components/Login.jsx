/**
 * Cloud Codex - Login Component
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState } from 'react';
import { destroyModal, showModal, serverReq } from '../util';

function CreateAccountForm() {
  const [fields, setFields] = useState({ username: '', email: '', password: '' });
  const [error, setError] = useState(null);

  const handleChange = (e) => setFields(f => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async () => {
    setError(null);
    const res = await serverReq('POST', '/api/create-account', fields);
    if (res.success) {
      document.cookie = `sessionToken=${res.token}; path=/; max-age=${7 * 24 * 60 * 60}; secure; samesite=strict`;
      window.location.reload();
    } else {
      setError(res.message ?? 'Error creating account.');
    }
  };

  return (
    <div className="modal-content">
      <span className="close-button" onClick={destroyModal}>&times;</span>
      <h2>Create Account</h2>
      {error && <p className="form-error">{error}</p>}
      <div className="login-form">
        <label htmlFor="new-username">Username:</label>
        <input type="text" id="new-username" name="username" value={fields.username} onChange={handleChange} required />
        <label htmlFor="new-email">Email:</label>
        <input type="email" id="new-email" name="email" value={fields.email} onChange={handleChange} required />
        <label htmlFor="new-password">Password:</label>
        <input type="password" id="new-password" name="password" value={fields.password} onChange={handleChange} required />
        <button type="button" className="c2-btn stretched-button" onClick={handleSubmit}>
          Create Account
        </button>
      </div>
    </div>
  );
}

export default function Login() {
  const [fields, setFields] = useState({ username: '', password: '' });
  const [error, setError] = useState(null);

  const handleChange = (e) => setFields(f => ({ ...f, [e.target.name]: e.target.value }));

  const handleLogin = async () => {
    setError(null);
    const res = await serverReq('POST', '/api/login', fields);
    if (res.success) {
      document.cookie = `sessionToken=${res.token}; path=/; max-age=${7 * 24 * 60 * 60}; secure; samesite=strict`;
      window.location.reload();
    } else {
      setError(res.message ?? 'Login failed.');
    }
  };

  const handleCreateAccount = () => {
    destroyModal();
    showModal(<CreateAccountForm />, 'modal-md');
  };

  return (
    <div className="modal-content">
      <span className="close-button" onClick={destroyModal}>&times;</span>
      <h2>Login</h2>
      {error && <p className="form-error">{error}</p>}
      <div className="login-form">
        <label htmlFor="username">Username:</label>
        <input type="text" id="username" name="username" value={fields.username} onChange={handleChange} />
        <label htmlFor="password">Password:</label>
        <input type="password" id="password" name="password" value={fields.password} onChange={handleChange} />
        <button className="c2-btn stretched-button" onClick={handleLogin}>Login</button>
        <button className="c2-btn stretched-button" onClick={handleCreateAccount}>Create Account</button>
      </div>
    </div>
  );
}