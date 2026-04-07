/**
 * Cloud Codex - Editor Page
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import StdLayout from '../page_layouts/Std_Layout';
import JoditEditor from 'jodit-react';
import { marked } from 'marked';
import TurndownService from 'turndown';
import DOMPurify from 'dompurify';
import { getPreferredEditorMode } from '../userPrefs';
import useCollab from '../hooks/useCollab';
import CollabPresence from '../components/CollabPresence';
import { RichTextCursors, MarkdownCursors } from '../components/RemoteCursors';
import { RichTextHighlights, MarkdownHighlights } from '../components/CommentHighlights';
import {
  fetchDocument,
  saveDocument,
  updatePageTitle,
  publishVersion,
  fetchVersions,
  fetchVersion,
  restoreVersion,
  deleteVersion,
  exportDocument,
  showModal,
  destroyModal,
  fetchComments,
  createComment,
  resolveComment,
  reopenComment,
  deleteComment as apiDeleteComment,
  clearAllComments,
  addCommentReply,
  deleteCommentReply,
  getSessStorage,
} from '../util';
import PublishModal from '../components/PublishModal';
import { toastError } from '../components/Toast';
import CommentSidebar from '../components/CommentSidebar';
import CommentForm from '../components/CommentForm';
import CommentManager from '../components/CommentManager';

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

/** Calculate character offset from the start of a contentEditable element to a given node+offset */
function getCharOffset(root, targetNode, targetOffset) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let offset = 0;
  let node;
  while ((node = walker.nextNode())) {
    if (node === targetNode) return offset + targetOffset;
    offset += node.textContent.length;
  }
  return offset;
}

function htmlToMarkdown(html) {
  if (!html) return '';
  return turndown.turndown(html);
}

function markdownToHtml(md) {
  if (!md) return '';
  return sanitizeHtml(marked.parse(md));
}

// --- Jodit Editor wrapper ---

function RichTextEditor({ content, setContent, contentRef, onLocalChange, onCursorChange, remoteCursors, comments, activeCommentId }) {
  const editor = useRef(null);
  // Local state drives Jodit's value — prevents parent re-renders from resetting the editor
  const [local, setLocal] = useState(content);
  const internalRef = useRef(false);

  // Sync from parent only on genuine external changes (doc load, version restore, remote collab update)
  useEffect(() => {
    if (internalRef.current) {
      internalRef.current = false;
      return;
    }
    setLocal(content);
    contentRef.current = content;
  }, [content, contentRef]);

  // Track cursor/selection position inside Jodit's iframe
  useEffect(() => {
    const jodit = editor.current;
    if (!jodit?.editor || !onCursorChange) return;

    const editorEl = jodit.editor;
    const editorDoc = editorEl.ownerDocument;

    const handleSelection = () => {
      const sel = editorDoc.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      // Calculate character offset from start of editor
      const offset = getCharOffset(editorEl, range.startContainer, range.startOffset);
      const selectedText = sel.toString();
      onCursorChange({ index: offset, length: selectedText.length, selectedText });
    };

    editorDoc.addEventListener('selectionchange', handleSelection);
    editorEl.addEventListener('click', handleSelection);
    editorEl.addEventListener('keyup', handleSelection);

    return () => {
      editorDoc.removeEventListener('selectionchange', handleSelection);
      editorEl.removeEventListener('click', handleSelection);
      editorEl.removeEventListener('keyup', handleSelection);
    };
  }, [onCursorChange]);

  const config = useMemo(() => ({
    readonly: false,
    placeholder: 'Start typing...',
    theme: 'dark',
  }), []);

  const handleBlur = useCallback((newContent) => {
    contentRef.current = newContent;
    setLocal(newContent);
    internalRef.current = true;
    setContent(newContent);
    onLocalChange?.(newContent);
  }, [setContent, contentRef, onLocalChange]);

  const handleChange = useCallback((newContent) => {
    contentRef.current = newContent;
    onLocalChange?.(newContent);
  }, [contentRef, onLocalChange]);

  // Mount cursor overlay into .jodit-workplace so it sits over only the content area
  const [cursorContainer, setCursorContainer] = useState(null);
  useEffect(() => {
    const jodit = editor.current;
    if (!jodit?.container) return;
    const workplace = jodit.container.querySelector('.jodit-workplace');
    if (workplace) {
      workplace.style.position = 'relative';
      setCursorContainer(workplace);
    }
  }, [local]); // re-check when editor content initializes

  return (
    <>
      <JoditEditor
        ref={editor}
        value={local}
        config={config}
        onBlur={handleBlur}
        onChange={handleChange}
      />
      {cursorContainer && createPortal(
        <RichTextCursors remoteCursors={remoteCursors} editorRef={editor} />,
        cursorContainer
      )}
      {cursorContainer && createPortal(
        <RichTextHighlights editorRef={editor} comments={comments || []} activeCommentId={activeCommentId} />,
        cursorContainer
      )}
    </>
  );
}

