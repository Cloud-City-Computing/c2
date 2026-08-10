/**
 * Cloud Codex - Version history panel
 *
 * Lists a document's named snapshots, previews one inline, and restores or
 * deletes it. Both mutating actions are permission-gated server side.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useEffect, useCallback } from 'react';
import {
  fetchVersions,
  fetchVersion,
  restoreVersion,
  deleteVersion,
  timeAgo,
} from '../../util';
import { sanitizeHtml } from '../../editorUtils';
import { toastError } from '../Toast';

export default function VersionHistory({ logId, onRestore, versionKey }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(null);
  const [previewId, setPreviewId] = useState(null);

  const loadVersions = useCallback(async () => {
    try {
      const res = await fetchVersions(logId);
      setVersions(res.versions || []);
    } catch { /* ignore */ }
    setLoading(false);
    // versionKey is deliberately a dependency even though the body does not
    // read it: bumping it is how the editor forces a reload after a publish.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logId, versionKey]);

  useEffect(() => { loadVersions(); }, [loadVersions]);

  const handlePreview = async (v) => {
    if (previewId === v.id) {
      setPreview(null);
      setPreviewId(null);
      return;
    }
    try {
      const res = await fetchVersion(logId, v.id);
      setPreview(res.version);
      setPreviewId(v.id);
    } catch { /* ignore */ }
  };

  const handleRestore = async (v) => {
    try {
      await restoreVersion(logId, v.id);
      onRestore?.();
      setPreview(null);
      setPreviewId(null);
    } catch (e) { toastError(e); }
  };

  const handleDelete = async (v) => {
    try {
      await deleteVersion(logId, v.id);
      setVersions(prev => prev.filter(ver => ver.id !== v.id));
      if (previewId === v.id) { setPreview(null); setPreviewId(null); }
    } catch (e) { toastError(e); }
  };

  if (loading) return <p className="text-muted">Loading history...</p>;
  if (versions.length === 0) return <p className="text-muted">No previous versions.</p>;

  return (
    <div className="version-history">
      <h3>Version History</h3>
      <ul className="version-list">
        {versions.map(v => (
          <li key={v.id}>
            {/* The row was a div with role="button" and tabIndex, but no key
                handler, so it was focusable and not activatable; and because
                the Restore button was nested inside it, the row's accessible
                name swallowed that button's label. The info block is now the
                real button and Restore is its sibling. */}
            <div className={`version-list__item${previewId === v.id ? ' version-list__item--active' : ''}`}>
              <button
                type="button"
                className="version-list__info"
                onClick={() => handlePreview(v)}
                aria-expanded={previewId === v.id}
              >
                <span className="version-list__heading">
                  {v.title || `Version ${v.version_number}`}
                </span>
                {v.notes && <span className="version-list__notes">{v.notes}</span>}
                <span className="version-list__meta">
                  <span className="version-list__badge">v{v.version_number}</span>
                  <span className="version-list__date">{timeAgo(v.saved_at)}</span>
                  {v.created_by && <span className="version-list__author">{v.created_by}</span>}
                </span>
              </button>
              {previewId !== v.id && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleRestore(v)}
                  aria-label={`Restore ${v.title || `version ${v.version_number}`}`}
                >
                  Restore
                </button>
              )}
            </div>
            {previewId === v.id && preview && (
              <div className="version-preview">
                <div className="version-preview__header">
                  <div className="version-preview__title-block">
                    <span className="version-preview__title">{preview.title || `Version ${preview.version_number}`}</span>
                    <span className="version-preview__meta">v{preview.version_number} &middot; {new Date(preview.saved_at).toLocaleString()}{preview.created_by ? ` · ${preview.created_by}` : ''}</span>
                  </div>
                  <span className="version-preview__actions">
                    <button className="btn btn-ghost btn-sm btn-danger" onClick={() => handleDelete(preview)}>Delete</button>
                    <button className="btn btn-primary btn-sm" onClick={() => handleRestore(preview)}>Restore</button>
                  </span>
                </div>
                {preview.notes && <p className="version-preview__notes">{preview.notes}</p>}
                <details className="version-preview__details">
                  <summary>View document content</summary>
                  <div className="version-preview__content" dangerouslySetInnerHTML={{ __html: sanitizeHtml(preview.html_content) }} />
                </details>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
