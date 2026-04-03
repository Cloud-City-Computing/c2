/**
 * RemoteCursors — Renders colored cursor labels for remote collaborators.
 *
 * For the rich text (Jodit) editor, cursors are shown as colored name tags
 * positioned within the editor's content area based on character offset.
 *
 * For the markdown editor, cursors are shown as line-based indicators
 * overlaid on the textarea.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useEffect, useState } from 'react';

const CURSOR_STALE_MS = 10000; // Hide cursors older than 10s

/**
 * Find the Jodit content area (.jodit-wysiwyg) wrapper in the parent DOM
 * so we can position cursors relative to it (not the toolbar).
 */
function findJoditContentArea(editorRef) {
  const jodit = editorRef.current;
  if (!jodit) return null;
  // jodit-react exposes the Jodit instance; its container is the root .jodit element
  const container = jodit.container || jodit.parentElement;
  if (!container) return null;
  // Find the .jodit-workplace which wraps just the editing area (below toolbar)
  return container.querySelector('.jodit-workplace') || container;
}

/**
 * Get coordinates for a character offset inside Jodit's contentEditable.
 * Returns { top, left } relative to the .jodit-workplace element in the parent document.
 */
function getRichTextPosition(editorRef, charIndex) {
  const jodit = editorRef.current;
  if (!jodit?.editor) return null;

  const editorEl = jodit.editor; // contentEditable inside iframe or inline
  const workplace = findJoditContentArea(editorRef);
  if (!workplace) return null;

  const workplaceRect = workplace.getBoundingClientRect();

  // Walk text nodes to find the one containing our offset
  const walker = editorEl.ownerDocument.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT, null);
  let offset = 0;
  let node;

  while ((node = walker.nextNode())) {
    const len = node.textContent.length;
    if (offset + len >= charIndex) {
      const localOffset = charIndex - offset;
      try {
        const range = editorEl.ownerDocument.createRange();
        range.setStart(node, Math.min(localOffset, len));
        range.collapse(true);
        const rect = range.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0 && rect.top === 0) return null;

        // If Jodit uses an iframe, coordinates are relative to the iframe viewport.
        // The iframe element itself is positioned inside .jodit-workplace.
        const iframe = workplace.querySelector('iframe.jodit-wysiwyg_iframe');
        if (iframe) {
          const iframeRect = iframe.getBoundingClientRect();
          return {
            top: iframeRect.top - workplaceRect.top + rect.top,
            left: iframeRect.left - workplaceRect.left + rect.left,
          };
        }

        // Inline mode — coordinates are already in parent viewport
        return {
          top: rect.top - workplaceRect.top,
          left: rect.left - workplaceRect.left,
        };
      } catch {
        return null;
      }
    }
    offset += len;
  }
  return null;
}

/**
 * Get bounding rectangles for a selection range (start to end character offset)
 * inside Jodit's contentEditable, relative to .jodit-workplace.
 */
function getRichTextSelectionRects(editorRef, startIndex, endIndex) {
  const jodit = editorRef.current;
  if (!jodit?.editor) return [];

  const editorEl = jodit.editor;
  const workplace = findJoditContentArea(editorRef);
  if (!workplace) return [];

  const workplaceRect = workplace.getBoundingClientRect();
  const iframe = workplace.querySelector('iframe.jodit-wysiwyg_iframe');

  const walker = editorEl.ownerDocument.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT, null);
  const textNodes = [];
  let totalLen = 0;
  let node;
  while ((node = walker.nextNode())) {
    textNodes.push({ node, start: totalLen });
    totalLen += node.textContent.length;
  }

  if (textNodes.length === 0) return [];

  try {
    const range = editorEl.ownerDocument.createRange();
    let setStart = false;
    for (let i = 0; i < textNodes.length; i++) {
      const tn = textNodes[i];
      const nodeEnd = tn.start + tn.node.textContent.length;
      if (!setStart && nodeEnd > startIndex) {
        range.setStart(tn.node, Math.min(startIndex - tn.start, tn.node.textContent.length));
        setStart = true;
      }
      if (setStart && nodeEnd >= endIndex) {
        range.setEnd(tn.node, Math.min(endIndex - tn.start, tn.node.textContent.length));
        break;
      }
    }
    if (!setStart) return [];

    const clientRects = range.getClientRects();
    const rects = [];
    for (let i = 0; i < clientRects.length; i++) {
      const rect = clientRects[i];
      if (rect.width === 0 && rect.height === 0) continue;
      let top, left;
      if (iframe) {
        const iframeRect = iframe.getBoundingClientRect();
        top = iframeRect.top - workplaceRect.top + rect.top;
        left = iframeRect.left - workplaceRect.left + rect.left;
      } else {
        top = rect.top - workplaceRect.top;
        left = rect.left - workplaceRect.left;
      }
      rects.push({ top, left, width: rect.width, height: rect.height });
    }
    return rects;
  } catch {
    return [];
  }
}

