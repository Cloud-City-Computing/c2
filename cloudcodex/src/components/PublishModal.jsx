/**
 * Cloud Codex - Publish Version Modal
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState } from 'react';

export default function PublishModal({ onPublish, onCancel }) {
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  const handlePublish = async () => {
    setLoading(true);
    try {
      await onPublish({ title: title.trim() || undefined, notes: notes.trim() || undefined });
    } catch {
      setLoading(false);
    }
  };

  return (
    <div className="modal-content modal-md">
      <span className="close-button" onClick={onCancel}>&times;</span>
      <h2>Publish Version</h2>
      <p className="text-muted" style={{ fontSize: '14px', marginBottom: '8px' }}>
        Create a formal version snapshot of the current document.
      </p>
      <div className="modal-form">
        <label htmlFor="publish-title">Version Title <span className="text-muted">(optional)</span></label>
        <input
          id="publish-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Final draft, Review v2..."
          maxLength={255}
          autoFocus
        />
        <label htmlFor="publish-notes">Notes <span className="text-muted">(optional)</span></label>
        <textarea
          id="publish-notes"
          className="modal-form__textarea"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Describe what changed in this version..."
          maxLength={5000}
          rows={4}
        />
      </div>
      <div className="confirm-dialog__actions">
        <button className="btn btn-ghost" onClick={onCancel} disabled={loading}>Cancel</button>
        <button className="btn btn-primary" onClick={handlePublish} disabled={loading}>
          {loading ? 'Publishing...' : 'Publish'}
        </button>
      </div>
    </div>
  );
}
