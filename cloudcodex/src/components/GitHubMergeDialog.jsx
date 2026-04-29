/**
 * Cloud Codex - GitHub Merge Dialog
 *
 * Three-pane editor surfaced when a GitHub pull produces conflicting hunks.
 * Shows the local copy and the incoming remote copy side-by-side, with an
 * editable "merged" pane seeded with conflict markers from diff3. The user
 * picks Take Ours, Take Theirs, or hand-edits the merged pane and saves.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState } from 'react';

export default function GitHubMergeDialog({ conflict, link, onCancel, onResolved }) {
  const [merged, setMerged] = useState(conflict?.merged_with_markers || '');
  const [busy, setBusy] = useState(false);

  if (!conflict) return null;

  const takeOurs = () => setMerged(conflict.ours || '');
  const takeTheirs = () => setMerged(conflict.theirs || '');

  const save = async () => {
    setBusy(true);
    try {
      await onResolved(merged);
    } finally {
      setBusy(false);
    }
  };

  const stillHasMarkers = /<<<<<<< |=======\n|>>>>>>> /.test(merged);

  return (
    <div className="modal-content modal-lg gh-merge-dialog">
      <span className="close-button" onClick={onCancel}>&times;</span>
      <h2>Resolve GitHub conflict</h2>
      <p className="text-muted" style={{ fontSize: '14px', marginBottom: '8px' }}>
        Both you and the remote branch changed the same hunks of{' '}
        <code>{link?.file_path}</code>. Pick a side or edit the merged version below,
        then save. After saving, click Push to send your resolution to GitHub.
      </p>

      <div className="gh-merge-dialog__panes">
        <div className="gh-merge-dialog__pane">
          <div className="gh-merge-dialog__pane-header">
            <strong>Yours (local)</strong>
            <button className="btn btn-sm btn-ghost" onClick={takeOurs} disabled={busy}>
              Take ours
            </button>
          </div>
          <pre className="gh-merge-dialog__readonly">{conflict.ours || '(empty)'}</pre>
        </div>
        <div className="gh-merge-dialog__pane">
          <div className="gh-merge-dialog__pane-header">
            <strong>Theirs (remote)</strong>
            <button className="btn btn-sm btn-ghost" onClick={takeTheirs} disabled={busy}>
              Take theirs
            </button>
          </div>
          <pre className="gh-merge-dialog__readonly">{conflict.theirs || '(empty)'}</pre>
        </div>
      </div>

      <div className="gh-merge-dialog__merged">
        <strong>Merged result</strong>
        <textarea
          className="gh-merge-dialog__editor"
          value={merged}
          onChange={(e) => setMerged(e.target.value)}
          spellCheck={false}
          rows={16}
        />
        {stillHasMarkers && (
          <p className="gh-merge-dialog__warn">
            ⚠ Conflict markers (<code>&lt;&lt;&lt;&lt;&lt;&lt;&lt;</code> /{' '}
            <code>=======</code> / <code>&gt;&gt;&gt;&gt;&gt;&gt;&gt;</code>) are still
            present. Remove them before saving.
          </p>
        )}
      </div>

      <div className="confirm-dialog__actions">
        <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          onClick={save}
          disabled={busy || stillHasMarkers || !merged}
        >
          {busy ? 'Saving…' : 'Save merged'}
        </button>
      </div>
    </div>
  );
}
