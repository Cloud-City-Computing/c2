/**
 * Cloud Codex - GitHub Integration Page
 *
 * Browse repositories, navigate file trees, view/edit markdown files,
 * commit changes, create branches, and open pull requests.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import StdLayout from '../page_layouts/Std_Layout';
import { apiFetch, timeAgo } from '../util';
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

function MarkdownEditorPane({ content, onChange }) {
  const previewHtml = useMemo(() => {
    return DOMPurify.sanitize(marked.parse(content || ''));
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
}

// ─── Commit Modal ─────────────────────────────────────

function CommitPanel({ owner, repo, filePath, fileSha, content, branch, onCommitted, onClose }) {
  const [mode, setMode] = useState('direct'); // 'direct' | 'branch'
  const [message, setMessage] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [createPR, setCreatePR] = useState(true);
  const [prTitle, setPrTitle] = useState('');
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

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
        try {
          const prRes = await apiFetch('POST', `/api/github/repos/${owner}/${repo}/pulls`, {
            title,
            body: `Updated \`${filePath}\` via Cloud Codex`,
            head: targetBranch,
            base: branch,
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

        <div className="gh-modal__body">
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

// ─── File Viewer/Editor ──────────────────────────────

function FileView({ owner, repo, filePath, branch, branches, defaultBranch, onNavigateBack, onBranchCreated }) {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [showCommit, setShowCommit] = useState(false);
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
    </div>
  );
}

// ─── Repo Browser (tree + file viewer) ───────────────

function RepoBrowser({ owner, repo: repoName, onBack, fromArchiveId }) {
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
  useEffect(() => {
    if (!branch) return;
    (async () => {
      setLoading(true);
      try {
        const res = await apiFetch('GET', `/api/github/repos/${owner}/${repoName}/tree?ref=${encodeURIComponent(branch)}`);
        setTree(res.tree);
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, [owner, repoName, branch]);

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
          <label className="gh-md-toggle">
            <input type="checkbox" checked={mdOnly} onChange={(e) => setMdOnly(e.target.checked)} />
            <span className="text-sm">Docs only</span>
          </label>
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
          />
        ) : (
          <div className="gh-welcome">
            <RepoIcon />
            <h2>{repoInfo?.full_name || `${owner}/${repoName}`}</h2>
            {repoInfo?.description && <p className="text-muted">{repoInfo.description}</p>}
            <p className="text-muted text-sm">Select a file from the tree to view or edit it.</p>
            {repoInfo?.html_url && (
              <a href={repoInfo.html_url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm" style={{ marginTop: 12 }}>
                Open on GitHub
              </a>
            )}
          </div>
        )}
      </div>
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
  const [searchParams] = useSearchParams();
  const fromArchiveId = searchParams.get('from_archive');
  const [connected, setConnected] = useState(null); // null = loading
  const [view, setView] = useState(params.owner ? 'repo' : 'list');
  const [selectedRepo, setSelectedRepo] = useState(
    params.owner ? { owner: { login: params.owner }, name: params.repo } : null
  );

  useEffect(() => {
    apiFetch('GET', '/api/github/status')
      .then(res => setConnected(res.connected))
      .catch(() => setConnected(false));
  }, []);

  const handleSelectRepo = (repo) => {
    setSelectedRepo(repo);
    setView('repo');
    navigate(`/github/${repo.owner.login}/${repo.name}`);
  };

  const handleBackToList = () => {
    setSelectedRepo(null);
    setView('list');
    navigate('/github');
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
          />
        ) : (
          <RepoList onSelect={handleSelectRepo} />
        )}
      </div>
    </StdLayout>
  );
}