// --- Markdown Editor with live preview ---

function MarkdownEditor({ content, setContent, contentRef, onLocalChange, onCursorChange, remoteCursors, comments, activeCommentId }) {
  const [md, setMd] = useState(() => htmlToMarkdown(content));
  const [preview, setPreview] = useState(() => sanitizeHtml(content || ''));
  const textareaRef = useRef(null);
  const previewRef = useRef(null);
  const initializedRef = useRef(false);
  const selfUpdateRef = useRef(false);

  // Track cursor position
  const trackCursor = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta || !onCursorChange) return;
    const text = ta.value.substring(0, ta.selectionStart);
    const line = (text.match(/\n/g) || []).length;
    const selectedText = ta.value.substring(ta.selectionStart, ta.selectionEnd);
    onCursorChange({ index: ta.selectionStart, line, length: ta.selectionEnd - ta.selectionStart, selectedText });
  }, [onCursorChange]);

  // Sync when content changes externally (e.g. version restore)
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }
    // Skip round-trip when we caused the change ourselves
    if (selfUpdateRef.current) {
      selfUpdateRef.current = false;
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
    selfUpdateRef.current = true;
    if (contentRef) contentRef.current = html;
    setContent(html);
    onLocalChange?.(html);
    trackCursor();
  }, [setContent, contentRef, onLocalChange, trackCursor]);

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
      const tabHtml = markdownToHtml(newVal);
      setPreview(tabHtml);
      selfUpdateRef.current = true;
      if (contentRef) contentRef.current = tabHtml;
      setContent(tabHtml);
      onLocalChange?.(tabHtml);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  }, [setContent, contentRef, onLocalChange]);

  return (
    <div className="markdown-editor">
      <div className="markdown-editor__pane markdown-editor__input">
        <div className="markdown-editor__label">Markdown</div>
        <div className="markdown-editor__textarea-wrapper">
          <textarea
            ref={textareaRef}
            className="markdown-editor__textarea"
            value={md}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onKeyUp={trackCursor}
            onClick={trackCursor}
            placeholder="Write markdown here..."
            spellCheck={false}
          />
          <MarkdownCursors remoteCursors={remoteCursors} textareaRef={textareaRef} />
        </div>
      </div>
      <div className="markdown-editor__pane markdown-editor__preview">
        <div className="markdown-editor__label">Preview</div>
        <div
          ref={previewRef}
          className="markdown-editor__rendered"
          dangerouslySetInnerHTML={{ __html: preview }}
        />
        <MarkdownHighlights previewRef={previewRef} comments={comments || []} activeCommentId={activeCommentId} />
      </div>
    </div>
  );
}

// --- Version History Panel ---

