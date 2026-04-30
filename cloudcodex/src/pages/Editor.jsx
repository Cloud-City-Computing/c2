/**
 * Cloud Codex - Editor Log
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import StdLayout from '../page_layouts/Std_Layout';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import ResizableImage from '../components/ResizableImage';
import ImageCropModal from '../components/ImageCropModal';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Link from '@tiptap/extension-link';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import CodeBlockWithLanguage from '../components/CodeBlockWithLanguage';
import DrawioBlock from '../components/DrawioBlock';
import { createLowlight, common } from 'lowlight';
import { hastToHtml, decodeBase64 } from '../editorUtils';

const readonlyLowlight = createLowlight(common);
import { marked } from 'marked';
import TurndownService from 'turndown';
import DOMPurify from 'dompurify';
import { getPreferredEditorMode } from '../userPrefs';
import useCollab from '../hooks/useCollab';
import Collaboration from '@tiptap/extension-collaboration';
import CollabPresence from '../components/CollabPresence';
import { RichTextCursors, MarkdownCursors } from '../components/RemoteCursors';
import { RichTextHighlights, MarkdownHighlights } from '../components/CommentHighlights';
import {
  fetchDocument,
  saveDocument,
  updateLogTitle,
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
  getSessionTokenFromCookie,
  checkFavorite,
  addFavorite,
  checkWatch,
  addWatch,
  removeWatch,
  removeFavorite,
  timeAgo,
} from '../util';
import PublishModal from '../components/PublishModal';
import ExportMenu from '../components/ExportMenu';
import { toastError } from '../components/Toast';
import CommentSidebar from '../components/CommentSidebar';
import CommentForm from '../components/CommentForm';
import CommentManager from '../components/CommentManager';
import useGitHubLink from '../hooks/useGitHubLink';
import GitHubSyncBanner from '../components/GitHubSyncBanner';
import GitHubCodeEmbed from '../extensions/GitHubCodeEmbed';
import GitHubIssueEmbed from '../extensions/GitHubIssueEmbed';
import Mention, { MentionPicker } from '../extensions/Mention';
import CodeEmbedPickerModal from '../components/github/CodeEmbedPickerModal';
import IssuePickerModal from '../components/github/IssuePickerModal';

// Configure marked for safe rendering
marked.setOptions({ breaks: true, gfm: true });

/**
 * Upload an image file to the server and return the served URL.
 * Used by the markdown editor's paste handler.
 * @param {File} file
 * @returns {Promise<string|null>} The image URL, or null on failure
 */
async function uploadImageFile(file) {
  const token = getSessionTokenFromCookie();
  const formData = new FormData();
  formData.append('files', file);
  try {
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch('/api/doc-images/upload', {
      method: 'POST',
      headers,
      body: formData,
    });
    const json = await res.json();
    if (json.success && json.urls?.length) {
      return json.urls[0];
    }
  } catch (err) {
    console.error('[editor] Image upload failed:', err);
  }
  return null;
}

/**
 * Insert a placeholder image at the current cursor position (or a specified pos),
 * upload the file, then replace the placeholder with the served URL.
 * Uses the Tiptap editor API so it works from toolbar, paste, and drop.
 */
async function insertImagePlaceholderAndUpload(editor, file, insertPos) {
  if (!editor) return;
  // Insert a placeholder image with a loading indicator via alt text
  const placeholderSrc = URL.createObjectURL(file);
  const pos = insertPos ?? editor.state.selection.from;
  editor.chain().focus().insertContentAt(pos, {
    type: 'image',
    attrs: { src: placeholderSrc, alt: 'Uploading…' },
  }).run();

  const url = await uploadImageFile(file);
  URL.revokeObjectURL(placeholderSrc);

  if (url) {
    // Find the placeholder node and replace its src
    const { doc } = editor.state;
    doc.descendants((node, nodePos) => {
      if (node.type.name === 'image' && node.attrs.src === placeholderSrc) {
        editor.chain().setNodeSelection(nodePos).updateAttributes('image', {
          src: url,
          alt: '',
        }).run();
        return false; // stop traversal
      }
    });
  } else {
    // Upload failed — remove the placeholder
    const { doc } = editor.state;
    doc.descendants((node, nodePos) => {
      if (node.type.name === 'image' && node.attrs.src === placeholderSrc) {
        editor.chain().setNodeSelection(nodePos).deleteSelection().run();
        return false;
      }
    });
  }
}

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

