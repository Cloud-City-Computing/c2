/**
 * Cloud Codex - Reset Password Page
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { serverReq } from '../util';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    if (!password || !confirm) { setError('Both fields are required.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }

    const res = await serverReq('POST', '/api/reset-password', { token, password });
    if (res.success) {
      setSuccess(true);
    } else {
      setError(res.message ?? 'Something went wrong.');
    }
  };

  if (!token) {
    return (
      <div className="reset-password-page">
        <div className="reset-password-card">
          <h1>Invalid Link</h1>
          <p className="text-muted">This password reset link is invalid or missing a token.</p>
          <button className="btn btn-primary" onClick={() => navigate('/')}>Go Home</button>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="reset-password-page">
        <div className="reset-password-card">
          <h1>Password Reset</h1>
          <p className="form-success">Your password has been reset successfully. You can now log in with your new password.</p>
          <button className="btn btn-primary" onClick={() => navigate('/')}>Go to Login</button>
        </div>
      </div>
    );
  }

  return (
    <div className="reset-password-page">
      <div className="reset-password-card">
        <h1>Set New Password</h1>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-form">
          <label htmlFor="new-password">New Password:</label>
          <input type="password" id="new-password" value={password} onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()} />
          <label htmlFor="confirm-password">Confirm Password:</label>
          <input type="password" id="confirm-password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()} />
          <button className="btn btn-primary stretched-button" onClick={handleSubmit}>
            Reset Password
          </button>
        </div>
      </div>
    </div>
  );
}
