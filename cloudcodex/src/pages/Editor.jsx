/**
 * Cloud Codex - Editor Page
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import StdLayout from '../page_layouts/Std_Layout';
import JoditEditor from 'jodit-react';
import { marked } from 'marked';
import TurndownService from 'turndown';
import DOMPurify from 'dompurify';
import {
  fetchDocument,
  saveDocument,
  updatePageTitle,
  fetchVersions,
  fetchVersion,
  restoreVersion,
} from '../util';

// Configure marked for safe rendering
marked.setOptions({ breaks: true, gfm: true });

/** Sanitize HTML to prevent XSS — strips scripts, event handlers, and dangerous URIs */
function sanitizeHtml(html) {
  if (!html) return '';
  return DOMPurify.sanitize(html, {
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
  });
}

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

function htmlToMarkdown(html) {
  if (!html) return '';
  return turndown.turndown(html);
}

function markdownToHtml(md) {
  if (!md) return '';
  return sanitizeHtml(marked.parse(md));
}

// --- Jodit Editor wrapper ---

function RichTextEditor({ content, setContent }) {
  const editor = useRef(null);
  const config = useMemo(() => ({
    readonly: false,
    placeholder: 'Start typing...',
    theme: 'dark',
  }), []);

  return (
    <JoditEditor
      ref={editor}
      value={content}
      config={config}
      onBlur={setContent}
    />
  );
}

// --- Markdown Editor with live preview ---

function MarkdownEditor({ content, setContent }) {
  const [md, setMd] = useState(() => htmlToMarkdown(content));
  const [preview, setPreview] = useState(() => content || '');
  const textareaRef = useRef(null);
  const initializedRef = useRef(false);

  // Sync when content changes externally (e.g. version restore)
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }
    const newMd = htmlToMarkdown(content);
    setMd(newMd);
    setPreview(markdownToHtml(newMd));
  }, [content]);

  const handleChange = useCallback((e) => {
    const val = e.target.value;
    setMd(val);
    const html = markdownToHtml(val);
    setPreview(html);
    setContent(html);
  }, [setContent]);

  // Tab key inserts spaces instead of changing focus
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = textareaRef.current;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const val = ta.value;
      const newVal = val.substring(0, start) + '  ' + val.substring(end);
      setMd(newVal);
      setPreview(markdownToHtml(newVal));
      setContent(markdownToHtml(newVal));
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  }, [setContent]);

  return (
    <div className="markdown-editor">
      <div className="markdown-editor__pane markdown-editor__input">
        <div className="markdown-editor__label">Markdown</div>
        <textarea
          ref={textareaRef}
          className="markdown-editor__textarea"
          value={md}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Write markdown here..."
          spellCheck={false}
        />
      </div>
      <div className="markdown-editor__pane markdown-editor__preview">
        <div className="markdown-editor__label">Preview</div>
        <div
          className="markdown-editor__rendered"
          dangerouslySetInnerHTML={{ __html: preview }}
        />
      </div>
    </div>
  );
}

// --- Version History Panel ---

