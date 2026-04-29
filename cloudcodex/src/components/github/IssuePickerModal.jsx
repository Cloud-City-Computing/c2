/**
 * Cloud Codex - GitHub Issue Picker
 *
 * Search-driven picker that lets the user insert a GitHub issue reference
 * into the document. Uses GitHub's issue search API via /api/github/issues/search.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useEffect, useState } from 'react';
import { searchGitHubIssues } from '../../util';

function parseRepoFromUrl(repositoryUrl) {
  // GitHub returns repository_url like https://api.github.com/repos/OWNER/NAME
  const m = /\/repos\/([^/]+)\/([^/]+)$/.exec(repositoryUrl || '');
  return m ? { owner: m[1], repo: m[2] } : null;
}

export default function IssuePickerModal({ onInsert, onCancel }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const t = setTimeout(() => {
      searchGitHubIssues(q)
        .then((res) => { if (!cancelled) setResults(res.issues || []); })
        .catch((err) => { if (!cancelled) setError(err?.body?.message || err?.message || 'Search failed'); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  const handlePick = (issue) => {
    const parsed = parseRepoFromUrl(issue.repository_url);
    if (!parsed) return;
    onInsert({ owner: parsed.owner, repo: parsed.repo, number: issue.number });
  };

  return (
    <div className="modal-content modal-md">
      <span className="close-button" onClick={onCancel}>&times;</span>
      <h2>Insert GitHub Issue</h2>
      <p className="text-muted" style={{ fontSize: '14px', marginBottom: '8px' }}>
        Search across repos you have access to. Inserts an inline reference
        that re-fetches title + state when the document opens.
      </p>
      <div className="modal-form">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search issues by keyword, label, or repo…"
          autoFocus
        />
      </div>
      {error && <p className="form-error">{error}</p>}
      {loading && <p className="text-muted text-sm">Searching…</p>}
      {!loading && q.trim().length >= 2 && results.length === 0 && !error && (
        <p className="text-muted text-sm">No matching issues.</p>
      )}
      <ul className="settings-item-list compact" style={{ maxHeight: 360, overflow: 'auto' }}>
        {results.map((issue) => {
          const parsed = parseRepoFromUrl(issue.repository_url);
          const repo = parsed ? `${parsed.owner}/${parsed.repo}` : '';
          return (
            <li key={`${repo}#${issue.number}`} className="settings-item">
              <button
                type="button"
                className="btn btn-ghost"
                style={{ width: '100%', justifyContent: 'flex-start', textAlign: 'left' }}
                onClick={() => handlePick(issue)}
              >
                <span className={`gh-issue-embed__state gh-issue-embed__state--${issue.state}`}>●</span>{' '}
                <strong>{repo}#{issue.number}</strong> {issue.title}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="confirm-dialog__actions">
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
