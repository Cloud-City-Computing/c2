/**
 * Cloud Codex - Confirm Dialog Component
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState } from 'react';

/**
 * Parse a user-friendly message from an API error.
 * Handles 403 permission denials with a clear prefix.
 */
function friendlyError(err) {
  const msg = err?.body?.message || err?.message || 'An unexpected error occurred.';
  if (err?.status === 403) return `Permission denied: ${msg}`;
  return msg;
}

export default function ConfirmDialog({ title, message, onConfirm, onCancel, confirmLabel = 'Delete', danger = true }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleConfirm = async () => {
    setLoading(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setError(friendlyError(e));
      setLoading(false);
    }
  };

  return (
    <div className="modal-content confirm-dialog">
      <span className="close-button" onClick={onCancel}>&times;</span>
      <h2>{title}</h2>
      <p>{message}</p>
      {error && <p className="form-error">{error}</p>}
      <div className="confirm-dialog__actions">
        <button className="btn btn-ghost" onClick={onCancel} disabled={loading}>Cancel</button>
        <button
          className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
          onClick={handleConfirm}
          disabled={loading}
        >
          {loading ? 'Working...' : confirmLabel}
        </button>
      </div>
    </div>
  );
}
