/**
 * Cloud Codex - GitHub Code Embed Picker
 *
 * Lightweight modal that collects (owner/repo, branch, path, line range)
 * and inserts a GitHubCodeEmbed Tiptap node into the editor. Pulls the
 * user's repos so they don't have to paste owner/repo manually.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useEffect, useState } from 'react';
import { apiFetch } from '../../util';

export default function CodeEmbedPickerModal({ onInsert, onCancel }) {
  const [repos, setRepos] = useState([]);
  const [loadingRepos, setLoadingRepos] = useState(true);
  const [reposError, setReposError] = useState(null);
  const [selectedFullName, setSelectedFullName] = useState('');
  const [branch, setBranch] = useState('main');
  const [path, setPath] = useState('');
  const [lineStart, setLineStart] = useState('');
  const [lineEnd, setLineEnd] = useState('');
  const [pinSha, setPinSha] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch('GET', '/api/github/repos?per_page=50')
      .then((res) => {
        if (cancelled) return;
        setRepos(res.repos || []);
        if (res.repos?.length && !selectedFullName) {
          setSelectedFullName(res.repos[0].full_name);
          setBranch(res.repos[0].default_branch || 'main');
        }
      })
      .catch((err) => {
        if (!cancelled) setReposError(err?.body?.message || err?.message || 'Failed to load repos');
      })
      .finally(() => {
        if (!cancelled) setLoadingRepos(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRepoChange = (e) => {
    const fullName = e.target.value;
    setSelectedFullName(fullName);
    const repo = repos.find((r) => r.full_name === fullName);
    if (repo) setBranch(repo.default_branch || 'main');
  };

  const handleInsert = async () => {
    if (!selectedFullName || !path) return;
    const [owner, repoName] = selectedFullName.split('/');
    setBusy(true);
    let pinnedSha = null;

    if (pinSha) {
      try {
        const res = await apiFetch(
          'GET',
          `/api/github/embed/code?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repoName)}&path=${encodeURIComponent(path)}&ref=${encodeURIComponent(branch)}`
        );
        pinnedSha = res.sha || null;
      } catch {
        // Pin is best-effort — fall through and insert without one
      }
    }

    onInsert({
      owner,
      repo: repoName,
      path: path.replace(/^\//, ''),
      ref: branch || 'HEAD',
      lineStart: lineStart ? Number(lineStart) : null,
      lineEnd: lineEnd ? Number(lineEnd) : null,
      pinnedSha,
    });
    setBusy(false);
  };

  const canSubmit = selectedFullName && path && !busy;

  return (
    <div className="modal-content modal-md">
      <span className="close-button" onClick={onCancel}>&times;</span>
      <h2>Insert GitHub Code Reference</h2>
      <p className="text-muted" style={{ fontSize: '14px', marginBottom: '8px' }}>
        Embed a live snippet from a repository file. The snippet refetches when
        the document opens, so it stays current with the branch.
      </p>

      <div className="modal-form">
        <label htmlFor="gh-embed-repo">Repository</label>
        {loadingRepos ? (
          <p className="text-muted">Loading your repos…</p>
        ) : reposError ? (
          <p className="text-muted" style={{ color: 'var(--accent-red, #e5544e)' }}>{reposError}</p>
        ) : (
          <select id="gh-embed-repo" value={selectedFullName} onChange={handleRepoChange}>
            {repos.map((r) => (
              <option key={r.id} value={r.full_name}>{r.full_name}</option>
            ))}
          </select>
        )}

        <label htmlFor="gh-embed-branch">Branch / ref</label>
        <input
          id="gh-embed-branch"
          type="text"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          placeholder="main"
        />

        <label htmlFor="gh-embed-path">File path</label>
        <input
          id="gh-embed-path"
          type="text"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="src/index.js"
          autoFocus
        />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <label htmlFor="gh-embed-start">Start line <span className="text-muted">(optional)</span></label>
            <input
              id="gh-embed-start"
              type="number"
              min="1"
              value={lineStart}
              onChange={(e) => setLineStart(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="gh-embed-end">End line <span className="text-muted">(optional)</span></label>
            <input
              id="gh-embed-end"
              type="number"
              min="1"
              value={lineEnd}
              onChange={(e) => setLineEnd(e.target.value)}
            />
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <input
            type="checkbox"
            checked={pinSha}
            onChange={(e) => setPinSha(e.target.checked)}
          />
          Pin to current commit SHA <span className="text-muted">(otherwise follows branch tip)</span>
        </label>
      </div>

      <div className="confirm-dialog__actions">
        <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" onClick={handleInsert} disabled={!canSubmit}>
          {busy ? 'Inserting…' : 'Insert'}
        </button>
      </div>
    </div>
  );
}
