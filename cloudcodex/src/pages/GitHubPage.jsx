/**
 * Cloud Codex - GitHub Integration Page
 *
 * Browse repositories, navigate file trees, view/edit markdown files,
 * commit changes, create branches, and open pull requests.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import StdLayout from '../page_layouts/Std_Layout';
import { apiFetch, timeAgo } from '../util';
import CIStatusBadge from '../components/CIStatusBadge';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ breaks: true, gfm: true });

// ─── Icons ────────────────────────────────────────────

function RepoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z" />
    </svg>
  );
}

function FileIcon({ isMarkdown }) {
  if (isMarkdown) {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ color: 'var(--color-accent, #2ca7db)' }}>
        <path d="M14.85 3H1.15C.52 3 0 3.52 0 4.15v7.69C0 12.48.52 13 1.15 13h13.69c.64 0 1.15-.52 1.15-1.15v-7.7C16 3.52 15.48 3 14.85 3ZM9 11H7V8L5.5 9.92 4 8v3H2V5h2l1.5 2L7 5h2Zm2.99.5L9.5 8H11V5h2v3h1.5Z" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ opacity: 0.5 }}>
      <path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914Z" />
    </svg>
  );
}

function FolderIcon({ open }) {
  return open ? (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ color: 'var(--color-accent, #2ca7db)' }}>
      <path d="M.513 1.513A1.75 1.75 0 0 1 1.75 1h3.5c.464 0 .909.184 1.237.513l.987.987h6.776A1.75 1.75 0 0 1 16 4.25v7.5A1.75 1.75 0 0 1 14.25 14H1.75A1.75 1.75 0 0 1 0 12.25V2.75c0-.464.184-.909.513-1.237Z" />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ opacity: 0.6 }}>
      <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1Z" />
    </svg>
  );
}

function BranchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ opacity: 0.5 }}>
      <path d="M4 4a4 4 0 0 1 8 0v2h.25c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 12.25 15h-8.5A1.75 1.75 0 0 1 2 13.25v-5.5C2 6.784 2.784 6 3.75 6H4Zm8.25 3.5h-8.5a.25.25 0 0 0-.25.25v5.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-5.5a.25.25 0 0 0-.25-.25ZM10.5 6V4a2.5 2.5 0 1 0-5 0v2Z" />
    </svg>
  );
}

function PullRequestIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
    </svg>
  );
}

function ChevronRight() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>;
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.15l-.66 6.6A1.748 1.748 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z" />
    </svg>
  );
}

function RenameIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758ZM11.189 3a.25.25 0 0 0-.354 0L2.226 11.608l-.529 1.852 1.852-.529 8.61-8.61a.25.25 0 0 0 0-.353Z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.07-1.07A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.07 1.07A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z" />
    </svg>
  );
}

function CommitIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M11.93 8.5a4.002 4.002 0 0 1-7.86 0H.75a.75.75 0 0 1 0-1.5h3.32a4.002 4.002 0 0 1 7.86 0h3.32a.75.75 0 0 1 0 1.5Zm-1.43-.75a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" />
      <line x1="10.5" y1="10.5" x2="14" y2="14" />
    </svg>
  );
}

function DiffAddIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ color: '#3fb950' }}>
      <path d="M2.75 9.25a.75.75 0 0 1 0-1.5h4.5v-4.5a.75.75 0 0 1 1.5 0v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5Z" />
    </svg>
  );
}

function DiffRemoveIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ color: '#f85149' }}>
      <path d="M2.75 9.25a.75.75 0 0 1 0-1.5h10.5a.75.75 0 0 1 0 1.5Z" />
    </svg>
  );
}

function ImportIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M2.75 14A1.75 1.75 0 0 1 1 12.25v-2.5a.75.75 0 0 1 1.5 0v2.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25v-2.5a.75.75 0 0 1 1.5 0v2.5A1.75 1.75 0 0 1 13.25 14ZM11.78 4.72a.749.749 0 1 1-1.06 1.06L8.75 3.811V9.5a.75.75 0 0 1-1.5 0V3.811L5.28 5.78a.749.749 0 1 1-1.06-1.06l3.25-3.25a.749.749 0 0 1 1.06 0Z" />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M2.75 14A1.75 1.75 0 0 1 1 12.25v-2.5a.75.75 0 0 1 1.5 0v2.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25v-2.5a.75.75 0 0 1 1.5 0v2.5A1.75 1.75 0 0 1 13.25 14ZM3.22 4.53a.749.749 0 0 1 0-1.06l4.25-4.25a.749.749 0 0 1 1.06 0l4.25 4.25a.749.749 0 1 1-1.06 1.06L8.75 1.561V9.5a.75.75 0 0 1-1.5 0V1.561L4.28 4.53a.749.749 0 0 1-1.06 0Z" />
    </svg>
  );
}

// ─── File Tree Helpers ────────────────────────────────

/**
 * Build a nested tree structure from a flat array of { path, type, ... }
 */
function buildTree(flatItems) {
  const root = { name: '', children: [], type: 'tree' };

  for (const item of flatItems) {
    const parts = item.path.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isLast = i === parts.length - 1;

      if (!current.children) current.children = [];

      if (isLast) {
        current.children.push({ ...item, name });
      } else {
        let folder = current.children.find(c => c.name === name && c.type === 'tree');
        if (!folder) {
          folder = { name, type: 'tree', path: parts.slice(0, i + 1).join('/'), children: [] };
          current.children.push(folder);
        }
        current = folder;
      }
    }
  }

  // Sort: folders first, then files, alphabetically
  const sortTree = (node) => {
    if (node.children) {
      node.children.sort((a, b) => {
        if (a.type === 'tree' && b.type !== 'tree') return -1;
        if (a.type !== 'tree' && b.type === 'tree') return 1;
        return a.name.localeCompare(b.name);
      });
      node.children.forEach(sortTree);
    }
  };
  sortTree(root);
  return root.children;
}

// ─── Repo List View ──────────────────────────────────

function RepoList({ onSelect }) {
  const [repos, setRepos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const searchTimer = useRef(null);

  const loadRepos = useCallback(async (q, p = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: p, per_page: 30 });
      if (q) params.set('q', q);
      const res = await apiFetch('GET', `/api/github/repos?${params}`);
      setRepos(p === 1 ? res.repos : prev => [...prev, ...res.repos]);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadRepos('', 1); }, [loadRepos]);

  const handleSearch = (e) => {
    const val = e.target.value;
    setSearch(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setPage(1);
      loadRepos(val, 1);
    }, 400);
  };

  return (
    <div className="gh-repo-list">
      <div className="gh-repo-list__header">
        <h2>Repositories</h2>
        <input
          type="text"
          placeholder="Search repos..."
          value={search}
          onChange={handleSearch}
          className="gh-search-input"
        />
      </div>
      {loading && repos.length === 0 && <p className="text-muted gh-loading">Loading repositories...</p>}
      <div className="gh-repo-list__items">
        {repos.map(repo => (
          <button key={repo.id} className="gh-repo-card" onClick={() => onSelect(repo)}>
            <div className="gh-repo-card__header">
              <RepoIcon />
              <span className="gh-repo-card__name">{repo.full_name}</span>
              {repo.private && <LockIcon />}
            </div>
            {repo.description && <p className="gh-repo-card__desc">{repo.description}</p>}
            <div className="gh-repo-card__meta">
              {repo.language && <span className="gh-repo-card__lang">{repo.language}</span>}
              <span className="text-muted">{timeAgo(repo.updated_at)}</span>
            </div>
          </button>
        ))}
      </div>
      {repos.length >= page * 30 && (
        <button className="btn btn-ghost btn-sm gh-load-more" onClick={() => {
          const next = page + 1;
          setPage(next);
          loadRepos(search, next);
        }}>
          Load more
        </button>
      )}
    </div>
  );
}

// ─── File Tree View ──────────────────────────────────

function TreeNode({ node, depth = 0, selectedPath, onFileSelect }) {
  const [expanded, setExpanded] = useState(depth < 1);
  const isFolder = node.type === 'tree';
  const isSelected = node.path === selectedPath;

  if (isFolder) {
    return (
      <div className="gh-tree-node">
        <button
          className={`gh-tree-item gh-tree-folder${expanded ? ' expanded' : ''}`}
          style={{ paddingLeft: `${12 + depth * 16}px` }}
          onClick={() => setExpanded(e => !e)}
        >
          <span className={`gh-tree-chevron${expanded ? ' open' : ''}`}><ChevronRight /></span>
          <FolderIcon open={expanded} />
          <span className="gh-tree-name">{node.name}</span>
        </button>
        {expanded && node.children?.map(child => (
          <TreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            onFileSelect={onFileSelect}
          />
        ))}
      </div>
    );
  }

  return (
    <button
      className={`gh-tree-item gh-tree-file${isSelected ? ' selected' : ''}${node.isMarkdown ? ' markdown' : ''}`}
      style={{ paddingLeft: `${28 + depth * 16}px` }}
      onClick={() => onFileSelect(node)}
    >
      <FileIcon isMarkdown={node.isMarkdown} />
      <span className="gh-tree-name">{node.name}</span>
    </button>
  );
}

// ─── Breadcrumb ──────────────────────────────────────

