/**
 * Cloud Codex - Project Browser Component
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  fetchProjects, createProject, updateProject, deleteProject,
  fetchPages, createPage, updatePage, deletePage,
  showModal, destroyModal,
} from '../util';
import ConfirmDialog from './ConfirmDialog';

// --- New Project Form ---

function NewProjectModal({ onCreated }) {
  const [name, setName] = useState('');
  const [error, setError] = useState(null);

  const handleSubmit = async () => {
    setError(null);
    if (!name.trim()) { setError('Project name is required.'); return; }
    try {
      await createProject(name);
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

// --- Page Tree ---

function PageTreeItem({ page, projectId, depth = 0, onPageCreated, onPageDeleted }) {
  const [expanded, setExpanded] = useState(depth === 0);
  const navigate = useNavigate();

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
        <div className="page-tree-actions">
          <button className="page-tree-add" onClick={handleNewSubpage} title="Add subpage">+</button>
          <button className="page-tree-delete" onClick={handleDelete} title="Delete page">&times;</button>
        </div>
      </div>
      {expanded && page.children?.length > 0 && (
        <ul className="page-tree-children">
          {page.children.map(child => (
            <PageTreeItem key={child.id} page={child} projectId={projectId}
              depth={depth + 1} onPageCreated={onPageCreated} onPageDeleted={onPageDeleted} />
          ))}
        </ul>
      )}
    </li>
  );
}

function PageTree({ projectId, onPageCreated }) {
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

  if (loading) return <p className="text-muted">Loading pages...</p>;
  if (error) return <p className="form-error">{error}</p>;

  return (
    <div className="page-tree">
      <div className="page-tree-header">
        <button className="btn btn-primary btn-sm" onClick={handleNewRootPage}>+ New Page</button>
      </div>
      {pages.length === 0
        ? <p className="text-muted">No pages yet. Create one above.</p>
        : (
          <ul className="page-tree-list">
            {pages.map(page => (
              <PageTreeItem key={page.id} page={page} projectId={projectId}
                onPageCreated={handlePageCreated} onPageDeleted={loadPages} />
            ))}
          </ul>
        )
      }
    </div>
  );
}

// --- Project Browser ---

export default function ProjectBrowser() {
  const [projects, setProjects] = useState([]);
  const [activeProject, setActiveProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchProjects();
      setProjects(res.projects || []);
      if (res.projects?.length > 0 && !activeProject) {
        setActiveProject(res.projects[0]);
      }
    } catch (e) {
      setError(e.body?.message ?? 'Error loading projects.');
    }
    setLoading(false);
  }, [activeProject]);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  const handleNewProject = () => {
    showModal(<NewProjectModal onCreated={loadProjects} />, 'modal-md');
  };

  const handleDeleteProject = (project) => {
    showModal(
      <ConfirmDialog
        title="Delete Project"
        message={`Delete "${project.name}" and all its pages? This cannot be undone.`}
        onConfirm={async () => {
          await deleteProject(project.id);
          destroyModal();
          if (activeProject?.id === project.id) setActiveProject(null);
          loadProjects();
        }}
        onCancel={destroyModal}
      />,
      'modal-md'
    );
  };

  if (loading) return <p className="text-muted">Loading projects...</p>;
  if (error) return <p className="form-error">{error}</p>;

  return (
    <div className="project-browser">
      <div className="project-browser-sidebar">
        <div className="project-browser-header">
          <p>Projects</p>
          <button className="btn btn-primary btn-sm" onClick={handleNewProject}>+ New</button>
        </div>
        <ul className="project-list">
          {projects.length === 0
            ? <li className="text-muted">No projects yet.</li>
            : projects.map(project => (
              <li key={project.id}
                className={`project-list-item ${activeProject?.id === project.id ? 'active' : ''}`}
                onClick={() => setActiveProject(project)}>
                <span className="project-name">{project.name}</span>
                {project.team_name && <span className="project-team">{project.team_name}</span>}
                <button className="btn btn-danger btn-xs"
                  onClick={(e) => { e.stopPropagation(); handleDeleteProject(project); }}
                  title="Delete project">&times;</button>
              </li>
            ))
          }
        </ul>
      </div>

      <div className="project-browser-content">
        {activeProject
          ? (
            <>
              <div className="project-browser-content-header">
                <h2 className="panel-title">{activeProject.name}</h2>
                <p className="text-muted">
                  Created by {activeProject.created_by} on {new Date(activeProject.created_at).toLocaleDateString()}
                </p>
              </div>
              <PageTree key={activeProject.id} projectId={activeProject.id} />
            </>
          )
          : <p className="text-muted">Select a project to view its pages.</p>
        }
      </div>
    </div>
  );
}