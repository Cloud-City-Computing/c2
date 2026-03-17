/**
 * Cloud Codex - Confirm Dialog Component
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState } from 'react';

export default function ConfirmDialog({ title, message, onConfirm, onCancel, confirmLabel = 'Delete', danger = true }) {
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
    } catch {
      setLoading(false);
    }
  };

  return (
    <div className="modal-content confirm-dialog">
      <span className="close-button" onClick={onCancel}>&times;</span>
      <h2>{title}</h2>
      <p>{message}</p>
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