function VersionHistory({ pageId, onRestore }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchVersions(pageId);
        setVersions(res.versions || []);
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, [pageId]);

  const handlePreview = async (v) => {
    try {
      const res = await fetchVersion(pageId, v.id);
      setPreview(res.version);
    } catch { /* ignore */ }
  };

  const handleRestore = async (v) => {
    try {
      await restoreVersion(pageId, v.id);
      onRestore?.();
      setPreview(null);
    } catch { /* ignore */ }
  };

  if (loading) return <p className="text-muted">Loading history...</p>;
  if (versions.length === 0) return <p className="text-muted">No previous versions.</p>;

  return (
    <div className="version-history">
      <h3>Version History</h3>
      {preview && (
        <div className="version-preview">
          <div className="version-preview__header">
            <span>v{preview.version_number} — {new Date(preview.saved_at).toLocaleString()}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setPreview(null)}>Close</button>
          </div>
          <div className="version-preview__content" dangerouslySetInnerHTML={{ __html: sanitizeHtml(preview.html_content) }} />
          <button className="btn btn-primary btn-sm" onClick={() => handleRestore(preview)}>Restore This Version</button>
        </div>
      )}
      <ul className="version-list">
        {versions.map(v => (
          <li key={v.id} className="version-list__item">
            <span className="version-list__label">v{v.version_number}</span>
            <span className="version-list__date">{new Date(v.saved_at).toLocaleString()}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => handlePreview(v)}>Preview</button>
            <button className="btn btn-ghost btn-sm" onClick={() => handleRestore(v)}>Restore</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- Editor Page ---

export default function Editor() {
  const { pageId } = useParams();
  const navigate = useNavigate();
  const [content, setContent] = useState('');
  const [documentData, setDocumentData] = useState(null);
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState('');
  const [showVersions, setShowVersions] = useState(false);
  const [editorMode, setEditorMode] = useState('richtext'); // 'richtext' | 'markdown'

  const loadDocument = useCallback(async () => {
    if (!pageId) return;
    try {
      const res = await fetchDocument(pageId);
      const doc = res?.document ?? null;
      setDocumentData(doc);
      setContent(doc?.html_content ?? '');
      setTitle(doc?.title ?? '');
    } catch (e) {
      setStatus({ type: 'error', message: e.body?.message ?? 'Error loading document.' });
    }
  }, [pageId]);

  useEffect(() => { loadDocument(); }, [loadDocument]);

  const handleSave = useCallback(async () => {
    if (saving) return;
    setStatus(null);
    setSaving(true);
    try {
      await saveDocument(Number(pageId), content);
      setStatus({ type: 'success', message: 'Document saved.' });
    } catch (e) {
      setStatus({ type: 'error', message: `Error saving: ${e.body?.message ?? e.message}` });
    }
    setSaving(false);
  }, [pageId, content, saving]);

  const handleTitleSave = async () => {
    if (!title.trim()) return;
    try {
      await updatePageTitle(pageId, title);
      setDocumentData(d => ({ ...d, title }));
    } catch { /* ignore */ }
    setEditingTitle(false);
  };

  return (
    <StdLayout>
      <div className="editor-page">
        <div className="editor-header">
          <div className="editor-breadcrumb">
            {documentData?.project_name && (
              <span className="breadcrumb-item">{documentData.project_name}</span>
            )}
          </div>
          {editingTitle ? (
            <div className="editor-title-edit">
              <input
                type="text" value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleTitleSave()}
                onBlur={handleTitleSave}
                autoFocus
              />
            </div>
          ) : (
            <h2 className="editor-title" onClick={() => setEditingTitle(true)} title="Click to rename">
              {documentData?.title ?? 'Loading Document...'}
            </h2>
          )}
          <div className="document-meta">
            {documentData && (
              <>
                <span>Created by: {documentData.name} ({documentData.email})</span>
                <span>v{documentData.version_number ?? 1} &middot; {new Date(documentData.created_at).toLocaleString()}</span>
              </>
            )}
          </div>
        </div>

        {status && (
          <p className={`editor-status ${status.type}`}>{status.message}</p>
        )}

        <div className="editor-toolbar">
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Document'}
          </button>
          <div className="editor-mode-toggle">
            <button
              className={`btn btn-sm ${editorMode === 'richtext' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setEditorMode('richtext')}
            >
              Rich Text
            </button>
            <button
              className={`btn btn-sm ${editorMode === 'markdown' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setEditorMode('markdown')}
            >
              Markdown
            </button>
          </div>
          <button className="btn btn-ghost" onClick={() => setShowVersions(v => !v)}>
            {showVersions ? 'Hide History' : 'Version History'}
          </button>
          <button className="btn btn-ghost" onClick={() => navigate(-1)}>Back</button>
        </div>

        {showVersions && <VersionHistory pageId={pageId} onRestore={loadDocument} />}

        <div className="editor-container">
          {editorMode === 'richtext' ? (
            <RichTextEditor content={content} setContent={setContent} />
          ) : (
            <MarkdownEditor content={content} setContent={setContent} />
          )}
        </div>
      </div>
    </StdLayout>
  );
}