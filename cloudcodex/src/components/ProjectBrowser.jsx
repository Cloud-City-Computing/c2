/**
 * Cloud Codex - Project Browser Component
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  fetchProjects, createProject, updateProject, deleteProject,
  fetchPages, createPage, deletePage,
  manageProjectAccess, searchUsers,
  uploadDocument, exportDocument, fetchDocument,
  showModal, destroyModal,
  fetchCommentCount,
} from '../util';
import ConfirmDialog from './ConfirmDialog';
import { toastError } from './Toast';
import usePresence from '../hooks/usePresence';
import PresenceAvatars from './PresenceAvatars';
import CommentManager from './CommentManager';

// --- New Project Form ---

function NewProjectModal({ onCreated, teamId }) {
  const [name, setName] = useState('');
  const [error, setError] = useState(null);

  const handleSubmit = async () => {
    setError(null);
    if (!name.trim()) { setError('Project name is required.'); return; }
    try {
      await createProject(name, teamId || undefined);
      destroyModal();
      onCreated?.();
    } catch (e) {
      setError(e.body?.message ?? 'Error creating project.');
    }
  };

  return (
    <div className="modal-content">
      <span className="close-button" onClick={destroyModal}>&times;</span>
      <h2>New Project</h2>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-form">
        <label htmlFor="project-name">Project Name:</label>
        <input id="project-name" type="text" value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()} />
        <button className="btn btn-primary stretched-button" onClick={handleSubmit}>Create Project</button>
      </div>
    </div>
  );
}

function RenameProjectModal({ project, onRenamed }) {
  const [name, setName] = useState(project.name);
  const [error, setError] = useState(null);

  const handleSubmit = async () => {
    setError(null);
    if (!name.trim()) { setError('Project name is required.'); return; }
    try {
      await updateProject(project.id, name.trim());
      destroyModal();
      onRenamed?.();
    } catch (e) {
      setError(e.body?.message ?? 'Error renaming project.');
    }
  };

  return (
    <div className="modal-content">
      <span className="close-button" onClick={destroyModal}>&times;</span>
      <h2>Rename Project</h2>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-form">
        <label htmlFor="rename-project-name">Project Name:</label>
        <input
          id="rename-project-name"
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

function ManageProjectAccessModal({ project, onAccessUpdated, onAccessSaved }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [perms, setPerms] = useState({ read: true, write: false });
  const [mode, setMode] = useState('add');
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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
        selectedPerms.map((perm) => manageProjectAccess(project.id, selected.id, perm, action))
      );
      const verb = action === 'add' ? 'granted' : 'revoked';
      const labels = selectedPerms.join(' + ');
      const successMessage = `Successfully ${verb} ${labels} access for ${selected.name}.`;
      setStatus(successMessage);
      await new Promise((resolve) => setTimeout(resolve, 900));
      onAccessSaved?.(successMessage);
      destroyModal();
      onAccessUpdated?.();
    } catch (e) {
      setError(e.body?.message ?? 'Error updating project access.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-content">
      <span className="close-button" onClick={destroyModal}>&times;</span>
      <h2>Manage Project Access</h2>
      <p className="text-muted text-sm" style={{ marginBottom: 10 }}>
        Project: <strong>{project.name}</strong>
      </p>
      {error && <p className="form-error">{error}</p>}
      {status && <p className="form-success">{status}</p>}

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
                <li
                  key={user.id}
                  className="user-search__item"
                  onClick={() => {
                    setSelected(user);
                    setResults([]);
                    setQuery(user.email);
                  }}
                >
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
            <button className="btn btn-ghost btn-sm" onClick={() => { setSelected(null); setQuery(''); }}>
              Change
            </button>
          </div>
        )}

        <label style={{ marginTop: 12 }}>Permissions:</label>
        <div className="invite-perms-grid">
          {[
            ['read', 'Read', 'Can view project pages and documents'],
            ['write', 'Write', 'Can edit pages and project content'],
          ].map(([key, label, desc]) => (
            <label key={key} className="invite-perm-toggle">
              <input
                type="checkbox"
                checked={perms[key]}
                onChange={() => togglePerm(key)}
              />
              <div>
                <strong>{label}</strong>
                <p className="text-muted text-sm">{desc}</p>
              </div>
            </label>
          ))}
        </div>

        <label style={{ marginTop: 12 }}>Action:</label>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          className="form-select"
          disabled={submitting}
        >
          <option value="add">Grant selected permissions</option>
          <option value="remove">Revoke selected permissions</option>
        </select>

        <div className="inline-form" style={{ marginTop: 12 }}>
          <button className="btn btn-primary stretched-button" onClick={() => handleAccessUpdate(mode)} disabled={submitting}>
            {submitting ? 'Applying Changes...' : (mode === 'add' ? 'Grant Permissions' : 'Revoke Permissions')}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- New Page Form ---

function NewPageModal({ projectId, parentId, onCreated }) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState(null);

  const handleSubmit = async () => {
    setError(null);
    if (!title.trim()) { setError('Page title is required.'); return; }
    try {
      const res = await createPage(projectId, title, parentId);
      destroyModal();
      onCreated?.(res.pageId);
    } catch (e) {
      setError(e.body?.message ?? 'Error creating page.');
    }
  };

  return (
    <div className="modal-content">
      <span className="close-button" onClick={destroyModal}>&times;</span>
      <h2>New Page</h2>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-form">
        <label htmlFor="page-title">Page Title:</label>
        <input id="page-title" type="text" value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()} />
        <button className="btn btn-primary stretched-button" onClick={handleSubmit}>Create Page</button>
      </div>
    </div>
  );
}

// --- Upload Document Modal ---

function UploadDocumentModal({ projectId, parentId, onUploaded }) {
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    if (!file) { setError('Please select a file.'); return; }
    setUploading(true);
    try {
      const res = await uploadDocument(projectId, file, parentId);
      destroyModal();
      onUploaded?.(res.pageId);
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

// --- Page Tree ---

function PageTreeItem({ page, projectId, depth = 0, onPageCreated, onPageDeleted, getPageUsers }) {
  const [expanded, setExpanded] = useState(depth === 0);
  const [showExport, setShowExport] = useState(false);
  const [commentCount, setCommentCount] = useState(0);
  const exportRef = useRef(null);
  const navigate = useNavigate();
  const activeUsers = getPageUsers(page.id);

  // Load open comment count
  useEffect(() => {
    fetchCommentCount(page.id).then(r => setCommentCount(r.count || 0)).catch(() => {});
  }, [page.id]);

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
        const res = await fetchDocument(page.id);
        await exportDocument(page.id, format, page.title, res.document.html_content);
      } else {
        await exportDocument(page.id, format, page.title, null);
      }
    } catch (e) {
      toastError(e);
    }
  };

  const handleNewSubpage = () => {
    showModal(
      <NewPageModal projectId={projectId} parentId={page.id} onCreated={onPageCreated} />,
      'modal-md'
    );
  };

  const handleDelete = () => {
    showModal(
      <ConfirmDialog
        title="Delete Page"
        message={`Delete "${page.title}"? This cannot be undone.`}
        onConfirm={async () => {
          await deletePage(projectId, page.id);
          destroyModal();
          onPageDeleted?.();
        }}
        onCancel={destroyModal}
      />,
      'modal-md'
    );
  };

  return (
    <li className="page-tree-item" style={{ paddingLeft: `${depth * 16}px` }}>
      <div className="page-tree-row">
        {page.children?.length > 0 && (
          <button className="page-tree-toggle" onClick={() => setExpanded(e => !e)}
            aria-label={expanded ? 'Collapse' : 'Expand'}>
            {expanded ? '▾' : '▸'}
          </button>
        )}
        <span className="page-tree-title" onClick={() => navigate(`/editor/${page.id}`)}>
          {page.title}
        </span>
        <PresenceAvatars users={activeUsers} />
        <div className="page-tree-actions">
          <div className="export-dropdown" ref={exportRef}>
            <button className="page-tree-export" onClick={() => setShowExport(v => !v)} title="Export page">⤓</button>
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
          <button className="page-tree-add" onClick={handleNewSubpage} title="Add subpage">+</button>
          <button className="page-tree-comments" onClick={() => {
            showModal(
              <CommentManager pageId={page.id} pageTitle={page.title} onClose={destroyModal} onNavigate={(c) => { destroyModal(); navigate(`/editor/${page.id}`); }} />,
              'modal-lg'
            );
          }} title="Manage comments">
            💬{commentCount > 0 && <span className="comment-count-badge">{commentCount}</span>}
          </button>
          <button className="page-tree-delete" onClick={handleDelete} title="Delete page">&times;</button>
        </div>
      </div>
      {expanded && page.children?.length > 0 && (
        <ul className="page-tree-children">
          {page.children.map(child => (
            <PageTreeItem key={child.id} page={child} projectId={projectId}
              depth={depth + 1} onPageCreated={onPageCreated} onPageDeleted={onPageDeleted} getPageUsers={getPageUsers} />
          ))}
        </ul>
      )}
    </li>
  );
}

function PageTree({ projectId, onPageCreated, getPageUsers }) {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadPages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPages(projectId);
      setPages(res.pages || []);
    } catch (e) {
      setError(e.body?.message ?? 'Error loading pages.');
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => { loadPages(); }, [loadPages]);

  const handlePageCreated = useCallback((newPageId) => {
    loadPages();
    onPageCreated?.(newPageId);
  }, [loadPages, onPageCreated]);

  const handleNewRootPage = () => {
    showModal(
      <NewPageModal projectId={projectId} parentId={null} onCreated={handlePageCreated} />,
      'modal-md'
    );
  };

  const handleUpload = () => {
    showModal(
      <UploadDocumentModal projectId={projectId} parentId={null} onUploaded={handlePageCreated} />,
      'modal-md'
    );
  };

  if (loading) return <p className="text-muted">Loading pages...</p>;
  if (error) return <p className="form-error">{error}</p>;

  return (
    <div className="page-tree">
      <div className="page-tree-header">
        <button className="btn btn-primary btn-sm" onClick={handleNewRootPage}>+ New Page</button>
        <button className="btn btn-ghost btn-sm" onClick={handleUpload}>Upload Document</button>
      </div>
      {pages.length === 0
        ? <p className="text-muted">No pages yet. Create one to get started.</p>
        : (
          <ul className="page-tree-list">
            {pages.map(page => (
              <PageTreeItem key={page.id} page={page} projectId={projectId}
                onPageCreated={handlePageCreated} onPageDeleted={loadPages} getPageUsers={getPageUsers} />
            ))}
          </ul>
        )
      }
    </div>
  );
}

// --- Project Browser ---

export default function ProjectBrowser() {
  const { projectId } = useParams();
  const [searchParams] = useSearchParams();
  const [projects, setProjects] = useState([]);
  const [expandedProject, setExpandedProject] = useState(projectId ? Number(projectId) : null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [accessNotice, setAccessNotice] = useState(null);
  const hasAutoExpanded = useRef(false);
  const { getPageUsers } = usePresence();

  const teamFilter = searchParams.get('team');

  const visibleProjects = useMemo(() => {
    if (!teamFilter) return projects;
    return projects.filter((project) => {
      const idCandidates = [project.team_id, project.teamId, project.team?.id];
      return idCandidates.some((id) => id !== null && id !== undefined && String(id) === String(teamFilter));
    });
  }, [projects, teamFilter]);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchProjects();
      setProjects(res.projects || []);
    } catch (e) {
      setError(e.body?.message ?? 'Error loading projects.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  useEffect(() => {
    if (projectId) setExpandedProject(Number(projectId));
  }, [projectId]);

  useEffect(() => {
    if (projectId || hasAutoExpanded.current) return;
    if (projects.length > 0 && expandedProject === null) {
      setExpandedProject(projects[0].id);
      hasAutoExpanded.current = true;
    }
  }, [projects, expandedProject, projectId]);

  useEffect(() => {
    if (!accessNotice) return undefined;
    const timer = setTimeout(() => setAccessNotice(null), 3500);
    return () => clearTimeout(timer);
  }, [accessNotice]);

  const handleNewProject = () => {
    showModal(<NewProjectModal onCreated={loadProjects} teamId={teamFilter} />, 'modal-md');
  };

  const handleDeleteProject = (project) => {
    showModal(
      <ConfirmDialog
        title="Delete Project"
        message={`Delete "${project.name}" and all its pages? This cannot be undone.`}
        onConfirm={async () => {
          await deleteProject(project.id);
          destroyModal();
          if (expandedProject === project.id) setExpandedProject(null);
          loadProjects();
        }}
        onCancel={destroyModal}
      />,
      'modal-md'
    );
  };

  const toggleProject = (id) => {
    setExpandedProject((prev) => (prev === id ? null : id));
  };

  if (loading) return <p className="text-muted">Loading projects...</p>;
  if (error) return <p className="form-error">{error}</p>;

  return (
    <div className="project-management">
      <div className="page-header">
        <h1>Projects</h1>
        <button className="btn btn-primary" onClick={handleNewProject}>+ New Project</button>
      </div>

      {accessNotice && <p className="panel-status success">{accessNotice}</p>}

      {teamFilter && (
        <p className="text-muted" style={{ marginBottom: 14 }}>
          Showing projects for the selected team.
        </p>
      )}

      {!loading && visibleProjects.length > 0 && (
        <p className="text-muted" style={{ marginBottom: 14 }}>
          {visibleProjects.length} project{visibleProjects.length !== 1 ? 's' : ''}
        </p>
      )}

      {!loading && projects.length === 0 && (
        <div className="empty-state">
          <p>No projects yet. Create one to get started.</p>
        </div>
      )}

      {!loading && projects.length > 0 && visibleProjects.length === 0 && (
        <div className="empty-state">
          <p>No projects matched the selected team.</p>
        </div>
      )}

      <div className="project-list-cards">
        {visibleProjects.map((project) => (
          <div key={project.id} className={`card ${expandedProject === project.id ? 'card--expanded' : ''}`}>
            <div className="card__body" onClick={() => toggleProject(project.id)} style={{ cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: '0.8em' }}>{expandedProject === project.id ? '▾' : '▸'}</span>
                <h3 className="card__title" style={{ margin: 0 }}>{project.name}</h3>
              </div>
              <p className="card__meta">
                {project.team_name ? `Team: ${project.team_name} · ` : ''}
                Owner: {project.created_by} · Created: {new Date(project.created_at).toLocaleDateString()}
              </p>
            </div>

            <div className="card__actions" onClick={(e) => e.stopPropagation()}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => showModal(
                  <RenameProjectModal project={project} onRenamed={loadProjects} />,
                  'modal-md'
                )}
              >
                Rename
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => showModal(
                  <ManageProjectAccessModal
                    project={project}
                    onAccessUpdated={loadProjects}
                    onAccessSaved={setAccessNotice}
                  />,
                  'modal-lg'
                )}
              >
                Manage Access
              </button>
              <button className="btn btn-danger btn-sm" onClick={() => handleDeleteProject(project)}>
                Delete
              </button>
            </div>

            {expandedProject === project.id && (
              <div className="card__expanded-content project-card__expanded">
                <PageTree key={project.id} projectId={project.id} getPageUsers={getPageUsers} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}