function Breadcrumb({ owner, repo, filePath, onNavigate }) {
  const parts = filePath ? filePath.split('/') : [];
  return (
    <div className="gh-breadcrumb">
      <button className="gh-breadcrumb__link" onClick={() => onNavigate(null)}>{owner}/{repo}</button>
      {parts.map((part, i) => (
        <span key={i}>
          <span className="gh-breadcrumb__sep">/</span>
          {i === parts.length - 1 ? (
            <span className="gh-breadcrumb__current">{part}</span>
          ) : (
            <button className="gh-breadcrumb__link" onClick={() => onNavigate(parts.slice(0, i + 1).join('/'))}>
              {part}
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

// ─── Markdown Viewer ──────────────────────────────────

function MarkdownViewer({ content }) {
  const html = useMemo(() => {
    return DOMPurify.sanitize(marked.parse(content || ''));
  }, [content]);

  return (
    <div className="gh-markdown-preview" dangerouslySetInnerHTML={{ __html: html }} />
  );
}

// ─── Markdown Editor ──────────────────────────────────

const MarkdownEditorPane = React.memo(function MarkdownEditorPane({ content, onChange }) {
  const [previewHtml, setPreviewHtml] = useState(() =>
    DOMPurify.sanitize(marked.parse(content || ''))
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      setPreviewHtml(DOMPurify.sanitize(marked.parse(content || '')));
    }, 300);
    return () => clearTimeout(timer);
  }, [content]);

  return (
    <div className="gh-editor-split">
      <div className="gh-editor-split__edit">
        <textarea
          className="gh-editor-textarea"
          value={content}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === 'Tab') {
              e.preventDefault();
              const { selectionStart, selectionEnd } = e.target;
              const val = e.target.value;
              const newVal = val.substring(0, selectionStart) + '  ' + val.substring(selectionEnd);
              onChange(newVal);
              requestAnimationFrame(() => {
                e.target.selectionStart = e.target.selectionEnd = selectionStart + 2;
              });
            }
          }}
        />
      </div>
      <div className="gh-editor-split__preview">
        <div className="gh-markdown-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
      </div>
    </div>
  );
});

// ─── Commit Modal ─────────────────────────────────────

function CommitPanel({ owner, repo, filePath, fileSha, content, branch, onCommitted, onClose }) {
  const [mode, setMode] = useState('direct'); // 'direct' | 'branch'
  const [message, setMessage] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [createPR, setCreatePR] = useState(true);
  const [prTitle, setPrTitle] = useState('');
  const [draftPr, setDraftPr] = useState(false);
  const [reviewers, setReviewers] = useState('');
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const modalBodyRef = useRef(null);

  useEffect(() => {
    if (result || error) modalBodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [result, error]);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape' && !committing) onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [committing, onClose]);

  const handleCommit = async () => {
    setError(null);
    setResult(null);

    const commitMsg = message.trim() || `Update ${filePath}`;
    let targetBranch = branch;

    if (mode === 'branch') {
      if (!newBranchName.trim()) {
        setError('Branch name is required');
        return;
      }
      // Create branch first
      try {
        await apiFetch('POST', `/api/github/repos/${owner}/${repo}/branches`, {
          name: newBranchName.trim(),
          from_ref: branch,
        });
        targetBranch = newBranchName.trim();
      } catch (e) {
        setError(e.body?.message || 'Failed to create branch');
        return;
      }
    }

    setCommitting(true);
    try {
      const commitRes = await apiFetch('PUT', `/api/github/repos/${owner}/${repo}/contents/${filePath}`, {
        content,
        message: commitMsg,
        branch: targetBranch,
        sha: fileSha,
      });

      // Optionally create PR
      if (mode === 'branch' && createPR) {
        const title = prTitle.trim() || commitMsg;
        const reviewerList = reviewers
          .split(/[,\s]+/)
          .map((s) => s.trim().replace(/^@/, ''))
          .filter(Boolean);
        try {
          const prRes = await apiFetch('POST', `/api/github/repos/${owner}/${repo}/pulls`, {
            title,
            body: `Updated \`${filePath}\` via Cloud Codex`,
            head: targetBranch,
            base: branch,
            draft: draftPr,
            reviewers: reviewerList,
          });
          setResult({
            type: 'pr',
            message: `Pull request #${prRes.pull.number} created`,
            url: prRes.pull.html_url,
            commitUrl: commitRes.commit.html_url,
          });
        } catch (e) {
          // PR failed but commit succeeded
          setResult({
            type: 'commit',
            message: `Committed to ${targetBranch} (PR creation failed: ${e.body?.message || e.message})`,
            url: commitRes.commit.html_url,
          });
        }
      } else {
        setResult({
          type: 'commit',
          message: `Committed to ${targetBranch}`,
          url: commitRes.commit.html_url,
        });
      }

      onCommitted(commitRes.content.sha, targetBranch);
    } catch (e) {
      setError(e.body?.message || 'Commit failed');
    }
    setCommitting(false);
  };

  return (
    <div className="gh-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget && !committing) onClose(); }}>
      <div className="gh-modal">
        <div className="gh-modal__header">
          <h3>Commit changes</h3>
          <button className="gh-modal__close" onClick={onClose} disabled={committing} aria-label="Close">&times;</button>
        </div>

        <div className="gh-modal__body" ref={modalBodyRef}>
          {error && <p className="form-error">{error}</p>}
          {result && (
            <div className={`gh-commit-result ${result.type}`}>
              <p>{result.message}</p>
              <a href={result.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
                View on GitHub
              </a>
              {result.commitUrl && (
                <a href={result.commitUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
                  View commit
                </a>
              )}
            </div>
          )}

          <div className="gh-commit-mode">
            <label className={`gh-commit-option${mode === 'direct' ? ' active' : ''}`}>
              <input type="radio" name="commit-mode" checked={mode === 'direct'} onChange={() => setMode('direct')} />
              <span>Commit directly to <strong>{branch}</strong></span>
            </label>
            <label className={`gh-commit-option${mode === 'branch' ? ' active' : ''}`}>
              <input type="radio" name="commit-mode" checked={mode === 'branch'} onChange={() => setMode('branch')} />
              <span>Create a new branch and commit</span>
            </label>
          </div>

          {mode === 'branch' && (
            <div className="gh-commit-branch-fields">
              <div className="gh-field">
                <label className="gh-field__label">Branch name</label>
                <input
                  type="text"
                  placeholder="e.g. docs/update-readme"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value.replace(/\s/g, '-'))}
                  className="gh-input"
                />
              </div>
              <label className="gh-commit-pr-check">
                <input type="checkbox" checked={createPR} onChange={(e) => setCreatePR(e.target.checked)} />
                <span>Create a pull request</span>
              </label>
              {createPR && (
                <>
                  <div className="gh-field">
                    <label className="gh-field__label">PR title</label>
                    <input
                      type="text"
                      placeholder="Optional — defaults to commit message"
                      value={prTitle}
                      onChange={(e) => setPrTitle(e.target.value)}
                      className="gh-input"
                    />
                  </div>
                  <label className="gh-commit-pr-check">
                    <input type="checkbox" checked={draftPr} onChange={(e) => setDraftPr(e.target.checked)} />
                    <span>Open as draft</span>
                  </label>
                  <div className="gh-field">
                    <label className="gh-field__label">Reviewers <span className="text-muted">(GitHub usernames, comma-separated)</span></label>
                    <input
                      type="text"
                      placeholder="alice, bob, octocat"
                      value={reviewers}
                      onChange={(e) => setReviewers(e.target.value)}
                      className="gh-input"
                    />
                  </div>
                </>
              )}
            </div>
          )}

          <div className="gh-field">
            <label className="gh-field__label">Commit message</label>
            <input
              type="text"
              placeholder={`Update ${filePath}`}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="gh-input"
              onKeyDown={(e) => e.key === 'Enter' && !committing && handleCommit()}
              autoFocus
            />
          </div>
        </div>

        <div className="gh-modal__footer">
          <button className="btn btn-ghost" onClick={onClose} disabled={committing}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleCommit}
            disabled={committing}
          >
            {committing ? 'Committing...' : mode === 'branch' && createPR ? 'Commit & Create PR' : 'Commit changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── New File Modal ───────────────────────────────────

function NewFileModal({ owner, repo, branch, branches, onCreated, onClose, initialContent, initialPath, githubLink, exportLogId, repoTree }) {
  const isLinked = Boolean(githubLink);
  const [filePath, setFilePath] = useState(initialPath || '');
  const [content, setContent] = useState(initialContent || '');
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState('direct'); // 'direct' | 'switch' | 'branch'
  const [targetBranch, setTargetBranch] = useState(branch);
  const [newBranchName, setNewBranchName] = useState('');
  const [createPR, setCreatePR] = useState(true);
  const [prTitle, setPrTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const modalBodyRef = useRef(null);

  // File picker state: 'new' = type a new path, 'existing' = pick from tree
  const [fileMode, setFileMode] = useState(isLinked ? 'existing' : 'new');
  const [selectedSha, setSelectedSha] = useState(isLinked ? githubLink.file_sha : null);
  const [pickerFilter, setPickerFilter] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  const hasWork = filePath.trim() || content.trim() || message.trim() || newBranchName.trim();

  useEffect(() => {
    if (result || error) modalBodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [result, error]);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape' && !creating) {
        if (hasWork && !result) {
          // eslint-disable-next-line no-alert
          if (!window.confirm('You have unsaved work. Discard and close?')) return;
        }
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [creating, onClose, hasWork, result]);

  const isMarkdown = /\.(md|mdx|markdown)$/i.test(filePath);

  const isUpdate = fileMode === 'existing' && Boolean(selectedSha);
  const defaultMsg = isUpdate ? `Update ${filePath.trim() || 'file'}` : `Create ${filePath.trim() || 'new file'}`;

  const handleCreate = async () => {
    const trimmed = filePath.trim().replace(/^\//, '');
    if (!trimmed) {
      setError('File path is required');
      return;
    }
    setError(null);
    setResult(null);

    let commitBranch = branch;

    if (mode === 'switch') {
      commitBranch = targetBranch;
    } else if (mode === 'branch') {
      if (!newBranchName.trim()) {
        setError('Branch name is required');
        return;
      }
      // Create branch first
      try {
        await apiFetch('POST', `/api/github/repos/${owner}/${repo}/branches`, {
          name: newBranchName.trim(),
          from_ref: branch,
        });
        commitBranch = newBranchName.trim();
      } catch (e) {
        setError(e.body?.message || 'Failed to create branch');
        return;
      }
    }

    setCreating(true);
    try {
      const commitMsg = message.trim() || defaultMsg;
      const payload = {
        content,
        message: commitMsg,
        branch: commitBranch,
      };

      // Include sha for updates to existing files
      if (isUpdate && selectedSha) {
        payload.sha = selectedSha;
      }

      const commitRes = await apiFetch('PUT', `/api/github/repos/${owner}/${repo}/contents/${trimmed}`, payload);

      // Save/update the github link for this document
      if (exportLogId) {
        apiFetch('PUT', `/api/github/link/${exportLogId}`, {
          repo_owner: owner,
          repo_name: repo,
          file_path: trimmed,
          branch: commitBranch,
          file_sha: commitRes.content.sha,
        }).catch(() => {}); // fire-and-forget
      }

      // Optionally create PR when using a new branch
      if (mode === 'branch' && createPR) {
        const title = prTitle.trim() || commitMsg;
        try {
          const prRes = await apiFetch('POST', `/api/github/repos/${owner}/${repo}/pulls`, {
            title,
            body: `${isUpdate ? 'Updated' : 'Created'} \`${trimmed}\` via Cloud Codex`,
            head: commitBranch,
            base: branch,
          });
          setResult({
            type: 'pr',
            message: `File ${isUpdate ? 'updated' : 'created'} & PR #${prRes.pull.number} opened`,
            url: prRes.pull.html_url,
            commitUrl: commitRes.commit.html_url,
          });
        } catch (e) {
          setResult({
            type: 'commit',
            message: `${isUpdate ? 'Updated' : 'Created'} on ${commitBranch} (PR failed: ${e.body?.message || e.message})`,
            url: commitRes.commit.html_url,
          });
        }
        setCreating(false);
        return; // Keep modal open to show result
      }

      onCreated(trimmed, commitBranch);
    } catch (e) {
      setError(e.body?.message || `Failed to ${isUpdate ? 'update' : 'create'} file`);
    }
    setCreating(false);
  };

  const handleBackdropClick = (e) => {
    if (e.target !== e.currentTarget || creating) return;
    if (hasWork && !result) {
      // eslint-disable-next-line no-alert
      if (!window.confirm('You have unsaved work. Discard and close?')) return;
    }
    onClose();
  };

  const actionLabel = isUpdate
    ? (creating ? 'Updating...' : mode === 'branch' && createPR ? 'Update file & Open PR' : 'Update file')
    : (creating ? 'Creating...' : mode === 'branch' && createPR ? 'Create file & Open PR' : 'Create file');

  // Filter repo tree to files only for the picker
  const treeFiles = (repoTree || []).filter(f => f.type === 'blob');
  const filteredFiles = pickerFilter
    ? treeFiles.filter(f => f.path.toLowerCase().includes(pickerFilter.toLowerCase()))
    : treeFiles;

  const handlePickFile = (file) => {
    setFilePath(file.path);
    setSelectedSha(file.sha);
    setPickerOpen(false);
    setPickerFilter('');
  };

  const handleSwitchToNew = () => {
    setFileMode('new');
    setSelectedSha(null);
    setFilePath(initialPath || '');
    setPickerOpen(false);
    setPickerFilter('');
  };

  const handleSwitchToExisting = () => {
    setFileMode('existing');
    if (!selectedSha) setPickerOpen(true);
  };

  return (
    <div className="gh-modal-backdrop" onClick={handleBackdropClick}>
      <div className="gh-modal gh-modal--wide">
        <div className="gh-modal__header">
          <h3>{isUpdate ? 'Update on GitHub' : initialContent ? 'Push to GitHub' : 'Create new file'}</h3>
          <button className="gh-modal__close" onClick={handleBackdropClick} disabled={creating} aria-label="Close">&times;</button>
        </div>

        <div className="gh-modal__body" ref={modalBodyRef}>
          {error && <p className="form-error">{error}</p>}
          {result && (
            <div className={`gh-commit-result ${result.type}`}>
              <p>{result.message}</p>
              <a href={result.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
                View on GitHub
              </a>
              {result.commitUrl && (
                <a href={result.commitUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
                  View commit
                </a>
              )}
            </div>
          )}

          <div className="gh-field">
            <label className="gh-field__label">File path</label>
            {repoTree && repoTree.length > 0 && (
              <div className="gh-file-mode-tabs">
                <button className={`gh-file-mode-tab${fileMode === 'new' ? ' active' : ''}`} onClick={handleSwitchToNew} type="button">New file</button>
                <button className={`gh-file-mode-tab${fileMode === 'existing' ? ' active' : ''}`} onClick={handleSwitchToExisting} type="button">Update existing</button>
              </div>
            )}

            {fileMode === 'existing' && selectedSha ? (
              <div className="gh-linked-path">
                <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M3.75 1.5a.25.25 0 00-.25.25v12.5c0 .138.112.25.25.25h8.5a.25.25 0 00.25-.25V4.664a.25.25 0 00-.073-.177l-2.914-2.914a.25.25 0 00-.177-.073H3.75zM2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0112.25 16h-8.5A1.75 1.75 0 012 14.25V1.75z" /></svg>
                <code>{filePath}</code>
                <button className="gh-linked-path__change" onClick={() => { setPickerOpen(true); setPickerFilter(''); }} type="button">Change</button>
              </div>
            ) : fileMode === 'existing' ? (
              <div className="gh-file-picker-placeholder" onClick={() => setPickerOpen(true)}>
                Click to select a file from the repository...
              </div>
            ) : (
              <input
                type="text"
                placeholder="e.g. docs/guide.md"
                value={filePath}
                onChange={(e) => { setFilePath(e.target.value); setSelectedSha(null); }}
                className="gh-input"
                autoFocus
              />
            )}

            {fileMode === 'existing' && pickerOpen && (
              <div className="gh-file-picker">
                <input
                  type="text"
                  placeholder="Search files..."
                  value={pickerFilter}
                  onChange={(e) => setPickerFilter(e.target.value)}
                  className="gh-input gh-file-picker__search"
                  autoFocus
                />
                <ul className="gh-file-picker__list">
                  {filteredFiles.length === 0 ? (
                    <li className="gh-file-picker__empty">No files match</li>
                  ) : filteredFiles.slice(0, 100).map(f => (
                    <li
                      key={f.path}
                      className={`gh-file-picker__item${f.path === filePath ? ' selected' : ''}`}
                      onClick={() => handlePickFile(f)}
                    >
                      {f.path}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <span className="gh-field__hint">
              {fileMode === 'existing' && selectedSha
                ? 'This will overwrite the existing file with the new content'
                : fileMode === 'new' ? 'Use forward slashes to create files in subdirectories' : ''}
            </span>
          </div>

          <div className="gh-field">
            <label className="gh-field__label">Content {isMarkdown && <span className="text-muted text-sm">(Markdown)</span>}</label>
            {isMarkdown ? (
              <MarkdownEditorPane content={content} onChange={setContent} />
            ) : (
              <textarea
                className="gh-editor-textarea gh-editor-textarea--plain gh-newfile-textarea"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="File content (can be empty)"
                spellCheck={false}
              />
            )}
          </div>

          {/* Branch / PR options */}
          <div className="gh-commit-mode">
            <label className={`gh-commit-option${mode === 'direct' ? ' active' : ''}`}>
              <input type="radio" name="newfile-mode" checked={mode === 'direct'} onChange={() => setMode('direct')} />
              <span>Commit directly to <strong>{branch}</strong></span>
            </label>
            {branches && branches.length > 1 && (
              <label className={`gh-commit-option${mode === 'switch' ? ' active' : ''}`}>
                <input type="radio" name="newfile-mode" checked={mode === 'switch'} onChange={() => setMode('switch')} />
                <span>Commit to a different branch</span>
              </label>
            )}
            <label className={`gh-commit-option${mode === 'branch' ? ' active' : ''}`}>
              <input type="radio" name="newfile-mode" checked={mode === 'branch'} onChange={() => setMode('branch')} />
              <span>Create a new branch and commit</span>
            </label>
          </div>

          {mode === 'switch' && branches && (
            <div className="gh-commit-branch-fields">
              <div className="gh-field">
                <label className="gh-field__label">Target branch</label>
                <select value={targetBranch} onChange={(e) => setTargetBranch(e.target.value)} className="gh-branch-select">
                  {branches.map(b => (
                    <option key={b.name} value={b.name}>{b.name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {mode === 'branch' && (
            <div className="gh-commit-branch-fields">
              <div className="gh-field">
                <label className="gh-field__label">Branch name</label>
                <input
                  type="text"
                  placeholder="e.g. docs/add-guide"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value.replace(/\s/g, '-'))}
                  className="gh-input"
                />
                <span className="gh-field__hint">Will branch from <strong>{branch}</strong></span>
              </div>
              <label className="gh-commit-pr-check">
                <input type="checkbox" checked={createPR} onChange={(e) => setCreatePR(e.target.checked)} />
                <span>Create a pull request</span>
              </label>
              {createPR && (
                <div className="gh-field">
                  <label className="gh-field__label">PR title</label>
                  <input
                    type="text"
                    placeholder="Optional — defaults to commit message"
                    value={prTitle}
                    onChange={(e) => setPrTitle(e.target.value)}
                    className="gh-input"
                  />
                </div>
              )}
            </div>
          )}

          <div className="gh-field">
            <label className="gh-field__label">Commit message</label>
            <input
              type="text"
              placeholder={defaultMsg}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="gh-input"
              onKeyDown={(e) => e.key === 'Enter' && !creating && handleCreate()}
            />
          </div>
        </div>

        <div className="gh-modal__footer">
          <button className="btn btn-ghost" onClick={onClose} disabled={creating}>Cancel</button>
          <button className="btn btn-primary" onClick={handleCreate} disabled={creating || !filePath.trim()}>
            {actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Delete File Modal ────────────────────────────────

function DeleteFileModal({ owner, repo, filePath, fileSha, branch, onDeleted, onClose }) {
  const [message, setMessage] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape' && !deleting) onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [deleting, onClose]);

  const handleDelete = async () => {
    setError(null);
    setDeleting(true);
    try {
      const commitMsg = message.trim() || `Delete ${filePath}`;
      await apiFetch('DELETE', `/api/github/repos/${owner}/${repo}/contents/${filePath}`, {
        message: commitMsg,
        branch,
        sha: fileSha,
      });
      onDeleted();
    } catch (e) {
      setError(e.body?.message || 'Failed to delete file');
    }
    setDeleting(false);
  };

  return (
    <div className="gh-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget && !deleting) onClose(); }}>
      <div className="gh-modal">
        <div className="gh-modal__header">
          <h3>Delete file</h3>
          <button className="gh-modal__close" onClick={onClose} disabled={deleting} aria-label="Close">&times;</button>
        </div>

        <div className="gh-modal__body">
          {error && <p className="form-error">{error}</p>}

          <p>Are you sure you want to delete <strong>{filePath}</strong>?</p>
          <p className="text-muted text-sm">This will create a commit on <strong>{branch}</strong> removing this file.</p>

          <div className="gh-field" style={{ marginTop: 16 }}>
            <label className="gh-field__label">Commit message</label>
            <input
              type="text"
              placeholder={`Delete ${filePath}`}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="gh-input"
              onKeyDown={(e) => e.key === 'Enter' && !deleting && handleDelete()}
              autoFocus
            />
          </div>
        </div>

        <div className="gh-modal__footer">
          <button className="btn btn-ghost" onClick={onClose} disabled={deleting}>Cancel</button>
          <button className="btn btn-danger" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete file'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Rename/Move File Modal ──────────────────────────

function RenameFileModal({ owner, repo, filePath, branch, onRenamed, onClose }) {
  const [newPath, setNewPath] = useState(filePath);
  const [message, setMessage] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape' && !renaming) onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [renaming, onClose]);

  const handleRename = async () => {
    const trimmed = newPath.trim().replace(/^\//, '');
    if (!trimmed) {
      setError('New path is required');
      return;
    }
    if (trimmed === filePath) {
      setError('New path must differ from the current path');
      return;
    }
    setError(null);
    setRenaming(true);
    try {
      const commitMsg = message.trim() || `Rename ${filePath} → ${trimmed}`;
      await apiFetch('POST', `/api/github/repos/${owner}/${repo}/rename`, {
        oldPath: filePath,
        newPath: trimmed,
        message: commitMsg,
        branch,
      });
      onRenamed(trimmed);
    } catch (e) {
      setError(e.body?.message || 'Failed to rename file');
    }
    setRenaming(false);
  };

  return (
    <div className="gh-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget && !renaming) onClose(); }}>
      <div className="gh-modal">
        <div className="gh-modal__header">
          <h3>Rename / Move file</h3>
          <button className="gh-modal__close" onClick={onClose} disabled={renaming} aria-label="Close">&times;</button>
        </div>

        <div className="gh-modal__body">
          {error && <p className="form-error">{error}</p>}

          <div className="gh-field">
            <label className="gh-field__label">Current path</label>
            <input type="text" value={filePath} className="gh-input" disabled />
          </div>

          <div className="gh-field">
            <label className="gh-field__label">New path</label>
            <input
              type="text"
              placeholder="e.g. docs/new-name.md"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              className="gh-input"
              autoFocus
            />
            <span className="gh-field__hint">Change the directory to move, or change the filename to rename</span>
          </div>

          <div className="gh-field">
            <label className="gh-field__label">Commit message</label>
            <input
              type="text"
              placeholder={`Rename ${filePath}`}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="gh-input"
              onKeyDown={(e) => e.key === 'Enter' && !renaming && handleRename()}
            />
          </div>

          <p className="text-muted text-sm">Committing to <strong>{branch}</strong></p>
        </div>

        <div className="gh-modal__footer">
          <button className="btn btn-ghost" onClick={onClose} disabled={renaming}>Cancel</button>
          <button className="btn btn-primary" onClick={handleRename} disabled={renaming || newPath.trim() === filePath || !newPath.trim()}>
            {renaming ? 'Renaming...' : 'Rename file'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Diff Viewer ──────────────────────────────────────

/**
 * Parse a unified diff patch string into structured hunks.
 * Each hunk: { header, oldStart, oldLines, newStart, newLines, lines[] }
 * Each line: { type: 'add'|'del'|'ctx', oldNum, newNum, content }
 */
function parsePatch(patch) {
  if (!patch) return [];
  const rawLines = patch.split('\n');
  const hunks = [];
  let current = null;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of rawLines) {
    const hunkMatch = raw.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)/);
    if (hunkMatch) {
      current = {
        header: raw,
        oldStart: parseInt(hunkMatch[1], 10),
        oldLines: hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1,
        newStart: parseInt(hunkMatch[3], 10),
        newLines: hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1,
        context: hunkMatch[5] || '',
        lines: [],
      };
      hunks.push(current);
      oldLine = current.oldStart;
      newLine = current.newStart;
      continue;
    }
    if (!current) continue;
    if (raw.startsWith('+')) {
      current.lines.push({ type: 'add', oldNum: null, newNum: newLine, content: raw.slice(1) });
      newLine++;
    } else if (raw.startsWith('-')) {
      current.lines.push({ type: 'del', oldNum: oldLine, newNum: null, content: raw.slice(1) });
      oldLine++;
    } else if (raw.startsWith('\\')) {
      // "\ No newline at end of file" — skip
      continue;
    } else {
      current.lines.push({ type: 'ctx', oldNum: oldLine, newNum: newLine, content: raw.startsWith(' ') ? raw.slice(1) : raw });
      oldLine++;
      newLine++;
    }
  }
  return hunks;
}

function DiffViewer({ patch, filename, status, additions, deletions }) {
  const hunks = useMemo(() => parsePatch(patch), [patch]);
  const [collapsed, setCollapsed] = useState(false);

  if (!patch) {
    return (
      <div className="gh-diff">
        <div className="gh-diff__file-header">
          <span className={`gh-history__file-status gh-history__file-status--${status}`}>
            {status === 'added' ? 'A' : status === 'removed' ? 'D' : status === 'renamed' ? 'R' : 'M'}
          </span>
          <span className="gh-diff__filename">{filename}</span>
          <span className="gh-diff__no-preview">Binary file or no diff available</span>
        </div>
      </div>
    );
  }

  return (
    <div className="gh-diff">
      <button className="gh-diff__file-header" onClick={() => setCollapsed(c => !c)}>
        <span className="gh-diff__collapse-icon">{collapsed ? '▸' : '▾'}</span>
        <span className={`gh-history__file-status gh-history__file-status--${status}`}>
          {status === 'added' ? 'A' : status === 'removed' ? 'D' : status === 'renamed' ? 'R' : 'M'}
        </span>
        <span className="gh-diff__filename">{filename}</span>
        <span className="gh-diff__file-stats">
          {additions > 0 && <span className="gh-history__stat-add">+{additions}</span>}
          {deletions > 0 && <span className="gh-history__stat-del">-{deletions}</span>}
        </span>
      </button>

      {!collapsed && (
        <div className="gh-diff__body">
          {hunks.map((hunk, hi) => (
            <div key={hi} className="gh-diff__hunk">
              <div className="gh-diff__hunk-header">
                <span>{hunk.header.split('@@').slice(0, 2).join('@@')} @@</span>
                {hunk.context && <span className="gh-diff__hunk-ctx">{hunk.context}</span>}
              </div>
              <table className="gh-diff__table">
                <tbody>
                  {hunk.lines.map((line, li) => (
                    <tr key={li} className={`gh-diff__line gh-diff__line--${line.type}`}>
                      <td className="gh-diff__line-num gh-diff__line-num--old">{line.oldNum ?? ''}</td>
                      <td className="gh-diff__line-num gh-diff__line-num--new">{line.newNum ?? ''}</td>
                      <td className="gh-diff__line-marker">
                        {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
                      </td>
                      <td className="gh-diff__line-content">
                        <pre>{line.content}</pre>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DiffPanel({ files, onClose, commitSha: _commitSha, title }) {
  const [search, setSearch] = useState('');

  const filtered = search.trim()
    ? files.filter(f => f.filename.toLowerCase().includes(search.toLowerCase()))
    : files;

  const totalAdd = files.reduce((s, f) => s + (f.additions || 0), 0);
  const totalDel = files.reduce((s, f) => s + (f.deletions || 0), 0);

  return (
    <div className="gh-diff-panel">
      <div className="gh-diff-panel__header">
        <div className="gh-diff-panel__title">
          <DiffAddIcon />
          <h3>Files changed</h3>
          {title && <span className="gh-diff-panel__subtitle">{title}</span>}
        </div>
        <div className="gh-diff-panel__summary">
          <span>{files.length} file{files.length !== 1 ? 's' : ''}</span>
          <span className="gh-history__stat-add">+{totalAdd}</span>
          <span className="gh-history__stat-del">-{totalDel}</span>
        </div>
        {onClose && <button className="gh-modal__close" onClick={onClose} aria-label="Close">&times;</button>}
      </div>

      {files.length > 3 && (
        <div className="gh-diff-panel__search">
          <SearchIcon />
          <input
            type="text"
            placeholder="Filter files..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="gh-input gh-input--sm"
          />
        </div>
      )}

      <div className="gh-diff-panel__files">
        {filtered.map(f => (
          <DiffViewer
            key={f.filename}
            patch={f.patch}
            filename={f.filename}
            status={f.status}
            additions={f.additions}
            deletions={f.deletions}
          />
        ))}
        {filtered.length === 0 && search && (
          <p className="text-muted gh-loading">No files matching "{search}"</p>
        )}
      </div>
    </div>
  );
}

// ─── Commit History Panel ─────────────────────────────

function CommitHistory({ owner, repo, filePath, branch, branches, onClose, fullWidth, onFileClick, pr }) {
  const [commits, setCommits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState('');
  const [authorFilter, setAuthorFilter] = useState('');
  const [targetRef, setTargetRef] = useState(branch);
  const [expandedSha, setExpandedSha] = useState(null);
  const [commitDetail, setCommitDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showDiffSha, setShowDiffSha] = useState(null);
  const searchTimer = useRef(null);
  const PER_PAGE = 30;

  const loadCommits = useCallback(async (ref, authorQ, p = 1, append = false) => {
    setLoading(true);
    try {
      let res;
      if (pr) {
        // Load commits from a PR
        res = await apiFetch('GET', `/api/github/repos/${owner}/${repo}/pulls/${pr.number}/commits?per_page=${PER_PAGE}&page=${p}`);
      } else {
        const params = new URLSearchParams({ sha: ref, per_page: PER_PAGE, page: p });
        if (filePath) params.set('path', filePath);
        if (authorQ) params.set('author', authorQ);
        res = await apiFetch('GET', `/api/github/repos/${owner}/${repo}/commits?${params}`);
      }
      if (append) {
        setCommits(prev => [...prev, ...res.commits]);
      } else {
        setCommits(res.commits);
      }
      setHasMore(res.commits.length >= PER_PAGE);
    } catch {
      if (!append) setCommits([]);
      setHasMore(false);
    }
    setLoading(false);
  }, [owner, repo, filePath, pr]);

  // Initial load & reload on filters
  useEffect(() => {
    setPage(1);
    setExpandedSha(null);
    setCommitDetail(null);
    loadCommits(targetRef, authorFilter, 1);
  }, [targetRef, authorFilter, loadCommits]);

  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    loadCommits(targetRef, authorFilter, nextPage, true);
  };

  const handleSearchChange = (e) => {
    setSearch(e.target.value);
  };

  const handleAuthorChange = (e) => {
    const val = e.target.value;
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setAuthorFilter(val.trim());
    }, 400);
  };

  const handleToggleDetail = async (sha) => {
    if (expandedSha === sha) {
      setExpandedSha(null);
      setCommitDetail(null);
      return;
    }
    setExpandedSha(sha);
    setCommitDetail(null);
    setDetailLoading(true);
    try {
      const res = await apiFetch('GET', `/api/github/repos/${owner}/${repo}/commits/${sha}`);
      setCommitDetail(res.commit);
    } catch { /* ignore */ }
    setDetailLoading(false);
  };

  // Client-side search filter on message/author
  const filtered = search.trim()
    ? commits.filter(c => {
        const q = search.toLowerCase();
        return c.message.toLowerCase().includes(q) ||
               c.author.name.toLowerCase().includes(q) ||
               (c.author.login || '').toLowerCase().includes(q) ||
               c.sha.startsWith(q);
      })
    : commits;

  // Group commits by date
  const grouped = useMemo(() => {
    const groups = [];
    let currentDate = null;
    for (const c of filtered) {
      const date = new Date(c.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      if (date !== currentDate) {
        currentDate = date;
        groups.push({ date, commits: [c] });
      } else {
        groups[groups.length - 1].commits.push(c);
      }
    }
    return groups;
  }, [filtered]);

  return (
    <div className={`gh-history${fullWidth ? ' gh-history--full' : ''}`}>
      <div className="gh-history__header">
        <div className="gh-history__title">
          <HistoryIcon />
          <h3>{pr ? `PR #${pr.number}` : 'Commit History'}</h3>
          {filePath && <span className="gh-history__filepath">{filePath}</span>}
          {pr && <span className="gh-history__filepath">{pr.title}</span>}
        </div>
        {onClose && <button className="gh-modal__close" onClick={onClose} aria-label="Close">&times;</button>}
      </div>

      {/* Filters */}
      <div className="gh-history__filters">
        <div className="gh-history__search">
          <SearchIcon />
          <input
            type="text"
            placeholder="Search commits..."
            value={search}
            onChange={handleSearchChange}
            className="gh-input gh-input--sm"
          />
        </div>
        {!pr && (
          <div className="gh-history__filter-row">
            <div className="gh-history__filter">
              <BranchIcon />
              <select value={targetRef} onChange={(e) => setTargetRef(e.target.value)} className="gh-branch-select gh-branch-select--sm">
                {branches.map(b => (
                  <option key={b.name} value={b.name}>{b.name}</option>
                ))}
              </select>
            </div>
            <input
              type="text"
              placeholder="Filter by author..."
              onChange={handleAuthorChange}
              className="gh-input gh-input--sm gh-history__author-input"
            />
          </div>
        )}
      </div>

      {/* Commit list */}
      <div className="gh-history__list">
        {loading && commits.length === 0 ? (
          <p className="text-muted gh-loading">Loading commits...</p>
        ) : grouped.length === 0 ? (
          <p className="text-muted gh-loading">{search ? 'No matching commits' : 'No commits found'}</p>
        ) : (
          grouped.map(group => (
            <div key={group.date} className="gh-history__group">
              <div className="gh-history__date-header">
                <CommitIcon />
                <span>{group.date}</span>
              </div>
              {group.commits.map(c => (
                <div key={c.sha} className={`gh-history__commit${expandedSha === c.sha ? ' expanded' : ''}`}>
                  <button className="gh-history__commit-row" onClick={() => handleToggleDetail(c.sha)}>
                    <div className="gh-history__commit-main">
                      {c.author.avatar_url && (
                        <img src={c.author.avatar_url} alt="" className="gh-history__avatar" />
                      )}
                      <div className="gh-history__commit-info">
                        <span className="gh-history__commit-msg">{c.message.split('\n')[0]}</span>
                        <span className="gh-history__commit-meta">
                          <strong>{c.author.login || c.author.name}</strong>
                          {' · '}
                          {timeAgo(c.date)}
                        </span>
                      </div>
                    </div>
                    <div className="gh-history__commit-sha">
                      <code>{c.sha.slice(0, 7)}</code>
                    </div>
                  </button>

                  {/* Expanded detail */}
                  {expandedSha === c.sha && (
                    <div className="gh-history__detail">
                      {detailLoading ? (
                        <p className="text-muted gh-loading">Loading details...</p>
                      ) : commitDetail ? (
                        <>
                          {/* Full commit message */}
                          {commitDetail.message.includes('\n') && (
                            <pre className="gh-history__full-msg">{commitDetail.message}</pre>
                          )}

                          {/* Stats summary */}
                          {commitDetail.stats && (
                            <div className="gh-history__stats">
                              <span className="gh-history__stat-files">{commitDetail.files.length} file{commitDetail.files.length !== 1 ? 's' : ''} changed</span>
                              <span className="gh-history__stat-add">+{commitDetail.stats.additions}</span>
                              <span className="gh-history__stat-del">-{commitDetail.stats.deletions}</span>
                            </div>
                          )}

                          {/* Changed files (compact list) */}
                          {commitDetail.files && commitDetail.files.length > 0 && showDiffSha !== c.sha && (
                            <div className="gh-history__files">
                              {commitDetail.files.map(f => (
                                <div
                                  key={f.filename}
                                  className={`gh-history__file-row${onFileClick ? ' clickable' : ''}`}
                                  onClick={onFileClick ? () => onFileClick(f.filename) : undefined}
                                  role={onFileClick ? 'button' : undefined}
                                >
                                  <span className={`gh-history__file-status gh-history__file-status--${f.status}`}>
                                    {f.status === 'added' ? 'A' : f.status === 'removed' ? 'D' : f.status === 'renamed' ? 'R' : 'M'}
                                  </span>
                                  <span className="gh-history__file-name">{f.filename}</span>
                                  <span className="gh-history__file-diff">
                                    {f.additions > 0 && <span className="gh-history__stat-add">+{f.additions}</span>}
                                    {f.deletions > 0 && <span className="gh-history__stat-del">-{f.deletions}</span>}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}

                          <div className="gh-history__detail-actions">
                            {commitDetail.files && commitDetail.files.some(f => f.patch) && (
                              <button
                                className={`btn btn-ghost btn-sm${showDiffSha === c.sha ? ' active' : ''}`}
                                onClick={() => setShowDiffSha(showDiffSha === c.sha ? null : c.sha)}
                              >
                                <DiffAddIcon /> {showDiffSha === c.sha ? 'Hide Diff' : 'View Diff'}
                              </button>
                            )}
                            <a href={commitDetail.html_url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
                              View on GitHub
                            </a>
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => navigator.clipboard.writeText(commitDetail.sha)}
                              title="Copy full SHA"
                            >
                              Copy SHA
                            </button>
                          </div>

                          {/* Full diff view */}
                          {showDiffSha === c.sha && commitDetail.files && (
                            <DiffPanel
                              files={commitDetail.files}
                              commitSha={commitDetail.sha}
                              title={c.message.split('\n')[0]}
                              onClose={() => setShowDiffSha(null)}
                            />
                          )}
                        </>
                      ) : null}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))
        )}
        {hasMore && !loading && filtered.length === commits.length && (
          <button className="btn btn-ghost btn-sm gh-load-more" onClick={handleLoadMore}>
            Load older commits
          </button>
        )}
        {loading && commits.length > 0 && (
          <p className="text-muted gh-loading">Loading more...</p>
        )}
      </div>
    </div>
  );
}

// ─── Import to Codex Modal ────────────────────────────

function ImportToCodexModal({ owner, repo, filePath, branch, onClose, onImported }) {
  const navigate = useNavigate();
  const [archives, setArchives] = useState([]);
  const [archiveId, setArchiveId] = useState('');
  const [title, setTitle] = useState(filePath.split('/').pop().replace(/\.[^.]+$/, ''));
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape' && !importing) onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [importing, onClose]);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('GET', '/api/archives');
        setArchives(res.archives);
        if (res.archives.length > 0) setArchiveId(String(res.archives[0].id));
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, []);

  const handleImport = async () => {
    if (!archiveId) {
      setError('Please select an archive');
      return;
    }
    setError(null);
    setImporting(true);
    try {
      const res = await apiFetch('POST', '/api/github/import-to-codex', {
        owner,
        repo,
        path: filePath,
        ref: branch,
        archive_id: Number(archiveId),
        title: title.trim() || undefined,
      });
      if (onImported) onImported(res);
      // Navigate to the new document
      navigate(`/editor/${res.logId}`);
    } catch (e) {
      setError(e.body?.message || 'Failed to import file');
    }
    setImporting(false);
  };

  return (
    <div className="gh-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget && !importing) onClose(); }}>
      <div className="gh-modal">
        <div className="gh-modal__header">
          <h3>Import to Cloud Codex</h3>
          <button className="gh-modal__close" onClick={onClose} disabled={importing} aria-label="Close">&times;</button>
        </div>

        <div className="gh-modal__body">
          {error && <p className="form-error">{error}</p>}

          <div className="gh-import-source">
            <span className="text-muted text-sm">From GitHub:</span>
            <code className="gh-import-source__path">{owner}/{repo}/{filePath}</code>
            <span className="text-muted text-sm">({branch})</span>
          </div>

          <div className="gh-field">
            <label className="gh-field__label">Document title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="gh-input"
              autoFocus
            />
          </div>

          <div className="gh-field">
            <label className="gh-field__label">Import into archive</label>
            {loading ? (
              <p className="text-muted text-sm">Loading archives...</p>
            ) : archives.length === 0 ? (
              <p className="form-error">No archives available. Create an archive first.</p>
            ) : (
              <select
                value={archiveId}
                onChange={(e) => setArchiveId(e.target.value)}
                className="gh-branch-select"
              >
                {archives.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.name}{a.workspace_name ? ` (${a.workspace_name})` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          <p className="text-muted text-sm">
            {/\.(md|mdx|markdown)$/i.test(filePath)
              ? 'Markdown will be converted to rich text in your Codex document.'
              : 'File content will be imported as a code block.'}
          </p>
        </div>

        <div className="gh-modal__footer">
          <button className="btn btn-ghost" onClick={onClose} disabled={importing}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleImport}
            disabled={importing || !archiveId || loading}
          >
            {importing ? 'Importing...' : 'Import to Codex'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── File Viewer/Editor ──────────────────────────────

function FileView({ owner, repo, filePath, branch, branches, defaultBranch, onNavigateBack, onBranchCreated, onFileDeleted, onFileRenamed }) {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [showCommit, setShowCommit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showRename, setShowRename] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [currentSha, setCurrentSha] = useState(null);
  const [currentBranch, setCurrentBranch] = useState(branch);

  const isMarkdown = /\.(md|mdx|markdown)$/i.test(filePath);

  // Sync with parent branch selection
  useEffect(() => {
    setCurrentBranch(branch);
  }, [branch]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await apiFetch('GET', `/api/github/repos/${owner}/${repo}/contents/${filePath}?ref=${encodeURIComponent(currentBranch)}`);
        setFile(res.file);
        setEditContent(res.file.content);
        setCurrentSha(res.file.sha);
      } catch {
        setFile(null);
      }
      setLoading(false);
    })();
  }, [owner, repo, filePath, currentBranch]);

  const handleStartEdit = () => {
    setEditContent(file.content);
    setEditing(true);
    setShowCommit(false);
  };

  const handleCancelEdit = () => {
    setEditing(false);
    setShowCommit(false);
  };

  const hasChanges = editing && file && editContent !== file.content;

  const handleCommitted = (newSha, newBranch) => {
    setCurrentSha(newSha);
    setCurrentBranch(newBranch);
    // Update the file object with committed content
    setFile(f => ({ ...f, content: editContent, sha: newSha }));
    setEditing(false);
    setShowCommit(false);
    // If a new branch was created, notify parent to refresh branch list
    if (newBranch !== branch && onBranchCreated) {
      onBranchCreated(newBranch);
    }
  };

  if (loading) return <div className="gh-file-view"><p className="text-muted gh-loading">Loading file...</p></div>;
  if (!file) return <div className="gh-file-view"><p className="form-error">Failed to load file</p></div>;

  return (
    <div className="gh-file-view">
      <div className="gh-file-header">
        <Breadcrumb owner={owner} repo={repo} filePath={filePath} onNavigate={(path) => !path && onNavigateBack()} />
        <div className="gh-file-actions">
          {file.html_url && (
            <a href={file.html_url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
              View on GitHub
            </a>
          )}
          {!editing && (
            <>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowImport(true)}
                title="Import to Cloud Codex"
              >
                <ImportIcon /> Import to Codex
              </button>
              <button
                className={`btn btn-ghost btn-sm${showHistory ? ' active' : ''}`}
                onClick={() => setShowHistory(h => !h)}
                title="Commit history"
              >
                <HistoryIcon /> History
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowRename(true)} title="Rename / Move">
                <RenameIcon /> Rename
              </button>
              <button className="btn btn-ghost btn-sm gh-btn-danger-ghost" onClick={() => setShowDelete(true)} title="Delete file">
                <TrashIcon /> Delete
              </button>
            </>
          )}
          {!editing ? (
            <button className="btn btn-primary btn-sm" onClick={handleStartEdit}>Edit</button>
          ) : (
            <>
              <button className="btn btn-ghost btn-sm" onClick={handleCancelEdit}>Cancel</button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => setShowCommit(true)}
                disabled={!hasChanges}
              >
                Commit...
              </button>
            </>
          )}
        </div>
      </div>

      <div className={`gh-file-body${showHistory ? ' gh-file-body--with-history' : ''}`}>
        <div className="gh-file-body__content">
          {editing ? (
              isMarkdown ? (
                <MarkdownEditorPane content={editContent} onChange={setEditContent} />
              ) : (
                <textarea
                  className="gh-editor-textarea gh-editor-textarea--plain"
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  spellCheck={false}
                />
              )
          ) : (
            <div className="gh-file-content">
              {isMarkdown ? (
                <MarkdownViewer content={file.content} />
              ) : (
                <pre className="gh-file-raw"><code>{file.content}</code></pre>
              )}
            </div>
          )}
        </div>

        {showHistory && (
          <CommitHistory
            owner={owner}
            repo={repo}
            filePath={filePath}
            branch={currentBranch}
            branches={branches}
            onClose={() => setShowHistory(false)}
          />
        )}
      </div>

      {showCommit && (
        <CommitPanel
          owner={owner}
          repo={repo}
          filePath={filePath}
          fileSha={currentSha}
          content={editContent}
          branch={currentBranch}
          branches={branches}
          defaultBranch={defaultBranch}
          onCommitted={handleCommitted}
          onClose={() => setShowCommit(false)}
        />
      )}

      {showDelete && (
        <DeleteFileModal
          owner={owner}
          repo={repo}
          filePath={filePath}
          fileSha={currentSha}
          branch={currentBranch}
          onDeleted={() => {
            setShowDelete(false);
            if (onFileDeleted) onFileDeleted(filePath);
          }}
          onClose={() => setShowDelete(false)}
        />
      )}

      {showRename && (
        <RenameFileModal
          owner={owner}
          repo={repo}
          filePath={filePath}
          branch={currentBranch}
          onRenamed={(newPath) => {
            setShowRename(false);
            if (onFileRenamed) onFileRenamed(filePath, newPath);
          }}
          onClose={() => setShowRename(false)}
        />
      )}

      {showImport && (
        <ImportToCodexModal
          owner={owner}
          repo={repo}
          filePath={filePath}
          branch={currentBranch}
          onClose={() => setShowImport(false)}
        />
      )}
    </div>
  );
}

// ─── PR Detail View ──────────────────────────────────

function PRDetailView({ owner, repo, pr, branches, onBack, onFileClick }) {
  const [detail, setDetail] = useState(null);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('discussion'); // 'discussion' | 'commits' | 'files'

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [detailRes, filesRes] = await Promise.all([
          apiFetch('GET', `/api/github/repos/${owner}/${repo}/pulls/${pr.number}`),
          apiFetch('GET', `/api/github/repos/${owner}/${repo}/pulls/${pr.number}/files?per_page=100`),
        ]);
        setDetail(detailRes.pull);
        setFiles(filesRes.files);
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, [owner, repo, pr.number]);

  if (loading) return <p className="text-muted gh-loading">Loading PR details...</p>;

  return (
    <div className="gh-pr-detail">
      <div className="gh-pr-detail__header">
        <button className="btn btn-ghost btn-sm" onClick={onBack}>&larr; Pull Requests</button>
        <div className="gh-pr-detail__title-row">
          <PullRequestIcon />
          <h3>{detail?.title || pr.title}</h3>
          <span className={`gh-pr-badge gh-pr-badge--${detail?.merged ? 'merged' : detail?.state || pr.state}`}>
            {detail?.merged ? 'Merged' : (detail?.state || pr.state)}
          </span>
        </div>
        {detail && (
          <div className="gh-pr-detail__meta">
            <span>#{detail.number}</span>
            <span>·</span>
            <span>{detail.head.ref} → {detail.base.ref}</span>
            <span>·</span>
            <span>{detail.commits} commit{detail.commits !== 1 ? 's' : ''}</span>
            <span>·</span>
            <span className="gh-history__stat-add">+{detail.additions}</span>
            <span className="gh-history__stat-del">-{detail.deletions}</span>
            <span>·</span>
            <span>{detail.changed_files} file{detail.changed_files !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>

      <div className="gh-pr-detail__tabs">
        <button className={`gh-tab${tab === 'discussion' ? ' active' : ''}`} onClick={() => setTab('discussion')}>
          💬 Discussion
        </button>
        <button className={`gh-tab${tab === 'commits' ? ' active' : ''}`} onClick={() => setTab('commits')}>
          <CommitIcon /> Commits
        </button>
        <button className={`gh-tab${tab === 'files' ? ' active' : ''}`} onClick={() => setTab('files')}>
          <FileIcon isMarkdown={false} /> Changed Files
        </button>
        {detail?.html_url && (
          <a href={detail.html_url} target="_blank" rel="noopener noreferrer" className="gh-tab gh-tab--link">
            View on GitHub ↗
          </a>
        )}
      </div>

      {tab === 'discussion' ? (
        <PRDiscussionTab owner={owner} repo={repo} prNumber={pr.number} />
      ) : tab === 'commits' ? (
        <CommitHistory
          owner={owner}
          repo={repo}
          branch={pr.head.ref}
          branches={branches}
          fullWidth
          pr={pr}
          onFileClick={onFileClick}
        />
      ) : (
        <div className="gh-pr-files">
          {files.length === 0 ? (
            <p className="text-muted gh-loading">No files changed</p>
          ) : (
            <DiffPanel
              files={files}
              title={`PR #${pr.number}: ${detail?.title || pr.title}`}
            />
          )}
        </div>
      )}
    </div>
  );
}

function PRDiscussionTab({ owner, repo, prNumber }) {
  const [ghComments, setGhComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      apiFetch('GET', `/api/github/repos/${owner}/${repo}/pulls/${prNumber}/session`),
      apiFetch('GET', `/api/github/repos/${owner}/${repo}/pulls/${prNumber}/comments`),
    ])
      .then(([, comm]) => { if (!cancelled) setGhComments(comm.comments || []); })
      .catch((e) => { if (!cancelled) setError(e.body?.message || e.message || 'Failed to load discussion'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [owner, repo, prNumber]);

  if (loading) return <p className="text-muted gh-loading">Loading discussion…</p>;
  if (error) return <p className="form-error">{error}</p>;

  // Group review comments by file path
  const byPath = {};
  for (const c of ghComments) {
    const k = c.path || '_general';
    if (!byPath[k]) byPath[k] = [];
    byPath[k].push(c);
  }
  const paths = Object.keys(byPath).sort();

  return (
    <div className="gh-pr-discussion">
      {paths.length === 0 && (
        <p className="text-muted">No PR review comments yet. Use the Files tab to start one.</p>
      )}
      {paths.map((p) => (
        <div key={p} className="gh-pr-discussion__file">
          <h4 className="gh-pr-discussion__file-header">{p === '_general' ? 'General' : p}</h4>
          <ul className="gh-pr-discussion__list">
            {byPath[p].map((c) => (
              <li key={c.id} className="gh-pr-discussion__item">
                <div className="gh-pr-discussion__meta">
                  {c.user.avatar_url && (
                    <img src={c.user.avatar_url} alt="" width="20" height="20" style={{ borderRadius: '50%' }} />
                  )}
                  <strong>{c.user.login}</strong>
                  {c.line && <span className="text-muted text-sm">on line {c.line}</span>}
                  <a href={c.html_url} target="_blank" rel="noopener noreferrer" className="text-muted text-sm">
                    {timeAgo(c.created_at)}
                  </a>
                </div>
                <div className="gh-pr-discussion__body">{c.body}</div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ─── Repo Activity View (replaces welcome when no file selected) ──

function RepoActivityView({ owner, repo, repoInfo, branch, branches, onNewFile, onFileClick }) {
  const [tab, setTab] = useState('activity'); // 'activity' | 'prs' | 'releases'
  const [pulls, setPulls] = useState([]);
  const [pullsLoading, setPullsLoading] = useState(false);
  const [pullsState, setPullsState] = useState('open');
  const [selectedPR, setSelectedPR] = useState(null);
  const [releases, setReleases] = useState([]);
  const [releasesLoading, setReleasesLoading] = useState(false);

  // Load PRs when switching to that tab
  useEffect(() => {
    if (tab !== 'prs') return;
    (async () => {
      setPullsLoading(true);
      try {
        const res = await apiFetch('GET', `/api/github/repos/${owner}/${repo}/pulls?state=${pullsState}&per_page=30`);
        setPulls(res.pulls);
      } catch { /* ignore */ }
      setPullsLoading(false);
    })();
  }, [owner, repo, tab, pullsState]);

  // Load releases when switching to that tab
  useEffect(() => {
    if (tab !== 'releases') return;
    (async () => {
      setReleasesLoading(true);
      try {
        const res = await apiFetch('GET', `/api/github/repos/${owner}/${repo}/releases`);
        setReleases(res.releases || []);
      } catch { /* ignore */ }
      setReleasesLoading(false);
    })();
  }, [owner, repo, tab]);

  if (selectedPR) {
    return (
      <PRDetailView
        owner={owner}
        repo={repo}
        pr={selectedPR}
        branches={branches}
        onBack={() => setSelectedPR(null)}
        onFileClick={onFileClick}
      />
    );
  }

  return (
    <div className="gh-activity">
      {/* Header */}
      <div className="gh-activity__header">
        <div className="gh-activity__repo-info">
          <RepoIcon />
          <h2>{repoInfo?.full_name || `${owner}/${repo}`}</h2>
          {repoInfo?.private && <LockIcon />}
        </div>
        {repoInfo?.description && <p className="text-muted">{repoInfo.description}</p>}
        <div className="gh-activity__actions">
          <button className="btn btn-primary btn-sm" onClick={onNewFile}>
            <PlusIcon /> New file
          </button>
          {repoInfo?.html_url && (
            <a href={repoInfo.html_url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
              Open on GitHub
            </a>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="gh-activity__tabs">
        <button className={`gh-tab${tab === 'activity' ? ' active' : ''}`} onClick={() => setTab('activity')}>
          <HistoryIcon /> Branch History
        </button>
        <button className={`gh-tab${tab === 'prs' ? ' active' : ''}`} onClick={() => setTab('prs')}>
          <PullRequestIcon /> Pull Requests
        </button>
        <button className={`gh-tab${tab === 'releases' ? ' active' : ''}`} onClick={() => setTab('releases')}>
          🏷 Releases
        </button>
      </div>

      {/* Content */}
      {tab === 'activity' ? (
        <CommitHistory
          owner={owner}
          repo={repo}
          branch={branch}
          branches={branches}
          fullWidth
          onFileClick={onFileClick}
        />
      ) : tab === 'releases' ? (
        <div className="gh-releases">
          {releasesLoading ? (
            <p className="text-muted gh-loading">Loading releases...</p>
          ) : releases.length === 0 ? (
            <p className="text-muted gh-loading">No releases yet</p>
          ) : (
            releases.map((r) => (
              <div key={r.id} className="gh-releases__item">
                <div>
                  <a className="gh-releases__tag" href={r.html_url} target="_blank" rel="noopener noreferrer">{r.tag_name}</a>
                  {r.name && <span className="gh-releases__name">{r.name}</span>}
                  {r.draft && <span className="gh-pr-badge"> draft</span>}
                  {r.prerelease && <span className="gh-pr-badge"> prerelease</span>}
                  {r.published_at && <span className="text-muted text-sm" style={{ marginLeft: 8 }}>{timeAgo(r.published_at)}</span>}
                </div>
                {r.body && <div className="gh-releases__body">{r.body}</div>}
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="gh-pr-list">
          <div className="gh-pr-list__filter">
            <select value={pullsState} onChange={(e) => setPullsState(e.target.value)} className="gh-branch-select gh-branch-select--sm">
              <option value="open">Open</option>
              <option value="closed">Closed</option>
              <option value="all">All</option>
            </select>
          </div>
          {pullsLoading ? (
            <p className="text-muted gh-loading">Loading pull requests...</p>
          ) : pulls.length === 0 ? (
            <p className="text-muted gh-loading">No {pullsState === 'all' ? '' : pullsState} pull requests</p>
          ) : (
            <div className="gh-pr-list__items">
              {pulls.map(pr => (
                <button key={pr.number} className="gh-pr-card" onClick={() => setSelectedPR(pr)}>
                  <div className="gh-pr-card__header">
                    <PullRequestIcon />
                    <span className="gh-pr-card__title">{pr.title}</span>
                    <span className={`gh-pr-badge gh-pr-badge--${pr.state}`}>{pr.state}</span>
                    <CIStatusBadge owner={owner} repo={repo} branch={pr.head.ref} compact />
                  </div>
                  <div className="gh-pr-card__meta">
                    <span>#{pr.number}</span>
                    <span>·</span>
                    <span>{pr.head.ref} → {pr.base.ref}</span>
                    <span>·</span>
                    {pr.user.avatar_url && <img src={pr.user.avatar_url} alt="" className="gh-history__avatar" style={{ width: 16, height: 16 }} />}
                    <span>{pr.user.login}</span>
                    <span>·</span>
                    <span className="text-muted">{timeAgo(pr.updated_at)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Repo Browser (tree + file viewer) ───────────────

function RepoBrowser({ owner, repo: repoName, onBack, fromArchiveId, exportData, exportLogId, onExportDone }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [repoInfo, setRepoInfo] = useState(null);
  const [tree, setTree] = useState([]);
  const [branches, setBranches] = useState([]);
  const [branch, setBranch] = useState(searchParams.get('ref') || '');
  const [selectedFile, setSelectedFile] = useState(searchParams.get('path') || null);
  const [loading, setLoading] = useState(true);
  const [treeFilter, setTreeFilter] = useState('');
  const [mdOnly, setMdOnly] = useState(true);
  const [showNewFile, setShowNewFile] = useState(false);

  // Auto-open new file modal when in export mode
  useEffect(() => {
    if (exportData && !showNewFile) {
      setShowNewFile(true);
    }
  }, [exportData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load repo info + branches
  useEffect(() => {
    (async () => {
      try {
        const [infoRes, branchRes] = await Promise.all([
          apiFetch('GET', `/api/github/repos/${owner}/${repoName}`),
          apiFetch('GET', `/api/github/repos/${owner}/${repoName}/branches`),
        ]);
        setRepoInfo(infoRes.repo);
        setBranches(branchRes.branches);
        if (!branch) setBranch(infoRes.repo.default_branch);
      } catch { /* ignore */ }
    })();
  }, [owner, repoName]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load tree when branch changes
  const refreshTree = useCallback(async () => {
    if (!branch) return;
    setLoading(true);
    try {
      const res = await apiFetch('GET', `/api/github/repos/${owner}/${repoName}/tree?ref=${encodeURIComponent(branch)}`);
      setTree(res.tree);
    } catch { /* ignore */ }
    setLoading(false);
  }, [owner, repoName, branch]);

  useEffect(() => { refreshTree(); }, [refreshTree]);

  // Sync URL params
  useEffect(() => {
    const params = {};
    if (branch && repoInfo && branch !== repoInfo.default_branch) params.ref = branch;
    if (selectedFile) params.path = selectedFile;
    if (fromArchiveId) params.from_archive = fromArchiveId;
    setSearchParams(params, { replace: true });
  }, [branch, selectedFile, repoInfo, fromArchiveId, setSearchParams]);

  const treeNodes = useMemo(() => {
    let items = tree;
    if (treeFilter) {
      const lower = treeFilter.toLowerCase();
      items = items.filter(i => i.path.toLowerCase().includes(lower));
    }
    if (mdOnly) {
      items = items.filter(i => i.type === 'tree' || i.isMarkdown);
    }
    return buildTree(items);
  }, [tree, treeFilter, mdOnly]);

  const handleBranchChange = (e) => {
    setBranch(e.target.value);
    setSelectedFile(null);
  };

  const handleFileSelect = (node) => {
    setSelectedFile(node.path);
  };

  return (
    <div className="gh-browser">
      {/* Sidebar: tree */}
      <aside className="gh-browser__sidebar">
        <div className="gh-browser__sidebar-header">
          <div className="gh-back-btns">
            <button className="btn btn-ghost btn-sm gh-back-btn" onClick={onBack}>&larr; Repos</button>
            {fromArchiveId && (
              <button className="btn btn-ghost btn-sm gh-back-btn" onClick={() => navigate(`/archives/${fromArchiveId}`)}>&larr; Archive</button>
            )}
          </div>
          <h3 className="gh-repo-title">
            <RepoIcon /> {repoInfo?.name || repoName}
            {repoInfo?.private && <LockIcon />}
          </h3>
        </div>

        {/* Branch selector */}
        <div className="gh-branch-selector">
          <BranchIcon />
          <select value={branch} onChange={handleBranchChange} className="gh-branch-select">
            {branches.map(b => (
              <option key={b.name} value={b.name}>{b.name}</option>
            ))}
          </select>
        </div>

        {/* Filter */}
        <div className="gh-tree-filter">
          <input
            type="text"
            placeholder="Filter files..."
            value={treeFilter}
            onChange={(e) => setTreeFilter(e.target.value)}
            className="gh-search-input gh-search-input--sm"
          />
          <div className="gh-tree-filter__row">
            <label className="gh-md-toggle">
              <input type="checkbox" checked={mdOnly} onChange={(e) => setMdOnly(e.target.checked)} />
              <span className="text-sm">Docs only</span>
            </label>
            <button className="btn btn-ghost btn-sm gh-new-file-btn" onClick={() => setShowNewFile(true)} title="Create new file">
              <PlusIcon /> New file
            </button>
          </div>
        </div>

        {/* Tree */}
        <div className="gh-tree">
          {loading ? (
            <p className="text-muted gh-loading">Loading...</p>
          ) : treeNodes.length === 0 ? (
            <p className="text-muted gh-loading">No files found</p>
          ) : (
            treeNodes.map(node => (
              <TreeNode
                key={node.path}
                node={node}
                selectedPath={selectedFile}
                onFileSelect={handleFileSelect}
              />
            ))
          )}
        </div>
      </aside>

      {/* Main area */}
      <div className="gh-browser__main">
        {selectedFile ? (
          <FileView
            owner={owner}
            repo={repoName}
            filePath={selectedFile}
            branch={branch}
            branches={branches}
            defaultBranch={repoInfo?.default_branch || 'main'}
            onNavigateBack={() => setSelectedFile(null)}
            onBranchCreated={(newBranch) => {
              // Refresh branch list and switch to the new branch
              apiFetch('GET', `/api/github/repos/${owner}/${repoName}/branches`)
                .then(res => {
                  setBranches(res.branches);
                  setBranch(newBranch);
                })
                .catch(() => {});
            }}
            onFileDeleted={() => {
              setSelectedFile(null);
              refreshTree();
            }}
            onFileRenamed={(oldPath, newPath) => {
              setSelectedFile(newPath);
              refreshTree();
            }}
          />
        ) : (
          <RepoActivityView
            owner={owner}
            repo={repoName}
            repoInfo={repoInfo}
            branch={branch}
            branches={branches}
            onNewFile={() => setShowNewFile(true)}
            onFileClick={(path) => setSelectedFile(path)}
          />
        )}
      </div>

      {showNewFile && (
        <NewFileModal
          owner={owner}
          repo={repoName}
          branch={branch}
          branches={branches}
          initialContent={exportData?.content || ''}
          initialPath={exportData?.link && exportData.link.repo_owner === owner && exportData.link.repo_name === repoName
            ? exportData.link.file_path
            : exportData ? `${exportData.title.replace(/[^a-zA-Z0-9_\- ]/g, '_')}.md` : ''}
          githubLink={exportData?.link && exportData.link.repo_owner === owner && exportData.link.repo_name === repoName
            ? exportData.link : null}
          exportLogId={exportLogId}
          repoTree={tree}
          onCreated={(newPath, newBranch) => {
            setShowNewFile(false);
            if (newBranch && newBranch !== branch) setBranch(newBranch);
            refreshTree();
            setSelectedFile(newPath);
            if (exportData && onExportDone) onExportDone();
          }}
          onClose={() => {
            setShowNewFile(false);
            if (exportData && onExportDone) onExportDone();
          }}
        />
      )}
    </div>
  );
}

// ─── Not Connected ───────────────────────────────────

function GitHubNotConnected() {
  return (
    <div className="gh-not-connected">
      <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor" style={{ opacity: 0.4 }}>
        <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
      </svg>
      <h2>Connect GitHub</h2>
      <p className="text-muted">Link your GitHub account to browse repositories and edit documentation.</p>
      <a href="/account" className="btn btn-primary">Go to Account Settings</a>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────

export default function GitHubPage() {
  const params = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const fromArchiveId = searchParams.get('from_archive');
  const exportLogId = searchParams.get('export_logId');
  const exportTitle = searchParams.get('export_title');
  const [connected, setConnected] = useState(null); // null = loading
  const [view, setView] = useState(params.owner ? 'repo' : 'list');
  const [selectedRepo, setSelectedRepo] = useState(
    params.owner ? { owner: { login: params.owner }, name: params.repo } : null
  );
  const [exportData, setExportData] = useState(null); // { content, title, link? }

  useEffect(() => {
    apiFetch('GET', '/api/github/status')
      .then(res => setConnected(res.connected))
      .catch(() => setConnected(false));
  }, []);

  // Fetch markdown + github link when in export mode
  useEffect(() => {
    if (!exportLogId) {
      setExportData(null);
      return;
    }
    (async () => {
      try {
        const token = document.cookie.split('; ').find(c => c.startsWith('session_token='))?.split('=')[1];
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const [mdRes, linkRes] = await Promise.all([
          fetch(`/api/document/${exportLogId}/export?format=md`, { headers }),
          apiFetch('GET', `/api/github/link/${exportLogId}`).catch(() => ({ link: null })),
        ]);

        if (!mdRes.ok) throw new Error('Failed to fetch document');
        const text = await mdRes.text();
        const link = linkRes.link || null;

        setExportData({
          content: text,
          title: exportTitle ? decodeURIComponent(exportTitle) : 'document',
          link,
        });

        // Auto-navigate to linked repo if we're on the repo list
        if (link && !params.owner) {
          navigate(`/github/${link.repo_owner}/${link.repo_name}?export_logId=${exportLogId}${exportTitle ? `&export_title=${exportTitle}` : ''}`, { replace: true });
        }
      } catch {
        setExportData(null);
      }
    })();
  }, [exportLogId, exportTitle]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectRepo = (repo) => {
    setSelectedRepo(repo);
    setView('repo');
    if (exportLogId) {
      // In export mode, navigate to repo keeping export params
      navigate(`/github/${repo.owner.login}/${repo.name}?export_logId=${exportLogId}${exportTitle ? `&export_title=${exportTitle}` : ''}`);
    } else {
      navigate(`/github/${repo.owner.login}/${repo.name}`);
    }
  };

  const handleBackToList = () => {
    setSelectedRepo(null);
    setView('list');
    if (exportLogId) {
      navigate(`/github?export_logId=${exportLogId}${exportTitle ? `&export_title=${exportTitle}` : ''}`);
    } else {
      navigate('/github');
    }
  };

  const handleCancelExport = () => {
    setExportData(null);
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('export_logId');
    newParams.delete('export_title');
    setSearchParams(newParams);
  };

  // Sync from URL params if navigated directly
  useEffect(() => {
    if (params.owner && params.repo) {
      setSelectedRepo({ owner: { login: params.owner }, name: params.repo });
      setView('repo');
    }
  }, [params.owner, params.repo]);

  return (
    <StdLayout>
      <div className="gh-page">
        {exportData && (
          <div className="gh-export-banner">
            <ExportIcon />
            <span>
              {exportData.link ? 'Updating' : 'Pushing'} <strong>{exportData.title}</strong> {exportData.link ? `on ${exportData.link.repo_owner}/${exportData.link.repo_name}` : 'to GitHub'}
              {!exportData.link && view === 'list' ? ' — select a repository' : ''}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={handleCancelExport}>Cancel</button>
          </div>
        )}
        {connected === null ? (
          <p className="text-muted gh-loading">Loading...</p>
        ) : !connected ? (
          <GitHubNotConnected />
        ) : view === 'repo' && selectedRepo ? (
          <RepoBrowser
            owner={selectedRepo.owner.login}
            repo={selectedRepo.name}
            onBack={handleBackToList}
            fromArchiveId={fromArchiveId}
            exportData={exportData}
            exportLogId={exportLogId}
            onExportDone={handleCancelExport}
          />
        ) : (
          <RepoList onSelect={handleSelectRepo} />
        )}
      </div>
    </StdLayout>
  );
}
