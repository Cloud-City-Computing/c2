/**
 * Cloud Codex - Publish Version Modal
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState } from 'react';
import useGitHubStatus from '../hooks/useGitHubStatus';

export default function PublishModal({ onPublish, onCancel, githubLink }) {
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [createRelease, setCreateRelease] = useState(false);
  const [tagName, setTagName] = useState('');
  const [loading, setLoading] = useState(false);
  const { connected: ghConnected } = useGitHubStatus() || {};

  const repoSuggestion = githubLink
    ? `${githubLink.repo_owner}/${githubLink.repo_name}`
    : '';

  const handlePublish = async () => {
    setLoading(true);
    try {
      await onPublish({
        title: title.trim() || undefined,
        notes: notes.trim() || undefined,
        create_github_release: createRelease,
        target_repo: createRelease ? repoSuggestion : undefined,
        tag_name: createRelease && tagName.trim() ? tagName.trim() : undefined,
      });
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
        {ghConnected && repoSuggestion && (
          <>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
              <input
                type="checkbox"
                checked={createRelease}
                onChange={(e) => setCreateRelease(e.target.checked)}
              />
              Also create a GitHub Release on <code>{repoSuggestion}</code>
            </label>
            {createRelease && (
              <>
                <label htmlFor="publish-tag">Tag name</label>
                <input
                  id="publish-tag"
                  type="text"
                  value={tagName}
                  onChange={(e) => setTagName(e.target.value)}
                  placeholder="v{version} (auto-generated if blank)"
                  maxLength={255}
                />
              </>
            )}
          </>
        )}
      </div>
      <div className="confirm-dialog__actions">
        <button className="btn btn-ghost" onClick={onCancel} disabled={loading}>Cancel</button>
        <button className="btn btn-primary" onClick={handlePublish} disabled={loading}>
          {loading ? 'Publishing...' : (createRelease ? 'Publish & Release' : 'Publish')}
        </button>
      </div>
    </div>
  );
}
