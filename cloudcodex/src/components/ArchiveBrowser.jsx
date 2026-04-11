/**
 * Cloud Codex - Archive Browser Component
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  fetchArchives, createArchive, updateArchive, deleteArchive,
  fetchLogs, createLog, deleteLog,
  manageArchiveAccess, manageArchiveSquadAccess, manageArchiveWorkspaceAccess,
  fetchArchiveAccess, searchUsers,
  uploadDocument, exportDocument, fetchDocument,
  showModal, destroyModal,
  fetchCommentCount,
  fetchArchiveRepos, linkArchiveRepo, unlinkArchiveRepo,
  apiFetch,
} from '../util';
import ConfirmDialog from './ConfirmDialog';
import { toastError } from './Toast';
import usePresence from '../hooks/usePresence';
import PresenceAvatars from './PresenceAvatars';
import CommentManager from './CommentManager';

// --- New Archive Form ---

function NewArchiveModal({ onCreated, squadId }) {
  const [name, setName] = useState('');
  const [error, setError] = useState(null);

  const handleSubmit = async () => {
    setError(null);
    if (!name.trim()) { setError('Archive name is required.'); return; }
    try {
      await createArchive(name, squadId || undefined);
      destroyModal();
      onCreated?.();
    } catch (e) {
      setError(e.body?.message ?? 'Error creating archive.');
    }
  };

  return (
    <div className="modal-content">
      <span className="close-button" onClick={destroyModal}>&times;</span>
      <h2>New Archive</h2>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-form">
        <label htmlFor="archive-name">Archive Name:</label>
        <input id="archive-name" type="text" value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()} />
        <button className="btn btn-primary stretched-button" onClick={handleSubmit}>Create Archive</button>
      </div>
    </div>
  );
}

function RenameArchiveModal({ archive, onRenamed }) {
  const [name, setName] = useState(archive.name);
  const [error, setError] = useState(null);

  const handleSubmit = async () => {
    setError(null);
    if (!name.trim()) { setError('Archive name is required.'); return; }
    try {
      await updateArchive(archive.id, name.trim());
      destroyModal();
      onRenamed?.();
    } catch (e) {
      setError(e.body?.message ?? 'Error renaming archive.');
    }
  };

  return (
    <div className="modal-content">
      <span className="close-button" onClick={destroyModal}>&times;</span>
      <h2>Rename Archive</h2>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-form">
        <label htmlFor="rename-archive-name">Archive Name:</label>
        <input
          id="rename-archive-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
        />
        <button className="btn btn-primary stretched-button" onClick={handleSubmit}>Save</button>
      </div>
    </div>
  );
}

function ManageArchiveAccessModal({ archive, onAccessUpdated, onAccessSaved }) {
  const [tab, setTab] = useState('users');
  const [accessData, setAccessData] = useState(null);
  const [loadingAccess, setLoadingAccess] = useState(true);

  // User tab state
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [perms, setPerms] = useState({ read: true, write: false });
  const [mode, setMode] = useState('add');
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Squad tab state
  const [squadPerms, setSquadPerms] = useState({ read: true, write: false });
  const [selectedSquad, setSelectedSquad] = useState('');
  const [squadMode, setSquadMode] = useState('add');

  const loadAccess = useCallback(async () => {
    setLoadingAccess(true);
    try {
      const res = await fetchArchiveAccess(archive.id);
      setAccessData(res.access);
    } catch { /* ignore */ }
    setLoadingAccess(false);
  }, [archive.id]);

  useEffect(() => { loadAccess(); }, [loadAccess]);

  const handleSearch = useCallback(async (q) => {
    setQuery(q);
    if (q.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const res = await searchUsers(q.trim());
      setResults(res.users || []);
    } catch {
      setResults([]);
    }
    setSearching(false);
  }, []);

  const togglePerm = (key) => setPerms((prev) => ({ ...prev, [key]: !prev[key] }));
  const toggleSquadPerm = (key) => setSquadPerms((prev) => ({ ...prev, [key]: !prev[key] }));

  const handleAccessUpdate = async (action) => {
    setError(null);
    setStatus(null);
    if (!selected) {
      setError('Please select a user.');
      return;
    }

    const selectedPerms = Object.entries(perms)
      .filter(([, enabled]) => enabled)
      .map(([perm]) => perm);

    if (selectedPerms.length === 0) {
      setError('Select at least one permission to update.');
      return;
    }

    try {
      setSubmitting(true);
      await Promise.all(
        selectedPerms.map((perm) => manageArchiveAccess(archive.id, selected.id, perm, action))
      );
      const verb = action === 'add' ? 'granted' : 'revoked';
      const labels = selectedPerms.join(' + ');
      const successMessage = `Successfully ${verb} ${labels} access for ${selected.name}.`;
      setStatus(successMessage);
      loadAccess();
      await new Promise((resolve) => setTimeout(resolve, 900));
      onAccessSaved?.(successMessage);
      destroyModal();
      onAccessUpdated?.();
    } catch (e) {
      setError(e.body?.message ?? 'Error updating archive access.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSquadAccessUpdate = async () => {
    setError(null);
    setStatus(null);
    if (!selectedSquad) {
      setError('Please select a squad.');
      return;
    }

    const selectedPerms = Object.entries(squadPerms)
      .filter(([, enabled]) => enabled)
      .map(([perm]) => perm);

    if (selectedPerms.length === 0) {
      setError('Select at least one permission to update.');
      return;
    }

    try {
      setSubmitting(true);
      await Promise.all(
        selectedPerms.map((perm) => manageArchiveSquadAccess(archive.id, Number(selectedSquad), perm, squadMode))
      );
      const squadName = accessData?.workspace_squads?.find(s => s.id === Number(selectedSquad))?.name || `Squad #${selectedSquad}`;
      const verb = squadMode === 'add' ? 'granted' : 'revoked';
      const labels = selectedPerms.join(' + ');
      const successMessage = `Successfully ${verb} ${labels} access for squad "${squadName}".`;
      setStatus(successMessage);
      loadAccess();
      await new Promise((resolve) => setTimeout(resolve, 900));
      onAccessSaved?.(successMessage);
      destroyModal();
      onAccessUpdated?.();
    } catch (e) {
      setError(e.body?.message ?? 'Error updating squad access.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleWorkspaceToggle = async (accessType, currentValue) => {
    setError(null);
    setStatus(null);
    try {
      setSubmitting(true);
      const action = currentValue ? 'remove' : 'add';
      await manageArchiveWorkspaceAccess(archive.id, accessType, action);
      const verb = currentValue ? 'Revoked' : 'Granted';
      setStatus(`${verb} workspace ${accessType} access.`);
      loadAccess();
    } catch (e) {
      setError(e.body?.message ?? 'Error updating workspace access.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-content">
      <span className="close-button" onClick={destroyModal}>&times;</span>
      <h2>Manage Archive Access</h2>
      <p className="text-muted text-sm" style={{ marginBottom: 10 }}>
        Archive: <strong>{archive.name}</strong>
      </p>
      {error && <p className="form-error">{error}</p>}
      {status && <p className="form-success">{status}</p>}

      {/* Tabs */}
      <div className="access-tabs" style={{ display: 'flex', gap: 0, marginBottom: 14, borderBottom: '1px solid var(--border-color)' }}>
        {['users', ...(archive.squad_id ? ['squads', 'workspace'] : [])].map((t) => (
          <button key={t} className={`btn btn-ghost btn-sm ${tab === t ? 'active' : ''}`}
            style={{ borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent', borderRadius: 0 }}
            onClick={() => { setTab(t); setError(null); setStatus(null); }}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* User tab */}
      {tab === 'users' && (
        <div className="modal-form">
          <label>Search Users:</label>
          <div className="user-search">
            <input
              className="user-search__input"
              type="text"
              value={query}
              placeholder="Search by name or email..."
              onChange={(e) => handleSearch(e.target.value)}
            />
            {searching && <p className="text-muted text-sm">Searching...</p>}
            {results.length > 0 && !selected && (
              <ul className="user-search__results">
                {results.map((user) => (
                  <li key={user.id} className="user-search__item"
                    onClick={() => { setSelected(user); setResults([]); setQuery(user.email); }}>
                    <span className="user-search__name">{user.name}</span>
                    <span className="user-search__email">{user.email}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {selected && (
            <div className="invite-selected">
              <span>Selected: <strong>{selected.name}</strong> ({selected.email})</span>
              <button className="btn btn-ghost btn-sm" onClick={() => { setSelected(null); setQuery(''); }}>Change</button>
            </div>
          )}

          <label style={{ marginTop: 12 }}>Permissions:</label>
          <div className="invite-perms-grid">
            {[
              ['read', 'Read', 'Can view archive logs and documents'],
              ['write', 'Write', 'Can edit logs and archive content'],
            ].map(([key, label, desc]) => (
              <label key={key} className="invite-perm-toggle">
                <input type="checkbox" checked={perms[key]} onChange={() => togglePerm(key)} />
                <div><strong>{label}</strong><p className="text-muted text-sm">{desc}</p></div>
              </label>
            ))}
          </div>

          <label style={{ marginTop: 12 }}>Action:</label>
          <select value={mode} onChange={(e) => setMode(e.target.value)} className="form-select" disabled={submitting}>
            <option value="add">Grant selected permissions</option>
            <option value="remove">Revoke selected permissions</option>
          </select>

          <div className="inline-form" style={{ marginTop: 12 }}>
            <button className="btn btn-primary stretched-button" onClick={() => handleAccessUpdate(mode)} disabled={submitting}>
              {submitting ? 'Applying Changes...' : (mode === 'add' ? 'Grant Permissions' : 'Revoke Permissions')}
            </button>
          </div>
        </div>
      )}

      {/* Squad tab */}
      {tab === 'squads' && (
        <div className="modal-form">
          <label>Select Squad:</label>
          <select
            value={selectedSquad}
            onChange={(e) => setSelectedSquad(e.target.value)}
            className="form-select"
            disabled={submitting || loadingAccess}
          >
            <option value="">-- Choose a squad --</option>
            {(accessData?.workspace_squads || []).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>

          <label style={{ marginTop: 12 }}>Permissions:</label>
          <div className="invite-perms-grid">
            {[
              ['read', 'Read', 'All squad members can view this archive'],
              ['write', 'Write', 'All squad members can edit this archive'],
            ].map(([key, label, desc]) => (
              <label key={key} className="invite-perm-toggle">
                <input type="checkbox" checked={squadPerms[key]} onChange={() => toggleSquadPerm(key)} />
                <div><strong>{label}</strong><p className="text-muted text-sm">{desc}</p></div>
              </label>
            ))}
          </div>

          <label style={{ marginTop: 12 }}>Action:</label>
          <select value={squadMode} onChange={(e) => setSquadMode(e.target.value)} className="form-select" disabled={submitting}>
            <option value="add">Grant selected permissions</option>
            <option value="remove">Revoke selected permissions</option>
          </select>

          <div className="inline-form" style={{ marginTop: 12 }}>
            <button className="btn btn-primary stretched-button" onClick={handleSquadAccessUpdate} disabled={submitting}>
              {submitting ? 'Applying Changes...' : (squadMode === 'add' ? 'Grant Squad Permissions' : 'Revoke Squad Permissions')}
            </button>
          </div>
        </div>
      )}

      {/* Workspace tab */}
      {tab === 'workspace' && accessData && (
        <div className="modal-form">
          <p className="text-muted text-sm" style={{ marginBottom: 12 }}>
            Grant access to all users who are members of any squad in this workspace.
          </p>
          <div className="invite-perms-grid">
            <label className="invite-perm-toggle">
              <input
                type="checkbox"
                checked={accessData.read_workspace}
                onChange={() => handleWorkspaceToggle('read', accessData.read_workspace)}
                disabled={submitting}
              />
              <div>
                <strong>Read</strong>
                <p className="text-muted text-sm">All workspace members can view this archive</p>
              </div>
            </label>
            <label className="invite-perm-toggle">
              <input
                type="checkbox"
                checked={accessData.write_workspace}
                onChange={() => handleWorkspaceToggle('write', accessData.write_workspace)}
                disabled={submitting}
              />
              <div>
                <strong>Write</strong>
                <p className="text-muted text-sm">All workspace members can edit this archive</p>
              </div>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

// --- New Log Form ---

function NewLogModal({ archiveId, parentId, onCreated }) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState(null);

  const handleSubmit = async () => {
    setError(null);
    if (!title.trim()) { setError('Log title is required.'); return; }
    try {
      const res = await createLog(archiveId, title, parentId);
      destroyModal();
      onCreated?.(res.logId);
    } catch (e) {
      setError(e.body?.message ?? 'Error creating log.');
    }
  };

  return (
    <div className="modal-content">
      <span className="close-button" onClick={destroyModal}>&times;</span>
      <h2>New Log</h2>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-form">
        <label htmlFor="log-title">Log Title:</label>
        <input id="log-title" type="text" value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()} />
        <button className="btn btn-primary stretched-button" onClick={handleSubmit}>Create Log</button>
      </div>
    </div>
  );
}

// --- Upload Document Modal ---

function UploadDocumentModal({ archiveId, parentId, onUploaded }) {
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    if (!file) { setError('Please select a file.'); return; }
    setUploading(true);
    try {
      const res = await uploadDocument(archiveId, file, parentId);
      destroyModal();
      onUploaded?.(res.logId);
    } catch (e) {
      setError(e.body?.message ?? 'Error uploading document.');
    }
    setUploading(false);
  };

  return (
    <div className="modal-content">
      <span className="close-button" onClick={destroyModal}>&times;</span>
      <h2>Upload Document</h2>
      <p className="text-muted text-sm" style={{ marginBottom: 10 }}>
        Supported formats: HTML, Markdown, Plain Text, PDF, Word (DOCX)
      </p>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-form">
        <label htmlFor="upload-file">Select File:</label>
        <input
          id="upload-file"
          type="file"
          accept=".html,.htm,.md,.markdown,.txt,.pdf,.docx"
          onChange={(e) => setFile(e.target.files[0] || null)}
        />
        {file && (
          <p className="text-muted text-sm">
            Selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)
          </p>
        )}
        <button className="btn btn-primary stretched-button" onClick={handleSubmit} disabled={uploading}>
          {uploading ? 'Uploading...' : 'Upload'}
        </button>
      </div>
    </div>
  );
}

// --- Log Tree ---

function LogTreeItem({ log, archiveId, depth = 0, onLogCreated, onLogDeleted, getLogUsers }) {
  const [expanded, setExpanded] = useState(depth === 0);
  const [showExport, setShowExport] = useState(false);
  const [commentCount, setCommentCount] = useState(0);
  const exportRef = useRef(null);
  const navigate = useNavigate();
  const activeUsers = getLogUsers(log.id);

  // Load open comment count
  useEffect(() => {
    fetchCommentCount(log.id).then(r => setCommentCount(r.count || 0)).catch(() => {});
  }, [log.id]);

  useEffect(() => {
    if (!showExport) return undefined;
    const handleClickOutside = (e) => {
      if (exportRef.current && !exportRef.current.contains(e.target)) {
        setShowExport(false);
      }
    };
    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, [showExport]);

  const handleExport = async (format) => {
    setShowExport(false);
    try {
      if (format === 'pdf') {
        const res = await fetchDocument(log.id);
        await exportDocument(log.id, format, log.title, res.document.html_content);
      } else {
        await exportDocument(log.id, format, log.title, null);
      }
    } catch (e) {
      toastError(e);
    }
  };

  const handleNewSublog = () => {
    showModal(
      <NewLogModal archiveId={archiveId} parentId={log.id} onCreated={onLogCreated} />,
      'modal-md'
    );
  };

  const handleDelete = () => {
    showModal(
      <ConfirmDialog
        title="Delete Log"
        message={`Delete "${log.title}"? This cannot be undone.`}
        onConfirm={async () => {
          await deleteLog(archiveId, log.id);
          destroyModal();
          onLogDeleted?.();
        }}
        onCancel={destroyModal}
      />,
      'modal-md'
    );
  };

  return (
    <li className="log-tree-item" style={{ paddingLeft: `${depth * 16}px` }}>
      <div className="log-tree-row">
        {log.children?.length > 0 && (
          <button className="log-tree-toggle" onClick={() => setExpanded(e => !e)}
            aria-label={expanded ? 'Collapse' : 'Expand'}>
            {expanded ? '▾' : '▸'}
          </button>
        )}
        <span className="log-tree-title" onClick={() => navigate(`/archives/${archiveId}/doc/${log.id}`)}>
          {log.title}
        </span>
        <PresenceAvatars users={activeUsers} />
        <div className="log-tree-actions">
          <div className="export-dropdown" ref={exportRef}>
            <button className="log-tree-export" onClick={() => setShowExport(v => !v)} title="Export log">⤓</button>
            {showExport && (
              <div className="export-dropdown__menu export-dropdown__menu--up">
                <button className="export-dropdown__item" onClick={() => handleExport('html')}>HTML (.html)</button>
                <button className="export-dropdown__item" onClick={() => handleExport('md')}>Markdown (.md)</button>
                <button className="export-dropdown__item" onClick={() => handleExport('txt')}>Plain Text (.txt)</button>
                <button className="export-dropdown__item" onClick={() => handleExport('pdf')}>PDF (.pdf)</button>
                <button className="export-dropdown__item" onClick={() => handleExport('docx')}>Word (.docx)</button>
              </div>
            )}
          </div>
          <button className="log-tree-add" onClick={handleNewSublog} title="Add sublog">+</button>
          <button className="log-tree-comments" onClick={() => {
            showModal(
              <CommentManager logId={log.id} logTitle={log.title} onClose={destroyModal} onNavigate={(_c) => { destroyModal(); navigate(`/archives/${archiveId}/doc/${log.id}`); }} />,
              'modal-lg'
            );
          }} title="Manage comments">
            💬{commentCount > 0 && <span className="comment-count-badge">{commentCount}</span>}
          </button>
          <button className="log-tree-delete" onClick={handleDelete} title="Delete log">&times;</button>
        </div>
      </div>
      {expanded && log.children?.length > 0 && (
        <ul className="log-tree-children">
          {log.children.map(child => (
            <LogTreeItem key={child.id} log={child} archiveId={archiveId}
              depth={depth + 1} onLogCreated={onLogCreated} onLogDeleted={onLogDeleted} getLogUsers={getLogUsers} />
          ))}
        </ul>
      )}
    </li>
  );
}

function LogTree({ archiveId, onLogCreated, getLogUsers }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchLogs(archiveId);
      setLogs(res.logs || []);
    } catch (e) {
      setError(e.body?.message ?? 'Error loading logs.');
    }
    setLoading(false);
  }, [archiveId]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  const handleLogCreated = useCallback((newLogId) => {
    loadLogs();
    onLogCreated?.(newLogId);
  }, [loadLogs, onLogCreated]);

  const handleNewRootLog = () => {
    showModal(
      <NewLogModal archiveId={archiveId} parentId={null} onCreated={handleLogCreated} />,
      'modal-md'
    );
  };

  const handleUpload = () => {
    showModal(
      <UploadDocumentModal archiveId={archiveId} parentId={null} onUploaded={handleLogCreated} />,
      'modal-md'
    );
  };

  if (loading) return <p className="text-muted">Loading logs...</p>;
  if (error) return <p className="form-error">{error}</p>;

  return (
    <div className="log-tree">
      <div className="log-tree-header">
        <button className="btn btn-primary btn-sm" onClick={handleNewRootLog}>+ New Log</button>
        <button className="btn btn-ghost btn-sm" onClick={handleUpload}>Upload Document</button>
      </div>
      {logs.length === 0
        ? <p className="text-muted">No logs yet. Create one to get started.</p>
        : (
          <ul className="log-tree-list">
            {logs.map(log => (
              <LogTreeItem key={log.id} log={log} archiveId={archiveId}
                onLogCreated={handleLogCreated} onLogDeleted={loadLogs} getLogUsers={getLogUsers} />
            ))}
          </ul>
        )
      }
    </div>
  );
}

// --- Link Repo Modal ---

function LinkRepoModal({ archiveId, onLinked }) {
  const [repos, setRepos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('GET', '/api/github/repos');
        if (!cancelled) setRepos(res.repos || []);
      } catch (e) {
        if (!cancelled) setError(e.status === 401 ? 'Connect your GitHub account first (Account → Linked Accounts).' : 'Could not load repos from GitHub.');
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const handleLink = async (repo) => {
    setError(null);
    try {
      await linkArchiveRepo(archiveId, {
        repoFullName: repo.full_name,
        repoOwner: repo.owner.login,
        repoName: repo.name,
      });
      destroyModal();
      onLinked?.();
    } catch (e) {
      setError(e.body?.message ?? 'Error linking repo.');
    }
  };

  const filtered = repos.filter(r =>
    r.full_name.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="modal-content">
      <span className="close-button" onClick={destroyModal}>&times;</span>
      <h2>Link GitHub Repo</h2>
      {error && <p className="form-error">{error}</p>}
      {loading && <p className="text-muted">Loading your GitHub repos...</p>}
      {!loading && !error && (
        <>
          <input
            type="text"
            className="link-repo-search"
            placeholder="Filter repos..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoFocus
          />
          <ul className="link-repo-list">
            {filtered.length === 0 && <li className="text-muted text-sm">No matching repos.</li>}
            {filtered.map(repo => (
              <li key={repo.id} className="link-repo-item" onClick={() => handleLink(repo)}>
                <span className="link-repo-item__name">{repo.full_name}</span>
                {repo.private && <span className="link-repo-item__badge">Private</span>}
                {repo.description && <span className="link-repo-item__desc text-muted text-sm">{repo.description}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// --- Linked Repos Panel (inline in archive card) ---

function LinkedRepos({ archiveId }) {
  const navigate = useNavigate();
  const [repos, setRepos] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchArchiveRepos(archiveId);
      setRepos(res.repos || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [archiveId]);

  useEffect(() => { load(); }, [load]);

  const handleUnlink = (repo) => {
    showModal(
      <ConfirmDialog
        title="Unlink Repo"
        message={`Remove "${repo.repo_full_name}" from this archive?`}
        onConfirm={async () => {
          await unlinkArchiveRepo(archiveId, repo.id);
          destroyModal();
          load();
        }}
        onCancel={destroyModal}
      />,
      'modal-md'
    );
  };

  return (
    <div className="archive-repos">
      <div className="archive-repos__header">
        <h4>Linked Repos</h4>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => showModal(<LinkRepoModal archiveId={archiveId} onLinked={load} />, 'modal-md')}
        >
          + Link Repo
        </button>
      </div>
      {loading && <p className="text-muted text-sm">Loading repos...</p>}
      {!loading && repos.length === 0 && (
        <p className="text-muted text-sm">No repos linked yet.</p>
      )}
      {!loading && repos.length > 0 && (
        <ul className="settings-item-list compact">
          {repos.map(repo => (
            <li key={repo.id} className="settings-item linked-repo-row">
              <div className="linked-repo-row__info"
                   onClick={() => navigate(`/github/${repo.repo_owner}/${repo.repo_name}`)}
                   style={{ cursor: 'pointer' }}>
                <svg className="linked-repo-row__icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
                  <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z" />
                </svg>
                <span className="linked-repo-row__name">{repo.repo_full_name}</span>
              </div>
              <span className="text-muted text-sm">
                Linked {new Date(repo.linked_at).toLocaleDateString()}
                {repo.linked_by_name ? ` by ${repo.linked_by_name}` : ''}
              </span>
              <button className="btn btn-danger btn-sm" onClick={() => handleUnlink(repo)}>Unlink</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --- Archive Access Panel (inline in archive card) ---

function ArchiveAccess({ archiveId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchArchiveAccess(archiveId);
      setData(res.access);
    } catch { /* read-only view, ignore errors gracefully */ }
    setLoading(false);
  }, [archiveId]);

  useEffect(() => { load(); }, [load]);

  const coveredBySquads = new Set(
    (data?.granted_squad_user_ids || []).map(Number)
  );
  const hasExplicitGrants = data && (
    data.read_users.some(u => !coveredBySquads.has(u.id)) ||
    data.write_users.some(u => !coveredBySquads.has(u.id)) ||
    data.read_squads.length > 0 || data.write_squads.length > 0 ||
    data.read_workspace || data.write_workspace
  );

  return (
    <div className="archive-access">
      <div className="archive-access__header">
        <h4 onClick={() => setCollapsed(c => !c)} style={{ cursor: 'pointer', userSelect: 'none' }}>
          <span style={{ fontSize: '0.8em', marginRight: 4 }}>{collapsed ? '▸' : '▾'}</span>
          Access
        </h4>
      </div>

      {!collapsed && (
        <div className="archive-access__body">
          {loading && <p className="text-muted text-sm">Loading access info...</p>}

          {!loading && !data && <p className="text-muted text-sm">Unable to load access info.</p>}

          {!loading && data && (
            <>
              {/* Owner */}
              {data.created_by_name && (
                <div className="access-section">
                  <span className="access-section__label">Owner</span>
                  <span className="access-section__value">{data.created_by_name}</span>
                </div>
              )}

              {/* Owner Squad (inherited) */}
              {data.owner_squad_name && data.owner_squad_members.length > 0 && (
                <div className="access-section">
                  <span className="access-section__label">
                    Squad: {data.owner_squad_name}
                    <span className="text-muted text-xs" style={{ marginLeft: 4 }}>(inherited)</span>
                  </span>
                  <ul className="access-member-list">
                    {data.owner_squad_members.map(m => (
                      <li key={m.user_id} className="access-member">
                        <span className="access-member__name">{m.name}</span>
                        <span className="access-member__badges">
                          {m.role === 'owner' ? (
                            <span className="badge badge-accent">owner</span>
                          ) : (
                            <>
                              {m.can_read && <span className="badge badge-info">read</span>}
                              {m.can_write && <span className="badge badge-warning">write</span>}
                              {!m.can_read && !m.can_write && <span className="badge badge-muted">none</span>}
                            </>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Workspace-level access */}
              {(data.read_workspace || data.write_workspace) && (
                <div className="access-section">
                  <span className="access-section__label">Workspace</span>
                  <span className="access-section__value">
                    {data.read_workspace && <span className="badge badge-info">read</span>}
                    {data.write_workspace && <span className="badge badge-warning">write</span>}
                    <span className="text-muted text-xs" style={{ marginLeft: 4 }}>all workspace members</span>
                  </span>
                </div>
              )}

              {/* Granted squads — merge read + write for same squad */}
              {(data.read_squads.length > 0 || data.write_squads.length > 0) && (() => {
                const map = new Map();
                data.read_squads.forEach(s => map.set(s.id, { ...s, read: true, write: false }));
                data.write_squads.forEach(s => {
                  const existing = map.get(s.id);
                  if (existing) existing.write = true;
                  else map.set(s.id, { ...s, read: false, write: true });
                });
                const merged = [...map.values()];
                return (
                  <div className="access-section">
                    <span className="access-section__label">Granted Squads</span>
                    <ul className="access-member-list">
                      {merged.map(s => (
                        <li key={`sq-${s.id}`} className="access-member">
                          <span className="access-member__name">{s.name}</span>
                          <span className="access-member__badges">
                            {s.read && <span className="badge badge-info">read</span>}
                            {s.write && <span className="badge badge-warning">write</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })()}

              {/* Granted users — only those with extra perms beyond squad membership */}
              {(() => {
                const coveredIds = new Set(
                  (data.granted_squad_user_ids || []).map(Number)
                );
                const readExtra = data.read_users.filter(u => !coveredIds.has(u.id));
                const writeExtra = data.write_users.filter(u => !coveredIds.has(u.id));
                if (readExtra.length === 0 && writeExtra.length === 0) return null;
                const map = new Map();
                readExtra.forEach(u => map.set(u.id, { ...u, read: true, write: false }));
                writeExtra.forEach(u => {
                  const existing = map.get(u.id);
                  if (existing) existing.write = true;
                  else map.set(u.id, { ...u, read: false, write: true });
                });
                const merged = [...map.values()];
                return (
                  <div className="access-section">
                    <span className="access-section__label">Granted Users</span>
                    <ul className="access-member-list">
                      {merged.map(u => (
                        <li key={`u-${u.id}`} className="access-member">
                          <span className="access-member__name">{u.name}</span>
                          <span className="access-member__badges">
                            {u.read && <span className="badge badge-info">read</span>}
                            {u.write && <span className="badge badge-warning">write</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })()}

              {!data.owner_squad_name && !hasExplicitGrants && (
                <p className="text-muted text-sm">Only the owner has access.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// --- Archive Browser ---

export default function ArchiveBrowser() {
  const { archiveId } = useParams();
  const [searchParams] = useSearchParams();
  const [archives, setArchives] = useState([]);
  const [expandedArchive, setExpandedArchive] = useState(archiveId ? Number(archiveId) : null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [accessNotice, setAccessNotice] = useState(null);
  const hasAutoExpanded = useRef(false);
  const scrolledRef = useRef(false);
  const { getLogUsers } = usePresence();

  const squadFilter = searchParams.get('squad');

  const visibleArchives = useMemo(() => {
    if (!squadFilter) return archives;
    return archives.filter((archive) => {
      const idCandidates = [archive.squad_id, archive.squadId, archive.squad?.id];
      return idCandidates.some((id) => id !== null && id !== undefined && String(id) === String(squadFilter));
    });
  }, [archives, squadFilter]);

  const loadArchives = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchArchives();
      setArchives(res.archives || []);
    } catch (e) {
      setError(e.body?.message ?? 'Error loading archives.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadArchives(); }, [loadArchives]);

  useEffect(() => {
    if (archiveId) setExpandedArchive(Number(archiveId));
  }, [archiveId]);

  useEffect(() => {
    if (archiveId || hasAutoExpanded.current) return;
    if (archives.length > 0 && expandedArchive === null) {
      setExpandedArchive(archives[0].id);
      hasAutoExpanded.current = true;
    }
  }, [archives, expandedArchive, archiveId]);

  useEffect(() => {
    if (!accessNotice) return undefined;
    const timer = setTimeout(() => setAccessNotice(null), 3500);
    return () => clearTimeout(timer);
  }, [accessNotice]);

  const handleNewArchive = () => {
    showModal(<NewArchiveModal onCreated={loadArchives} squadId={squadFilter} />, 'modal-md');
  };

  const handleDeleteArchive = (archive) => {
    showModal(
      <ConfirmDialog
        title="Delete Archive"
        message={`Delete "${archive.name}" and all its logs? This cannot be undone.`}
        onConfirm={async () => {
          await deleteArchive(archive.id);
          destroyModal();
          if (expandedArchive === archive.id) setExpandedArchive(null);
          loadArchives();
        }}
        onCancel={destroyModal}
      />,
      'modal-md'
    );
  };

  const toggleArchive = (id) => {
    setExpandedArchive((prev) => (prev === id ? null : id));
  };

  if (loading) return <p className="text-muted">Loading archives...</p>;
  if (error) return <p className="form-error">{error}</p>;

  return (
    <div className="archive-management">
      <div className="log-header">
        <h1>Archives</h1>
        <button className="btn btn-primary" onClick={handleNewArchive}>+ New Archive</button>
      </div>

      {accessNotice && <p className="panel-status success">{accessNotice}</p>}

      {squadFilter && (
        <p className="text-muted" style={{ marginBottom: 14 }}>
          Showing archives for the selected squad.
        </p>
      )}

      {!loading && visibleArchives.length > 0 && (
        <p className="text-muted" style={{ marginBottom: 14 }}>
          {visibleArchives.length} archive{visibleArchives.length !== 1 ? 's' : ''}
        </p>
      )}

      {!loading && archives.length === 0 && (
        <div className="empty-state">
          <p>No archives yet. Create one to get started.</p>
        </div>
      )}

      {!loading && archives.length > 0 && visibleArchives.length === 0 && (
        <div className="empty-state">
          <p>No archives matched the selected squad.</p>
        </div>
      )}

      <div className="archive-list-cards">
        {visibleArchives.map((archive) => (
          <div key={archive.id} className={`card ${expandedArchive === archive.id ? 'card--expanded' : ''}`}
            ref={archiveId && archive.id === Number(archiveId) ? (el) => {
              if (el && !scrolledRef.current) {
                scrolledRef.current = true;
                requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
              }
            } : undefined}>
            <div className="card__body" onClick={() => toggleArchive(archive.id)} style={{ cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: '0.8em' }}>{expandedArchive === archive.id ? '▾' : '▸'}</span>
                <h3 className="card__title" style={{ margin: 0 }}>{archive.name}</h3>
              </div>
              <p className="card__meta">
                {archive.squad_name ? `Squad: ${archive.squad_name} · ` : ''}
                Owner: {archive.created_by} · Created: {new Date(archive.created_at).toLocaleDateString()}
              </p>
            </div>

            <div className="card__actions" onClick={(e) => e.stopPropagation()}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => showModal(
                  <RenameArchiveModal archive={archive} onRenamed={loadArchives} />,
                  'modal-md'
                )}
              >
                Rename
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => showModal(
                  <ManageArchiveAccessModal
                    archive={archive}
                    onAccessUpdated={loadArchives}
                    onAccessSaved={setAccessNotice}
                  />,
                  'modal-lg'
                )}
              >
                Manage Access
              </button>
              <button className="btn btn-danger btn-sm" onClick={() => handleDeleteArchive(archive)}>
                Delete
              </button>
            </div>

            {expandedArchive === archive.id && (
              <div className="card__expanded-content archive-card__expanded">
                <ArchiveAccess archiveId={archive.id} />
                <LinkedRepos archiveId={archive.id} />
                <LogTree key={archive.id} archiveId={archive.id} getLogUsers={getLogUsers} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}