/**
 * Cloud Codex - Page Tree Sidebar Component
 *
 * Lightweight tree view of logs within an archive for the ArchiveView page.
 * Similar to a GitHub repo file tree — shows nested pages with active state.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchLogs, createLog, showModal, destroyModal } from '../util';

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
      <h2>New Page</h2>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-form">
        <label htmlFor="log-title">Page Title:</label>
        <input id="log-title" type="text" value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()} />
        <button className="btn btn-primary stretched-button" onClick={handleSubmit}>Create</button>
      </div>
    </div>
  );
}

function TreeItem({ log, depth = 0, activeLogId, onSelect, archiveId, onLogCreated }) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = log.children?.length > 0;
  const isActive = log.id === Number(activeLogId);

  const handleAddSublog = (e) => {
    e.stopPropagation();
    showModal(
      <NewLogModal archiveId={archiveId} parentId={log.id} onCreated={onLogCreated} />,
      'modal-md'
    );
  };

  return (
    <li className="page-tree-item">
      <div
        className={`page-tree-row${isActive ? ' page-tree-row--active' : ''}`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={() => onSelect(log.id)}
      >
        {hasChildren ? (
          <button
            className="page-tree-toggle"
            onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
          >
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="page-tree-dot">•</span>
        )}
        <span className="page-tree-label">{log.title}</span>
        <button className="page-tree-row-add" onClick={handleAddSublog} title="Add subpage">+</button>
      </div>
      {expanded && hasChildren && (
        <ul className="page-tree-children">
          {log.children.map(child => (
            <TreeItem key={child.id} log={child} depth={depth + 1}
              activeLogId={activeLogId} onSelect={onSelect}
              archiveId={archiveId} onLogCreated={onLogCreated} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function PageTree({ archiveId, archiveName, archiveMeta, activeLogId, onSelect, onCollapse }) {
  const navigate = useNavigate();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  // Build the back URL: preserve squad/workspace context if the archive belongs to a squad
  const backUrl = archiveMeta?.squadId
    ? `/archives/${archiveId}?squad=${archiveMeta.squadId}${archiveMeta.workspaceId ? `&workspace=${archiveMeta.workspaceId}` : ''}`
    : `/archives/${archiveId}`;

  const loadLogs = useCallback(async () => {
    if (!archiveId) return;
    setLoading(true);
    try {
      const res = await fetchLogs(archiveId);
      setLogs(res.logs || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [archiveId]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  const handleLogCreated = useCallback((newId) => {
    loadLogs();
    if (newId) onSelect(newId);
  }, [loadLogs, onSelect]);

  const handleNewPage = () => {
    showModal(
      <NewLogModal archiveId={archiveId} parentId={null} onCreated={handleLogCreated} />,
      'modal-md'
    );
  };

  return (
    <div className="page-tree">
      <div className="page-tree-header">
        <button
          className="page-tree-back-btn"
          onClick={() => navigate(backUrl)}
          title="Back to archives"
        >
          ←
        </button>
        <h3 className="page-tree-title">{archiveName || 'Pages'}</h3>
        <div className="page-tree-header-actions">
          <button className="page-tree-add-btn" onClick={handleNewPage} title="New page">+</button>
          {onCollapse && (
            <button className="page-tree-collapse-btn" onClick={onCollapse} title="Collapse tree">◂</button>
          )}
        </div>
      </div>
      {loading ? (
        <p className="page-tree-loading">Loading...</p>
      ) : logs.length === 0 ? (
        <p className="page-tree-empty">No pages yet.</p>
      ) : (
        <ul className="page-tree-list">
          {logs.map(log => (
            <TreeItem key={log.id} log={log} activeLogId={activeLogId} onSelect={onSelect}
              archiveId={archiveId} onLogCreated={handleLogCreated} />
          ))}
        </ul>
      )}
    </div>
  );
}