/** Read-only content renderer — pre-processes HTML with syntax highlighting and draw.io SVGs */
function ReadOnlyContent({ html }) {
  const processedHtml = useMemo(() => {
    if (!html) return '';
    const sanitized = sanitizeHtml(html);
    // Parse into a DOM so we can process code blocks and diagrams
    const parser = new DOMParser();
    const doc = parser.parseFromString('<div>' + sanitized + '</div>', 'text/html');
    const container = doc.body.firstChild;

    // Highlight code blocks with lowlight
    const codeBlocks = container.querySelectorAll('pre code');
    for (const codeEl of codeBlocks) {
      const pre = codeEl.parentElement;
      const langClass = [...codeEl.classList].find(c => c.startsWith('language-'));
      const lang = langClass ? langClass.replace('language-', '') : '';
      const text = codeEl.textContent || '';
      try {
        const result = lang && lang !== 'plaintext'
          ? readonlyLowlight.highlight(lang, text)
          : readonlyLowlight.highlightAuto(text);
        codeEl.innerHTML = hastToHtml(result);
        codeEl.classList.add('hljs');
        const detectedLang = lang || result.data?.language || '';
        if (detectedLang && pre) {
          const badge = doc.createElement('span');
          badge.className = 'code-lang-badge';
          badge.textContent = detectedLang;
          pre.appendChild(badge);
        }
      } catch { /* leave unhighlighted */ }
    }

    // Process draw.io diagram blocks — handle both legacy (base64 data attr)
    // and current (inline SVG) formats
    const drawioBlocks = container.querySelectorAll('div[data-type="drawioBlock"], div[data-drawio-svg]');
    for (const div of drawioBlocks) {
      // Legacy format: decode base64 from data-drawio-svg attribute
      const b64 = div.getAttribute('data-drawio-svg');
      if (b64) {
        try {
          const svgStr = decodeBase64(b64);
          const clean = DOMPurify.sanitize(svgStr, { USE_PROFILES: { svg: true, svgFilters: true } });
          div.innerHTML = clean;
        } catch { /* leave empty */ }
      }
      // Current format: SVG is already inline, just ensure it's sanitized
      // (sanitizeHtml at the top of this function already handled it)
    }

    return container.innerHTML;
  }, [html]);

  return (
    <div
      className="document-readonly"
      dangerouslySetInnerHTML={{ __html: processedHtml }}
    />
  );
}

// --- Tiptap Formatting Toolbar ---