function timeAgo(dateStr) {
  const s = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function VersionHistory({ pageId, onRestore, versionKey }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(null);
  const [previewId, setPreviewId] = useState(null);

  const loadVersions = useCallback(async () => {
    try {
      const res = await fetchVersions(pageId);
      setVersions(res.versions || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [pageId, versionKey]);

  useEffect(() => { loadVersions(); }, [loadVersions]);

  const handlePreview = async (v) => {
    if (previewId === v.id) {
      setPreview(null);
      setPreviewId(null);
      return;
    }
    try {
      const res = await fetchVersion(pageId, v.id);
      setPreview(res.version);
      setPreviewId(v.id);
    } catch { /* ignore */ }
  };

  const handleRestore = async (v) => {
    try {
      await restoreVersion(pageId, v.id);
      onRestore?.();
      setPreview(null);
      setPreviewId(null);
    } catch (e) { toastError(e); }
  };

  const handleDelete = async (v) => {
    try {
      await deleteVersion(pageId, v.id);
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
            <div className={`version-list__item${previewId === v.id ? ' version-list__item--active' : ''}`}
                 onClick={() => handlePreview(v)} role="button" tabIndex={0}>
              <div className="version-list__info">
                <span className="version-list__heading">
                  {v.title || `Version ${v.version_number}`}
                </span>
                {v.notes && <span className="version-list__notes">{v.notes}</span>}
                <span className="version-list__meta">
                  <span className="version-list__badge">v{v.version_number}</span>
                  <span className="version-list__date">{timeAgo(v.saved_at)}</span>
                  {v.created_by && <span className="version-list__author">{v.created_by}</span>}
                </span>
              </div>
              {previewId !== v.id && <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); handleRestore(v); }}>Restore</button>}
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

// --- Editor Page ---

export default function Editor() {
  const { pageId } = useParams();
  const navigate = useNavigate();
  const [content, setContent] = useState('');
  const contentRef = useRef('');
  const [documentData, setDocumentData] = useState(null);
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState('');
  const [showVersions, setShowVersions] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const exportRef = useRef(null);
  const [editorMode, setEditorMode] = useState(() => getPreferredEditorMode()); // 'richtext' | 'markdown'
  const remoteUpdateRef = useRef(false);
  const [versionKey, setVersionKey] = useState(0);

  // --- Auto-save state ---
  const dirtyRef = useRef(false);          // true when local edits haven't been saved yet
  const lastSavedRef = useRef(null);       // timestamp of last successful save
  const [autoSaveLabel, setAutoSaveLabel] = useState(''); // shown next to save button

  // --- Comment state ---
  const [comments, setComments] = useState([]);
  const [showComments, setShowComments] = useState(false);
  const [showCommentForm, setShowCommentForm] = useState(false);
  const [commentSelection, setCommentSelection] = useState(null); // { start, end, text }
  const [highlightedCommentId, setHighlightedCommentId] = useState(null);
  const [commentFilterStatus, setCommentFilterStatus] = useState('open');

  // Get current user ID from session storage
  const currentUserId = getSessStorage('currentUser')?.id;

  // Handle remote comment events from WebSocket
  const handleRemoteComment = useCallback((msg) => {
    switch (msg.action) {
      case 'add':
        if (msg.comment) setComments(prev => [...prev, msg.comment]);
        break;
      case 'update':
        if (msg.comment) setComments(prev => prev.map(c => c.id === msg.comment.id ? { ...c, ...msg.comment, replies: c.replies } : c));
        break;
      case 'resolve':
        if (msg.comment) setComments(prev => prev.map(c => c.id === msg.comment.id ? { ...c, ...msg.comment, replies: c.replies } : c));
        break;
      case 'reopen':
        if (msg.commentId) setComments(prev => prev.map(c => c.id === msg.commentId ? { ...c, status: 'open', resolved_by: null, resolved_at: null } : c));
        break;
      case 'delete':
        if (msg.commentId) setComments(prev => prev.filter(c => c.id !== msg.commentId));
        break;
      case 'reply':
        if (msg.reply && msg.commentId) setComments(prev => prev.map(c => c.id === msg.commentId ? { ...c, replies: [...(c.replies || []), msg.reply] } : c));
        break;
      case 'clear':
        setComments([]);
        break;
    }
  }, []);

  // Collaborative editing hook
  const { collabUsers, collabConnected, remoteCursors, sendUpdate, sendCursor, sendSave, sendPublish, sendCommentEvent } = useCollab(
    pageId,
    // onRemoteUpdate — called when a peer changes the document
    useCallback((html) => {
      remoteUpdateRef.current = true;
      contentRef.current = html;
      setContent(html);
    }, []),
    // onRemoteComment — called when a peer performs a comment action
    handleRemoteComment,
    // onPublished — called when the server confirms a version was published
    useCallback(() => { setVersionKey(k => k + 1); }, [])
  );

  // Keep contentRef in sync whenever content state changes (load, blur, markdown edits)
  useEffect(() => { contentRef.current = content; }, [content]);

  // Close export dropdown when clicking outside
  useEffect(() => {
    if (!showExport) return;
    const handleClickOutside = (e) => {
      if (exportRef.current && !exportRef.current.contains(e.target)) {
        setShowExport(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showExport]);

  // Debounced send to collab peers on local change
  const sendTimerRef = useRef(null);
  const handleLocalChange = useCallback((html) => {
    // Don't echo remote updates back to the server
    if (remoteUpdateRef.current) {
      remoteUpdateRef.current = false;
      return;
    }
    dirtyRef.current = true;
    if (sendTimerRef.current) clearTimeout(sendTimerRef.current);
    sendTimerRef.current = setTimeout(() => sendUpdate(html), 150);
  }, [sendUpdate]);

  // Debounced cursor position broadcast
  const cursorTimerRef = useRef(null);
  const selectionRef = useRef({ text: '', start: 0, end: 0 });
  const handleCursorChange = useCallback((position) => {
    if (cursorTimerRef.current) clearTimeout(cursorTimerRef.current);
    cursorTimerRef.current = setTimeout(() => sendCursor(position), 100);
    if (position.selectedText !== undefined) {
      selectionRef.current = { text: position.selectedText, start: position.index, end: position.index + (position.length || 0) };
    }
  }, [sendCursor]);

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

  // Load comments for this page
  const loadComments = useCallback(async () => {
    if (!pageId) return;
    try {
      const res = await fetchComments(pageId);
      setComments(res.comments || []);
    } catch { /* ignore */ }
  }, [pageId]);

  useEffect(() => { loadComments(); }, [loadComments]);

  // --- Comment action handlers ---
  const handleAddComment = useCallback(async ({ content: text, tag }) => {
    try {
      const res = await createComment(pageId, {
        content: text,
        tag,
        selection_start: commentSelection?.start ?? null,
        selection_end: commentSelection?.end ?? null,
        selected_text: commentSelection?.text ?? null,
      });
      setComments(prev => [...prev, res.comment]);
      sendCommentEvent({ action: 'add', comment: res.comment });
      setShowCommentForm(false);
      setCommentSelection(null);
    } catch (e) { toastError(e); }
  }, [pageId, commentSelection, sendCommentEvent]);

  const handleResolveComment = useCallback(async (id) => {
    try {
      const res = await resolveComment(id, 'resolved');
      setComments(prev => prev.map(c => c.id === id ? { ...c, ...res.comment, replies: c.replies } : c));
      sendCommentEvent({ action: 'resolve', comment: res.comment, commentId: id });
    } catch (e) { toastError(e); }
  }, [sendCommentEvent]);

  const handleDismissComment = useCallback(async (id) => {
    try {
      const res = await resolveComment(id, 'dismissed');
      setComments(prev => prev.map(c => c.id === id ? { ...c, ...res.comment, replies: c.replies } : c));
      sendCommentEvent({ action: 'resolve', comment: res.comment, commentId: id });
    } catch (e) { toastError(e); }
  }, [sendCommentEvent]);

  const handleReopenComment = useCallback(async (id) => {
    try {
      await reopenComment(id);
      setComments(prev => prev.map(c => c.id === id ? { ...c, status: 'open', resolved_by: null, resolved_at: null } : c));
      sendCommentEvent({ action: 'reopen', commentId: id });
    } catch (e) { toastError(e); }
  }, [sendCommentEvent]);

  const handleDeleteComment = useCallback(async (id) => {
    try {
      await apiDeleteComment(id);
      setComments(prev => prev.filter(c => c.id !== id));
      sendCommentEvent({ action: 'delete', commentId: id });
    } catch (e) { toastError(e); }
  }, [sendCommentEvent]);

  const handleCommentReply = useCallback(async (commentId, text) => {
    try {
      const res = await addCommentReply(commentId, text);
      setComments(prev => prev.map(c =>
        c.id === commentId ? { ...c, replies: [...(c.replies || []), res.reply] } : c
      ));
      sendCommentEvent({ action: 'reply', reply: res.reply, commentId });
    } catch (e) { toastError(e); throw e; }
  }, [sendCommentEvent]);

  const handleDeleteReply = useCallback(async (replyId, commentId) => {
    try {
      await deleteCommentReply(replyId);
      setComments(prev => prev.map(c =>
        c.id === commentId ? { ...c, replies: (c.replies || []).filter(r => r.id !== replyId) } : c
      ));
      sendCommentEvent({ action: 'delete', replyId, commentId });
    } catch (e) { toastError(e); }
  }, [sendCommentEvent]);

  const handleClearAllComments = useCallback(async () => {
    try {
      await clearAllComments(pageId);
      setComments([]);
      sendCommentEvent({ action: 'clear' });
    } catch (e) { toastError(e); }
  }, [pageId, sendCommentEvent]);

  // Get selected text for comment creation
  const handleStartComment = useCallback(() => {
    const sel = selectionRef.current;
    if (sel.text?.trim()) {
      setCommentSelection({
        start: sel.start,
        end: sel.end,
        text: sel.text.trim().slice(0, 500),
      });
      setShowCommentForm(true);
      setShowComments(true);
    } else {
      // No selection — create a general comment
      setCommentSelection(null);
      setShowCommentForm(true);
      setShowComments(true);
    }
  }, []);

  const openCommentManager = useCallback(() => {
    showModal(
      <CommentManager
        pageId={pageId}
        pageTitle={documentData?.title}
        onClose={destroyModal}
        onNavigate={(c) => {
          destroyModal();
          setShowComments(true);
          setHighlightedCommentId(c.id);
          setTimeout(() => setHighlightedCommentId(null), 3000);
        }}
      />,
      'modal-lg'
    );
  }, [pageId, documentData?.title]);

  const handleSave = useCallback(async (silent = false) => {
    if (savingRef.current) return;
    const latestContent = contentRef.current;
    if (!silent) setStatus(null);
    savingRef.current = true;
    setSaving(true);

    // If connected via collab, use the WebSocket save path
    if (collabConnected) {
      // Flush current content to the server before requesting save,
      // in case the debounced sendUpdate hasn't fired yet
      sendUpdate(latestContent);
      sendSave();
      setContent(latestContent);
      dirtyRef.current = false;
      lastSavedRef.current = Date.now();
      if (!silent) setStatus({ type: 'success', message: 'Document saved.' });
      savingRef.current = false;
      setSaving(false);
      return;
    }

    // Fallback to REST save when collab is disconnected
    try {
      await saveDocument(Number(pageId), latestContent);
      setContent(latestContent);
      dirtyRef.current = false;
      lastSavedRef.current = Date.now();
      if (!silent) setStatus({ type: 'success', message: 'Document saved.' });
    } catch (e) {
      setStatus({ type: 'error', message: `Error saving: ${e.body?.message ?? e.message}` });
    }
    savingRef.current = false;
    setSaving(false);
  }, [pageId, collabConnected, sendUpdate, sendSave]);

  // --- Auto-save every 30 seconds when there are unsaved changes ---
  const AUTO_SAVE_INTERVAL = 30_000;
  const handleSaveRef = useRef(handleSave);
  useEffect(() => { handleSaveRef.current = handleSave; }, [handleSave]);

  useEffect(() => {
    const id = setInterval(() => {
      if (dirtyRef.current) {
        handleSaveRef.current(true);
        setAutoSaveLabel('Auto-saved');
        setTimeout(() => setAutoSaveLabel(''), 3000);
      }
    }, AUTO_SAVE_INTERVAL);
    return () => clearInterval(id);
  }, []);

  // Update auto-save label periodically to show time since last save
  useEffect(() => {
    const id = setInterval(() => {
      if (!lastSavedRef.current) return;
      const ago = Math.round((Date.now() - lastSavedRef.current) / 1000);
      if (ago < 5) return; // freshly saved, don't overwrite "Auto-saved" or "Document saved."
      if (ago < 60) setAutoSaveLabel(`Saved ${ago}s ago`);
      else setAutoSaveLabel(`Saved ${Math.floor(ago / 60)}m ago`);
    }, 10_000);
    return () => clearInterval(id);
  }, []);

  const [publishing, setPublishing] = useState(false);

  const handlePublish = useCallback(async ({ title, notes } = {}) => {
    if (publishing) return;
    setStatus(null);
    setPublishing(true);

    // Save content first, then publish a version snapshot
    if (collabConnected) {
      sendPublish({ title, notes });
      setStatus({ type: 'success', message: 'Version published.' });
      setPublishing(false);
      return;
    }

    // REST fallback: save content first, then publish
    try {
      const latestContent = contentRef.current;
      await saveDocument(Number(pageId), latestContent);
      const result = await publishVersion(pageId, { title, notes });
      if (result?.version) {
        setDocumentData(d => d ? { ...d, version: result.version } : d);
      }
      setVersionKey(k => k + 1);
      setStatus({ type: 'success', message: `Version ${result?.version ?? ''} published.` });
    } catch (e) {
      setStatus({ type: 'error', message: `Error publishing: ${e.body?.message ?? e.message}` });
    }
    setPublishing(false);
  }, [pageId, publishing, collabConnected, sendPublish]);

  const openPublishModal = useCallback(() => {
    showModal(
      <PublishModal
        onPublish={async (opts) => {
          destroyModal();
          await handlePublish(opts);
        }}
        onCancel={destroyModal}
      />,
      'modal-md'
    );
  }, [handlePublish]);

  const handleTitleSave = async () => {
    if (!title.trim()) return;
    try {
      await updatePageTitle(pageId, title);
      setDocumentData(d => ({ ...d, title }));
    } catch { /* ignore */ }
    setEditingTitle(false);
  };

  const handleExport = useCallback(async (format) => {
    setShowExport(false);
    setStatus(null);
    try {
      await exportDocument(Number(pageId), format, documentData?.title, contentRef.current);
    } catch (e) {
      setStatus({ type: 'error', message: `Export failed: ${e.body?.message ?? e.message}` });
    }
  }, [pageId, documentData?.title]);

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
                <span>v{documentData.version ?? 1} &middot; {new Date(documentData.created_at).toLocaleString()}</span>
              </>
            )}
            <CollabPresence users={collabUsers} connected={collabConnected} />
          </div>
        </div>

        {status && (
          <p className={`editor-status ${status.type}`}>{status.message}</p>
        )}

        <div className="editor-toolbar">
          <div className="toolbar-group">
            <button className="btn btn-primary btn-sm" onClick={() => handleSave()} disabled={saving}>
              {saving ? 'Saving...' : '💾 Save'}
            </button>
            {autoSaveLabel && <span className="auto-save-label">{autoSaveLabel}</span>}
            <button className="btn btn-ghost btn-sm" onClick={openPublishModal} disabled={publishing}>
              {publishing ? 'Publishing...' : '📦 Publish'}
            </button>
          </div>

          <span className="toolbar-divider" />

          <div className="toolbar-group editor-mode-toggle">
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

          <span className="toolbar-divider" />

          <div className="toolbar-group">
            <button className="btn btn-ghost btn-sm" onMouseDown={(e) => { e.preventDefault(); handleStartComment(); }} title="Add a comment on selected text">
              💬 Comment
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowComments(v => !v)}>
              {showComments ? '💬 Hide' : `💬 ${comments.filter(c => c.status === 'open').length || ''}`}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={openCommentManager} title="Manage all comments">
              📋
            </button>
          </div>

          <span className="toolbar-divider" />

          <div className="toolbar-group">
            <button className="btn btn-ghost btn-sm" onClick={() => setShowVersions(v => !v)}>
              {showVersions ? '🕓 Hide History' : '🕓 History'}
            </button>
            <div className="export-dropdown" ref={exportRef}>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowExport(v => !v)}>
                📥 Export ▾
              </button>
              {showExport && (
                <div className="export-dropdown__menu">
                  <button className="export-dropdown__item" onClick={() => handleExport('html')}>HTML (.html)</button>
                  <button className="export-dropdown__item" onClick={() => handleExport('md')}>Markdown (.md)</button>
                  <button className="export-dropdown__item" onClick={() => handleExport('txt')}>Plain Text (.txt)</button>
                  <button className="export-dropdown__item" onClick={() => handleExport('pdf')}>PDF (.pdf)</button>
                  <button className="export-dropdown__item" onClick={() => handleExport('docx')}>Word (.docx)</button>
                </div>
              )}
            </div>
          </div>

          <div className="toolbar-spacer" />

          <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>← Back</button>
        </div>

        {showVersions && <VersionHistory pageId={pageId} onRestore={loadDocument} versionKey={versionKey} />}

        <div className="editor-with-comments">
          <div className="editor-container">
            {editorMode === 'richtext' ? (
              <RichTextEditor content={content} setContent={setContent} contentRef={contentRef} onLocalChange={handleLocalChange} onCursorChange={handleCursorChange} remoteCursors={remoteCursors} comments={comments} activeCommentId={highlightedCommentId} />
            ) : (
              <MarkdownEditor content={content} setContent={setContent} contentRef={contentRef} onLocalChange={handleLocalChange} onCursorChange={handleCursorChange} remoteCursors={remoteCursors} comments={comments} activeCommentId={highlightedCommentId} />
            )}
          </div>

          {showComments && (
            <div className="editor-comments-panel">
              {showCommentForm && (
                <CommentForm
                  selectedText={commentSelection?.text}
                  onSubmit={handleAddComment}
                  onCancel={() => { setShowCommentForm(false); setCommentSelection(null); }}
                />
              )}
              <CommentSidebar
                comments={comments}
                currentUserId={currentUserId}
                onResolve={handleResolveComment}
                onDismiss={handleDismissComment}
                onReopen={handleReopenComment}
                onDelete={handleDeleteComment}
                onReply={handleCommentReply}
                onDeleteReply={handleDeleteReply}
                highlightedCommentId={highlightedCommentId}
                onHoverComment={setHighlightedCommentId}
                filterStatus={commentFilterStatus}
                onFilterChange={setCommentFilterStatus}
              />
              {comments.length > 0 && (
                <button className="btn btn-ghost btn-sm btn-danger comment-clear-btn" onClick={handleClearAllComments}>
                  Clear All Comments
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </StdLayout>
  );
}