/**
 * RemoteCursors for the rich text (Jodit) editor.
 * Positioned over .jodit-workplace (content area only, below toolbar).
 */
export function RichTextCursors({ remoteCursors, editorRef }) {
  const [positions, setPositions] = useState({});

  useEffect(() => {
    const now = Date.now();
    const newPositions = {};

    for (const [userId, cursor] of Object.entries(remoteCursors)) {
      if (now - cursor.timestamp > CURSOR_STALE_MS) continue;
      if (!cursor.position) continue;

      const pos = getRichTextPosition(editorRef, cursor.position.index || 0);
      const selectionLength = cursor.position.length || 0;
      let selectionRects = [];
      if (selectionLength > 0) {
        selectionRects = getRichTextSelectionRects(
          editorRef,
          cursor.position.index || 0,
          (cursor.position.index || 0) + selectionLength
        );
      }
      if (pos) {
        newPositions[userId] = { ...cursor, top: pos.top, left: pos.left, selectionRects };
      }
    }

    setPositions(newPositions);
  }, [remoteCursors, editorRef]);

  const entries = Object.values(positions);
  if (entries.length === 0) return null;

  return (
    <div className="remote-cursors">
      {entries.map((cursor) => (
        <div key={cursor.userId}>
          {cursor.selectionRects?.length > 0 && cursor.selectionRects.map((rect, i) => (
            <div
              key={`${cursor.userId}-sel-${i}`}
              className="remote-selection"
              style={{
                top: rect.top,
                left: rect.left,
                width: rect.width,
                height: rect.height,
                backgroundColor: cursor.color,
              }}
            />
          ))}
          <div
            className="remote-cursor"
            style={{ top: cursor.top, left: cursor.left }}
          >
            <div className="remote-cursor__caret" style={{ backgroundColor: cursor.color }} />
            <span className="remote-cursor__label" style={{ backgroundColor: cursor.color }}>
              {cursor.userName}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Compute pixel position for a cursor in a textarea using a hidden mirror div.
 * Measures both vertical (line-based) and horizontal (column-based) position.
 */
function getTextareaPosition(textarea, charIndex) {
  if (!textarea) return null;

  const style = getComputedStyle(textarea);

  // Create a hidden mirror div that replicates the textarea's styling
  const mirror = document.createElement('div');
  const mirrorStyle = mirror.style;
  mirrorStyle.position = 'absolute';
  mirrorStyle.top = '-9999px';
  mirrorStyle.left = '-9999px';
  mirrorStyle.visibility = 'hidden';
  mirrorStyle.whiteSpace = 'pre-wrap';
  mirrorStyle.wordWrap = 'break-word';
  mirrorStyle.overflow = 'hidden';
  mirrorStyle.width = `${textarea.clientWidth}px`;
  mirrorStyle.font = style.font;
  mirrorStyle.fontSize = style.fontSize;
  mirrorStyle.fontFamily = style.fontFamily;
  mirrorStyle.lineHeight = style.lineHeight;
  mirrorStyle.letterSpacing = style.letterSpacing;
  mirrorStyle.padding = style.padding;
  mirrorStyle.border = style.border;
  mirrorStyle.boxSizing = style.boxSizing;
  mirrorStyle.tabSize = style.tabSize;

  // Insert text up to cursor position, then a span marker
  const textBefore = textarea.value.substring(0, charIndex);
  const textNode = document.createTextNode(textBefore);
  const marker = document.createElement('span');
  marker.textContent = '|';

  mirror.appendChild(textNode);
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const markerRect = marker.getBoundingClientRect();
  const mirrorRect = mirror.getBoundingClientRect();

  const top = markerRect.top - mirrorRect.top - textarea.scrollTop;
  const left = markerRect.left - mirrorRect.left;

  document.body.removeChild(mirror);

  return { top, left };
}

/**
 * Get bounding rectangles for a selection range in a textarea,
 * relative to the textarea element, using a hidden mirror div.
 */
function getTextareaSelectionRects(textarea, startIndex, endIndex) {
  if (!textarea || startIndex >= endIndex) return [];

  const style = getComputedStyle(textarea);
  const mirror = document.createElement('div');
  const ms = mirror.style;
  ms.position = 'absolute';
  ms.top = '-9999px';
  ms.left = '-9999px';
  ms.visibility = 'hidden';
  ms.whiteSpace = 'pre-wrap';
  ms.wordWrap = 'break-word';
  ms.overflow = 'hidden';
  ms.width = `${textarea.clientWidth}px`;
  ms.font = style.font;
  ms.fontSize = style.fontSize;
  ms.fontFamily = style.fontFamily;
  ms.lineHeight = style.lineHeight;
  ms.letterSpacing = style.letterSpacing;
  ms.padding = style.padding;
  ms.border = style.border;
  ms.boxSizing = style.boxSizing;
  ms.tabSize = style.tabSize;

  const before = document.createTextNode(textarea.value.substring(0, startIndex));
  const selected = document.createElement('span');
  selected.textContent = textarea.value.substring(startIndex, endIndex);
  const after = document.createTextNode(textarea.value.substring(endIndex));

  mirror.appendChild(before);
  mirror.appendChild(selected);
  mirror.appendChild(after);
  document.body.appendChild(mirror);

  const mirrorRect = mirror.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(selected);
  const clientRects = range.getClientRects();
  const rects = [];

  for (let i = 0; i < clientRects.length; i++) {
    const r = clientRects[i];
    if (r.width === 0 && r.height === 0) continue;
    rects.push({
      top: r.top - mirrorRect.top - textarea.scrollTop,
      left: r.left - mirrorRect.left,
      width: r.width,
      height: r.height,
    });
  }

  document.body.removeChild(mirror);
  return rects;
}

/**
 * RemoteCursors for the markdown textarea editor.
 * Positioned absolutely within the textarea wrapper.
 */
export function MarkdownCursors({ remoteCursors, textareaRef }) {
  const [linePositions, setLinePositions] = useState({});

  useEffect(() => {
    const now = Date.now();
    const textarea = textareaRef.current;
    if (!textarea) return;

    const newPositions = {};
    const visibleHeight = textarea.clientHeight;

    for (const [userId, cursor] of Object.entries(remoteCursors)) {
      if (now - cursor.timestamp > CURSOR_STALE_MS) continue;
      if (!cursor.position) continue;

      const pos = getTextareaPosition(textarea, cursor.position.index || 0);
      const selectionLength = cursor.position.length || 0;
      let selectionRects = [];
      if (selectionLength > 0) {
        selectionRects = getTextareaSelectionRects(
          textarea,
          cursor.position.index || 0,
          (cursor.position.index || 0) + selectionLength
        );
      }
      if (pos && pos.top >= -20 && pos.top < visibleHeight + 20) {
        newPositions[userId] = { ...cursor, top: pos.top, left: pos.left, selectionRects };
      }
    }

    setLinePositions(newPositions);
  }, [remoteCursors, textareaRef]);

  const entries = Object.values(linePositions);
  if (entries.length === 0) return null;

  return (
    <div className="remote-cursors remote-cursors--markdown">
      {entries.map((cursor) => (
        <div key={cursor.userId}>
          {cursor.selectionRects?.length > 0 && cursor.selectionRects.map((rect, i) => (
            <div
              key={`${cursor.userId}-sel-${i}`}
              className="remote-selection"
              style={{
                top: rect.top,
                left: rect.left,
                width: rect.width,
                height: rect.height,
                backgroundColor: cursor.color,
              }}
            />
          ))}
          <div
            className="remote-cursor remote-cursor--markdown"
            style={{ top: cursor.top, left: cursor.left }}
          >
            <div className="remote-cursor__caret" style={{ backgroundColor: cursor.color }} />
            <span className="remote-cursor__label" style={{ backgroundColor: cursor.color }}>
              {cursor.userName}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