function TiptapToolbar({ editor, onImageSelect }) {
  const fileInputRef = useRef(null);
  // Force re-render on every editor transaction so active states update immediately
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const handler = () => setTick(t => t + 1);
    editor.on('transaction', handler);
    return () => editor.off('transaction', handler);
  }, [editor]);

  if (!editor) return null;

  const handleFileSelect = (e) => {
    const files = e.target.files;
    if (!files?.length) return;
    const images = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (onImageSelect && images.length > 0) onImageSelect(images);
    e.target.value = ''; // reset so the same file can be selected again
  };

  const btnClass = (active) => `tiptap-toolbar__btn${active ? ' tiptap-toolbar__btn--active' : ''}`;

  return (
    <div className="tiptap-toolbar">
      <div className="tiptap-toolbar__group">
        <button className={btnClass(editor.isActive('bold'))} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold">
          <strong>B</strong>
        </button>
        <button className={btnClass(editor.isActive('italic'))} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic">
          <em>I</em>
        </button>
        <button className={btnClass(editor.isActive('underline'))} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline">
          <u>U</u>
        </button>
        <button className={btnClass(editor.isActive('strike'))} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough">
          <s>S</s>
        </button>
        <button className={btnClass(editor.isActive('code'))} onClick={() => editor.chain().focus().toggleCode().run()} title="Inline Code">
          <code>&lt;/&gt;</code>
        </button>
        <button
          className={btnClass(editor.isActive('link'))}
          onClick={() => {
            if (editor.isActive('link')) {
              editor.chain().focus().unsetLink().run();
            } else {
              // eslint-disable-next-line no-alert
              const url = window.prompt('URL:');
              if (url) editor.chain().focus().setLink({ href: url }).run();
            }
          }}
          title="Link"
        >
          🔗
        </button>
      </div>

      <span className="tiptap-toolbar__divider" />

      <div className="tiptap-toolbar__group">
        <button className={btnClass(editor.isActive('heading', { level: 1 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Heading 1">
          H1
        </button>
        <button className={btnClass(editor.isActive('heading', { level: 2 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2">
          H2
        </button>
        <button className={btnClass(editor.isActive('heading', { level: 3 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Heading 3">
          H3
        </button>
      </div>

      <span className="tiptap-toolbar__divider" />

      <div className="tiptap-toolbar__group">
        <button className={btnClass(editor.isActive('bulletList'))} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet List">
          &#8226; List
        </button>
        <button className={btnClass(editor.isActive('orderedList'))} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered List">
          1. List
        </button>
        <button className={btnClass(editor.isActive('blockquote'))} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Blockquote">
          &ldquo; Quote
        </button>
        <button className={btnClass(editor.isActive('codeBlock'))} onClick={() => editor.chain().focus().toggleCodeBlock().run()} title="Code Block">
          {'{ }'}
        </button>
        <button className="tiptap-toolbar__btn" onClick={() => editor.chain().focus().insertDrawioBlock().run()} title="Diagram (draw.io)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><line x1="10" y1="6.5" x2="14" y2="6.5" /><line x1="6.5" y1="10" x2="6.5" y2="14" /><line x1="14" y1="17.5" x2="10" y2="17.5" /></svg>
        </button>
        <button
          className="tiptap-toolbar__btn"
          onClick={() => {
            showModal(
              <CodeEmbedPickerModal
                onInsert={(attrs) => {
                  destroyModal();
                  editor.chain().focus().insertGitHubCodeEmbed(attrs).run();
                }}
                onCancel={destroyModal}
              />,
              'modal-md'
            );
          }}
          title="Insert GitHub code reference"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>
        </button>
        <button
          className="tiptap-toolbar__btn"
          onClick={() => {
            showModal(
              <IssuePickerModal
                onInsert={(attrs) => {
                  destroyModal();
                  editor.chain().focus().insertGitHubIssueEmbed(attrs).run();
                }}
                onCancel={destroyModal}
              />,
              'modal-md'
            );
          }}
          title="Insert GitHub issue reference"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2" fill="currentColor" /></svg>
        </button>
        <button className="tiptap-toolbar__btn" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title="Insert Table">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="9" y1="3" x2="9" y2="21" /><line x1="15" y1="3" x2="15" y2="21" /></svg>
        </button>
      </div>

      <span className="tiptap-toolbar__divider" />

      <div className="tiptap-toolbar__group">
        <button className={btnClass(editor.isActive({ textAlign: 'left' }))} onClick={() => editor.chain().focus().setTextAlign('left').run()} title="Align Left">
          &#8676;
        </button>
        <button className={btnClass(editor.isActive({ textAlign: 'center' }))} onClick={() => editor.chain().focus().setTextAlign('center').run()} title="Align Center">
          &#8596;
        </button>
        <button className={btnClass(editor.isActive({ textAlign: 'right' }))} onClick={() => editor.chain().focus().setTextAlign('right').run()} title="Align Right">
          &#8677;
        </button>
      </div>

      <span className="tiptap-toolbar__divider" />

      <div className="tiptap-toolbar__group">
        <button className="tiptap-toolbar__btn" onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Horizontal Rule">
          ―
        </button>
        <button className="tiptap-toolbar__btn" onClick={() => fileInputRef.current?.click()} title="Upload Image">
          🖼
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/bmp"
          multiple
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />
      </div>

      <span className="tiptap-toolbar__divider" />

      <div className="tiptap-toolbar__group">
        <button className="tiptap-toolbar__btn" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo">
          ↩
        </button>
        <button className="tiptap-toolbar__btn" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo">
          ↪
        </button>
      </div>
    </div>
  );
}

// --- Tiptap Rich Text Editor wrapper ---

function RichTextEditor({ content, setContent, contentRef, onLocalChange, onCursorChange, remoteCursors, comments, activeCommentId, ydoc, synced, restoreKey }) {
  const editorContainerRef = useRef(null);
  // Stable ref to the editor instance for use in editorProps closures (avoids stale closures)
  const editorInstanceRef = useRef(null);
  // Track whether the Y.Doc was already initialised from REST HTML (migration path)
  const initializedFromHtml = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false, underline: false, undoRedo: false }), // disable undo-redo — Collaboration provides its own; disable underline — we configure it separately below
      CodeBlockWithLanguage,
      DrawioBlock,
      GitHubCodeEmbed,
      GitHubIssueEmbed,
      Mention,
      ResizableImage.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({ placeholder: 'Start typing...' }),
      Underline,
      Link.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      // --- Collaboration: binds ProseMirror state to the shared Y.Doc ---
      Collaboration.configure({
        document: ydoc,
      }),
    ],
    // Initial content is empty; the Collaboration extension populates the
    // editor from the Y.Doc once synced.  If the Y.Doc is empty (first load
    // / migration) we manually insert the REST content after sync completes.
    content: '',
    editorProps: {
      attributes: { class: 'tiptap-editor' },
      handleDrop: (view, event) => {
        const files = event.dataTransfer?.files;
        if (!files?.length) return false;
        const images = Array.from(files).filter(f => f.type.startsWith('image/'));
        if (images.length === 0) return false;
        event.preventDefault();
        // Use the drop coordinates to determine insertion position
        const dropPos = view.posAtCoords({ left: event.clientX, top: event.clientY });
        images.forEach(file => insertImagePlaceholderAndUpload(editorInstanceRef.current, file, dropPos?.pos));
        return true;
      },
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            event.preventDefault();
            const file = item.getAsFile();
            if (file) insertImagePlaceholderAndUpload(editorInstanceRef.current, file);
            return true;
          }
        }
        return false;
      },
    },
    onUpdate({ editor }) {
      // The Collaboration extension fires onUpdate for BOTH local and remote
      // changes.  We keep contentRef / content in sync for auto-save,
      // markdown mode, and other non-editor consumers.
      const html = editor.getHTML();
      contentRef.current = html;
      // Defer state updates: the Collaboration extension can fire onUpdate
      // during the initial render (via _forceRerender), and calling
      // setContent / onLocalChange synchronously would update the parent
      // Editor component while RichTextEditor is still rendering.
      queueMicrotask(() => {
        setContent(html);
        onLocalChange?.(html);
      });
    },
    onSelectionUpdate({ editor }) {
      if (!onCursorChange) return;
      const { from, to } = editor.state.selection;
      const text = editor.state.doc.textBetween(from, to, ' ');
      onCursorChange({ index: from, length: to - from, selectedText: text });
    },
  });

  // Keep editor ref in sync for editorProps closures
  useEffect(() => { editorInstanceRef.current = editor; }, [editor]);

  // Migration path: after Yjs sync completes, if the Y.Doc's fragment is
  // still empty (no ydoc_state in DB yet), populate it from the REST HTML.
  // The Collaboration extension will propagate this to Y.Doc → server.
  useEffect(() => {
    if (!editor || !synced || initializedFromHtml.current) return;
    const fragment = ydoc.getXmlFragment('default');
    if (fragment.length === 0 && content) {
      editor.commands.setContent(content, false);
      initializedFromHtml.current = true;
    }
  }, [editor, synced, content, ydoc]);

  // Sync from parent only for version restores.  Triggered when `restoreKey`
  // changes, meaning the parent explicitly loaded new content after a restore.
  // During normal editing the Collaboration extension keeps the editor and
  // Y.Doc in sync automatically via the shared Y.Doc.
  const prevRestoreKey = useRef(restoreKey);
  useEffect(() => {
    if (!editor) return;
    if (prevRestoreKey.current === restoreKey) return;
    prevRestoreKey.current = restoreKey;
    // Force the restored content into the editor (and therefore the Y.Doc)
    editor.commands.setContent(content || '', false);
  }, [restoreKey, content, editor]);

  // Detect the Tiptap editor DOM container for portal overlays
  const [overlayContainer, setOverlayContainer] = useState(null);
  useEffect(() => {
    if (!editorContainerRef.current) return;
    const tiptapEl = editorContainerRef.current.querySelector('.tiptap');
    if (tiptapEl) {
      tiptapEl.parentElement.style.position = 'relative';
      setOverlayContainer(tiptapEl.parentElement);
    }
  }, [editor]);

  // --- Crop modal state (for toolbar uploads only) ---
  const [cropQueue, setCropQueue] = useState([]);
  const cropFile = cropQueue.length > 0 ? cropQueue[0] : null;

  const handleToolbarImageSelect = (files) => {
    setCropQueue(files);
  };

  const handleCropConfirm = (resultFile) => {
    insertImagePlaceholderAndUpload(editorInstanceRef.current || editor, resultFile);
    setCropQueue(prev => prev.slice(1));
  };

  const handleCropCancel = () => {
    setCropQueue(prev => prev.slice(1));
  };

  return (
    <>
      <TiptapToolbar editor={editor} onImageSelect={handleToolbarImageSelect} />
      <div ref={editorContainerRef}>
        <EditorContent editor={editor} />
        <MentionPicker editor={editor} />
      </div>
      {overlayContainer && createPortal(
        <RichTextCursors remoteCursors={remoteCursors} editorRef={{ current: editor }} />,
        overlayContainer
      )}
      {overlayContainer && createPortal(
        <RichTextHighlights editorRef={{ current: editor }} comments={comments || []} activeCommentId={activeCommentId} />,
        overlayContainer
      )}
      {cropFile && <ImageCropModal file={cropFile} onConfirm={handleCropConfirm} onCancel={handleCropCancel} />}
    </>
  );
}

// --- Markdown Editor with live preview ---

function MarkdownEditor({ content, setContent, contentRef, onLocalChange, onCursorChange, remoteCursors, comments, activeCommentId, markdownContent, onMarkdownChange }) {
  // Use stored raw markdown if available; fall back to HTML→markdown conversion
  const [md, setMd] = useState(() => markdownContent ?? htmlToMarkdown(content));
  const [preview, setPreview] = useState(() => markdownContent ? sanitizeHtml(marked.parse(markdownContent)) : sanitizeHtml(content || ''));
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
    onMarkdownChange?.(val);
    onLocalChange?.(html);
    trackCursor();
  }, [setContent, contentRef, onLocalChange, onMarkdownChange, trackCursor]);

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
      onMarkdownChange?.(newVal);
      onLocalChange?.(tabHtml);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  }, [setContent, contentRef, onLocalChange, onMarkdownChange]);

  // Handle image paste in markdown editor — intercepts clipboard images,
  // uploads them to the server, and inserts a markdown image reference.
  const handlePaste = useCallback(async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;

        const ta = textareaRef.current;
        const start = ta.selectionStart;
        const val = ta.value;

        // Insert placeholder while uploading
        const placeholder = '![Uploading image...]()';
        const withPlaceholder = val.substring(0, start) + placeholder + val.substring(ta.selectionEnd);
        setMd(withPlaceholder);

        const url = await uploadImageFile(file);
        if (url) {
          const imgMarkdown = `![image](${url})`;
          const newVal = withPlaceholder.replace(placeholder, imgMarkdown);
          setMd(newVal);
          const html = markdownToHtml(newVal);
          setPreview(html);
          selfUpdateRef.current = true;
          if (contentRef) contentRef.current = html;
          setContent(html);
          onMarkdownChange?.(newVal);
          onLocalChange?.(html);
        } else {
          // Upload failed — remove placeholder
          setMd(val);
        }
        return; // Only handle the first image
      }
    }
  }, [setContent, contentRef, onLocalChange, onMarkdownChange]);

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
            onPaste={handlePaste}
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

function VersionHistory({ logId, onRestore, versionKey }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(null);
  const [previewId, setPreviewId] = useState(null);

  const loadVersions = useCallback(async () => {
    try {
      const res = await fetchVersions(logId);
      setVersions(res.versions || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [logId, versionKey]);

  useEffect(() => { loadVersions(); }, [loadVersions]);

  const handlePreview = async (v) => {
    if (previewId === v.id) {
      setPreview(null);
      setPreviewId(null);
      return;
    }
    try {
      const res = await fetchVersion(logId, v.id);
      setPreview(res.version);
      setPreviewId(v.id);
    } catch { /* ignore */ }
  };

  const handleRestore = async (v) => {
    try {
      await restoreVersion(logId, v.id);
      onRestore?.();
      setPreview(null);
      setPreviewId(null);
    } catch (e) { toastError(e); }
  };

  const handleDelete = async (v) => {
    try {
      await deleteVersion(logId, v.id);
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

// --- Editor Log ---

const isMobileDevice = () => window.matchMedia('(max-width: 768px)').matches;

export default function Editor({ embedded = false } = {}) {
  const params = useParams();
  const logId = params.logId;
  const navigate = useNavigate();
  const [content, setContent] = useState('');
  const contentRef = useRef('');
  const [markdownContent, setMarkdownContent] = useState(null); // raw markdown from server, null if not a markdown-sourced doc
  const markdownContentRef = useRef(null);
  const [documentData, setDocumentData] = useState(null);
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState('');
  const [showVersions, setShowVersions] = useState(false);
  const [editorMode, setEditorMode] = useState(() => getPreferredEditorMode()); // 'richtext' | 'markdown'
  const [versionKey, setVersionKey] = useState(0);
  const [restoreKey, setRestoreKey] = useState(0);
  const [viewMode, setViewMode] = useState(embedded ? 'read' : 'edit'); // 'read' | 'edit'

  // --- GitHub sync (link, status, pull/push/resolve) ---
  const ghSync = useGitHubLink(logId ? Number(logId) : null);

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

  // --- Favorite state ---
  const [isFavorited, setIsFavorited] = useState(false);
  const [favLoading, setFavLoading] = useState(false);

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

  // Collaborative editing hook — provides a shared Y.Doc for CRDT-based sync.
  // Document content flows through the Y.Doc (binary), not HTML strings.
  const { ydoc, synced, collabUsers, collabConnected, remoteCursors, sendCursor, sendSave, sendPublish, sendTitle, sendCommentEvent } = useCollab(
    logId,
    // onRemoteUpdate — no longer used; the Collaboration extension syncs
    // the Tiptap editor directly from the Y.Doc.  Kept as null placeholder
    // to maintain the hook's parameter order.
    null,
    // onRemoteComment — called when a peer performs a comment action
    handleRemoteComment,
    // onPublished — called when the server confirms a version was published
    useCallback(() => { setVersionKey(k => k + 1); }, []),
    // onRemoteTitle — called when a peer changes the document title
    useCallback((newTitle) => {
      setTitle(newTitle);
      setDocumentData(d => d ? { ...d, title: newTitle } : d);
    }, [])
  );

  // Keep contentRef in sync whenever content state changes (load, blur, markdown edits)
  useEffect(() => { contentRef.current = content; }, [content]);

  // Markdown content change handler — keeps the ref in sync for auto-save
  const handleMarkdownChange = useCallback((md) => {
    markdownContentRef.current = md;
    setMarkdownContent(md);
  }, []);

  // Local change handler — CRDT sync is automatic via Y.Doc, so this only
  // sets the dirty flag for auto-save tracking.  No more debounced sendUpdate.
  const handleLocalChange = useCallback(() => {
    dirtyRef.current = true;
  }, []);

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
    if (!logId) return;
    try {
      const res = await fetchDocument(logId);
      const doc = res?.document ?? null;
      setDocumentData(doc);
      setContent(doc?.html_content ?? '');
      const md = doc?.markdown_content ?? null;
      setMarkdownContent(md);
      markdownContentRef.current = md;
      setTitle(doc?.title ?? '');
      // If document has stored markdown, default to markdown editor mode
      if (md) setEditorMode('markdown');
    } catch (e) {
      setStatus({ type: 'error', message: e.body?.message ?? 'Error loading document.' });
    }
  }, [logId]);

  useEffect(() => { loadDocument(); }, [loadDocument]);

  // Load favorite status
  useEffect(() => {
    if (!logId) return;
    checkFavorite(Number(logId))
      .then(res => setIsFavorited(res.favorited))
      .catch(() => {});
  }, [logId]);

  const toggleFavorite = useCallback(async () => {
    if (favLoading || !logId) return;
    setFavLoading(true);
    try {
      if (isFavorited) {
        await removeFavorite(Number(logId));
        setIsFavorited(false);
      } else {
        await addFavorite(Number(logId));
        setIsFavorited(true);
      }
    } catch { /* ignore */ }
    setFavLoading(false);
  }, [logId, isFavorited, favLoading]);

  // Watch state for the doc
  const [watching, setWatching] = useState(false);
  const [watchLoading, setWatchLoading] = useState(false);

  useEffect(() => {
    if (!logId) return;
    checkWatch('log', Number(logId))
      .then((res) => setWatching(Boolean(res?.watching)))
      .catch(() => {});
  }, [logId]);

  const toggleWatch = useCallback(async () => {
    if (watchLoading || !logId) return;
    setWatchLoading(true);
    try {
      if (watching) {
        await removeWatch('log', Number(logId));
        setWatching(false);
      } else {
        await addWatch('log', Number(logId));
        setWatching(true);
      }
    } catch { /* ignore */ }
    setWatchLoading(false);
  }, [logId, watching, watchLoading]);

  // Load comments for this log
  const loadComments = useCallback(async () => {
    if (!logId) return;
    try {
      const res = await fetchComments(logId);
      setComments(res.comments || []);
    } catch { /* ignore */ }
  }, [logId]);

  useEffect(() => { loadComments(); }, [loadComments]);

  // --- Comment action handlers ---
  const handleAddComment = useCallback(async ({ content: text, tag }) => {
    try {
      const res = await createComment(logId, {
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
  }, [logId, commentSelection, sendCommentEvent]);

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
      await clearAllComments(logId);
      setComments([]);
      sendCommentEvent({ action: 'clear' });
    } catch (e) { toastError(e); }
  }, [logId, sendCommentEvent]);

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
        logId={logId}
        logTitle={documentData?.title}
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
  }, [logId, documentData?.title]);

  const handleSave = useCallback(async (silent = false) => {
    if (savingRef.current) return;
    const latestContent = contentRef.current;
    if (!silent) setStatus(null);
    savingRef.current = true;
    setSaving(true);

    // If connected via collab, try the WebSocket save path
    if (collabConnected) {
      const sent = sendSave({ html: latestContent, markdown: markdownContentRef.current });
      if (sent) {
        setContent(latestContent);
        dirtyRef.current = false;
        lastSavedRef.current = Date.now();
        if (!silent) setStatus({ type: 'success', message: 'Document saved.' });
        savingRef.current = false;
        setSaving(false);
        return;
      }
      // WS send failed — fall through to REST
    }

    // Fallback to REST save when collab is disconnected or WS send failed
    try {
      await saveDocument(Number(logId), latestContent, markdownContentRef.current);
      setContent(latestContent);
      dirtyRef.current = false;
      lastSavedRef.current = Date.now();
      if (!silent) setStatus({ type: 'success', message: 'Document saved.' });
    } catch (e) {
      setStatus({ type: 'error', message: `Error saving: ${e.body?.message ?? e.message}` });
    }
    savingRef.current = false;
    setSaving(false);
  }, [logId, collabConnected, sendSave]);

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

  const handlePublish = useCallback(async ({ title, notes, create_github_release, target_repo, tag_name } = {}) => {
    if (publishing) return;
    setStatus(null);
    setPublishing(true);

    // Try WebSocket publish first if collab is connected. Note: WS publish
    // doesn't support create_github_release; fall through to REST when set.
    if (collabConnected && !create_github_release) {
      try {
        const result = await sendPublish({ title, notes, html: contentRef.current });
        if (result?.version) {
          setDocumentData(d => d ? { ...d, version: result.version } : d);
        }
        setVersionKey(k => k + 1);
        setStatus({ type: 'success', message: `Version ${result?.version ?? ''} published.` });
        setPublishing(false);
        return;
      } catch {
        // WS publish failed — fall through to REST
      }
    }

    // REST fallback: save content first, then publish
    try {
      const latestContent = contentRef.current;
      await saveDocument(Number(logId), latestContent, markdownContentRef.current);
      const result = await publishVersion(logId, { title, notes, create_github_release, target_repo, tag_name });
      if (result?.version) {
        setDocumentData(d => d ? { ...d, version: result.version } : d);
      }
      setVersionKey(k => k + 1);
      const releaseSuffix = result?.github_release
        ? ` GitHub Release ${result.github_release.tag_name} created.`
        : (result?.github_release_error ? ` (release failed: ${result.github_release_error})` : '');
      setStatus({ type: 'success', message: `Version ${result?.version ?? ''} published.${releaseSuffix}` });
    } catch (e) {
      setStatus({ type: 'error', message: `Error publishing: ${e.body?.message ?? e.message}` });
    }
    setPublishing(false);
  }, [logId, publishing, collabConnected, sendPublish]);

  const openPublishModal = useCallback(() => {
    showModal(
      <PublishModal
        githubLink={ghSync.link}
        onPublish={async (opts) => {
          destroyModal();
          await handlePublish(opts);
        }}
        onCancel={destroyModal}
      />,
      'modal-md'
    );
  }, [handlePublish, ghSync.link]);

  const handleTitleSave = async () => {
    if (!title.trim()) return;
    try {
      if (collabConnected) {
        // Save + broadcast via WebSocket (server persists and notifies peers)
        sendTitle(title);
      } else {
        // Fallback to REST when collab is disconnected
        await updateLogTitle(logId, title);
      }
      setDocumentData(d => ({ ...d, title }));
    } catch { /* ignore */ }
    setEditingTitle(false);
  };

  const handleExport = useCallback(async (format) => {
    if (format === 'github') {
      // Navigate to GitHub page in export mode — it will fetch the markdown
      const safeTitle = encodeURIComponent(documentData?.title || 'document');
      navigate(`/github?export_logId=${logId}&export_title=${safeTitle}`);
      return;
    }
    setStatus(null);
    try {
      await exportDocument(Number(logId), format, documentData?.title, contentRef.current);
    } catch (e) {
      setStatus({ type: 'error', message: `Export failed: ${e.body?.message ?? e.message}` });
    }
  }, [logId, documentData?.title, navigate]);

  const editorContent = (
      <div className="editor-log">
        <div className="editor-header">
          <div className="editor-breadcrumb">
            {documentData?.archive_name && (
              <span
                className="breadcrumb-item breadcrumb-item--link"
                onClick={() => navigate(`/archives/${documentData.archive_id}/doc/${logId}`)}
              >
                {documentData.archive_name}
              </span>
            )}
          </div>
          {viewMode === 'edit' && editingTitle ? (
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
            <h2
              className={`editor-title${viewMode === 'edit' ? '' : ' editor-title--readonly'}`}
              onClick={viewMode === 'edit' ? () => setEditingTitle(true) : undefined}
              title={viewMode === 'edit' ? 'Click to rename' : undefined}
            >
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
            {viewMode === 'edit' && <CollabPresence users={collabUsers} connected={collabConnected} />}
            {documentData && (
              <button
                className={`btn-favorite${isFavorited ? ' btn-favorite--active' : ''}`}
                onClick={toggleFavorite}
                disabled={favLoading}
                title={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
              >
                {isFavorited ? '★' : '☆'}
              </button>
            )}
            {documentData && (
              <button
                className={`btn-watch${watching ? ' btn-watch--active' : ''}`}
                onClick={toggleWatch}
                disabled={watchLoading}
                title={watching ? 'Stop watching this document' : 'Watch for updates and comments'}
                aria-pressed={watching}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                  fill={watching ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
              </button>
            )}
            {documentData?.gh_owner && (
              <a
                className="gh-doc-link"
                href={`https://github.com/${documentData.gh_owner}/${documentData.gh_repo}/blob/${documentData.gh_branch}/${documentData.gh_path}`}
                target="_blank"
                rel="noopener noreferrer"
                title={`${documentData.gh_owner}/${documentData.gh_repo}/${documentData.gh_path}`}
              >
                <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg>
                <span>View on GitHub</span>
              </a>
            )}
          </div>
        </div>

        {ghSync.link && (
          <GitHubSyncBanner
            link={ghSync.link}
            status={ghSync.status}
            loading={ghSync.loading}
            conflict={ghSync.conflict}
            onPull={ghSync.pull}
            onPush={ghSync.push}
            onResolve={ghSync.resolve}
            onClearConflict={ghSync.clearConflict}
          />
        )}

        {status && (
          <p className={`editor-status ${status.type}`}>{status.message}</p>
        )}

        {viewMode === 'read' ? (
          <>
            <div className="editor-toolbar">
              <div className="toolbar-group">
                {!isMobileDevice() && (
                  <button className="btn btn-primary btn-sm" onClick={() => setViewMode('edit')}>
                    ✏️ Edit
                  </button>
                )}
              </div>

              <span className="toolbar-divider" />

              <div className="toolbar-group">
                <ExportMenu onExport={handleExport} />
              </div>

              <div className="toolbar-spacer" />

              {!embedded && <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>← Back</button>}
            </div>
            <ReadOnlyContent html={content} />
          </>
        ) : (
          <>
        <div className="editor-toolbar">
          <div className="toolbar-group">
            {embedded && (
              <button className="btn btn-ghost btn-sm" onClick={() => setViewMode('read')}>
                👁 Read
              </button>
            )}
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
              onClick={() => { setEditorMode('richtext'); markdownContentRef.current = null; setMarkdownContent(null); }}
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
            <ExportMenu onExport={handleExport} />
          </div>

          <div className="toolbar-spacer" />

          {!embedded && <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>← Back</button>}
        </div>

        {showVersions && <VersionHistory logId={logId} onRestore={async () => { await loadDocument(); setRestoreKey(k => k + 1); }} versionKey={versionKey} />}

        <div className="editor-with-comments">
          <div className="editor-container">
            {editorMode === 'richtext' ? (
              <RichTextEditor content={content} setContent={setContent} contentRef={contentRef} onLocalChange={handleLocalChange} onCursorChange={handleCursorChange} remoteCursors={remoteCursors} comments={comments} activeCommentId={highlightedCommentId} ydoc={ydoc} synced={synced} restoreKey={restoreKey} />
            ) : (
              <MarkdownEditor content={content} setContent={setContent} contentRef={contentRef} onLocalChange={handleLocalChange} onCursorChange={handleCursorChange} remoteCursors={remoteCursors} comments={comments} activeCommentId={highlightedCommentId} markdownContent={markdownContent} onMarkdownChange={handleMarkdownChange} />
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
          </>
        )}
      </div>
  );

  if (embedded) return editorContent;
  return <StdLayout>{editorContent}</StdLayout>;
}