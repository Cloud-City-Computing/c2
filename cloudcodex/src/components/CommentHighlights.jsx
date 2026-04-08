/**
 * CommentHighlights — Renders colored overlays on text referenced by comments.
 *
 * For Tiptap (rich text): traverses the editor DOM to find text matching each
 * comment's selected_text, gets bounding rects, and draws transparent overlay
 * rectangles positioned relative to the editor container.
 *
 * For Markdown: injects highlight marks into the preview pane.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useEffect, useState, useCallback } from 'react';

const TAG_COLORS = {
  comment:    { r: 74,  g: 158, b: 255 },
  suggestion: { r: 102, g: 187, b: 106 },
  question:   { r: 255, g: 167, b: 38  },
  issue:      { r: 239, g: 83,  b: 80  },
  note:       { r: 171, g: 71,  b: 188 },
};

function rgbaStr({ r, g, b }, alpha) {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Search through text nodes in a DOM tree to find ranges matching `searchText`.
 * Returns an array of native Range objects for each match found.
 */
function findTextRanges(rootEl, doc, searchText) {
  if (!searchText || !rootEl) return [];
  const ranges = [];
  const walker = doc.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
  // Build a flat list of  { node, globalStart } entries
  const textNodes = [];
  let totalLen = 0;
  let node;
  while ((node = walker.nextNode())) {
    textNodes.push({ node, start: totalLen });
    totalLen += node.textContent.length;
  }

  // Concatenate all text for searching
  const fullText = textNodes.map(n => n.node.textContent).join('');
  const needle = searchText.toLowerCase();
  const searchFrom = 0;
  // Find first occurrence only (avoid flooding for repeated text)
  const idx = fullText.toLowerCase().indexOf(needle, searchFrom);
  if (idx === -1) return ranges;

  const matchStart = idx;
  const matchEnd = idx + searchText.length;

  // Determine which text nodes the match spans
  try {
    const range = doc.createRange();
    let setStart = false;
    for (let i = 0; i < textNodes.length; i++) {
      const tn = textNodes[i];
      const nodeEnd = tn.start + tn.node.textContent.length;
      if (!setStart && nodeEnd > matchStart) {
        range.setStart(tn.node, matchStart - tn.start);
        setStart = true;
      }
      if (setStart && nodeEnd >= matchEnd) {
        range.setEnd(tn.node, matchEnd - tn.start);
        break;
      }
    }
    if (setStart) ranges.push(range);
  } catch {
    // Range creation can fail if DOM mutated
  }

  return ranges;
}

/**
 * CommentHighlights for the rich text (Tiptap) editor.
 * Rendered via createPortal into the Tiptap content wrapper.
 */
export function RichTextHighlights({ editorRef, comments, activeCommentId }) {
  const [highlights, setHighlights] = useState([]);

  const computeHighlights = useCallback(() => {
    const editor = editorRef.current;
    if (!editor?.view?.dom) { setHighlights([]); return; }

    const editorEl = editor.view.dom;
    const editorDoc = editorEl.ownerDocument;
    const container = editorEl.parentElement;
    if (!container) { setHighlights([]); return; }
    const containerRect = container.getBoundingClientRect();

    const items = [];

    for (const c of comments) {
      if (!c.selected_text || c.status === 'dismissed') continue;

      const ranges = findTextRanges(editorEl, editorDoc, c.selected_text);
      for (const range of ranges) {
        const rects = range.getClientRects();
        for (let i = 0; i < rects.length; i++) {
          const rect = rects[i];
          if (rect.width === 0 && rect.height === 0) continue;

          items.push({
            key: `${c.id}-${i}`,
            commentId: c.id,
            tag: c.tag,
            top: rect.top - containerRect.top,
            left: rect.left - containerRect.left,
            width: rect.width,
            height: rect.height,
          });
        }
      }
    }

    setHighlights(items);
  }, [editorRef, comments]);

  // Recompute on comments change and periodically (content may reflow)
  useEffect(() => {
    computeHighlights();
    const interval = setInterval(computeHighlights, 2000);
    return () => clearInterval(interval);
  }, [computeHighlights, activeCommentId]);

  if (highlights.length === 0) return null;

  return (
    <div className="comment-highlights" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1 }}>
      {highlights.map(h => {
        const color = TAG_COLORS[h.tag] || TAG_COLORS.comment;
        const isActive = h.commentId === activeCommentId;
        const alpha = isActive ? 0.35 : 0.12;
        const borderAlpha = isActive ? 0.7 : 0.25;

        return (
          <div
            key={h.key}
            className={`comment-highlight-rect ${isActive ? 'comment-highlight-rect--active' : ''}`}
            style={{
              position: 'absolute',
              top: h.top,
              left: h.left,
              width: h.width,
              height: h.height,
              backgroundColor: rgbaStr(color, alpha),
              borderBottom: `2px solid ${rgbaStr(color, borderAlpha)}`,
              borderRadius: '2px',
              transition: 'background-color 0.2s, border-color 0.2s',
            }}
          />
        );
      })}
    </div>
  );
}

/**
 * CommentHighlights for the Markdown editor preview pane.
 * Injects <mark> elements into the preview HTML.
 */
export function MarkdownHighlights({ previewRef, comments, activeCommentId }) {
  useEffect(() => {
    const el = previewRef?.current;
    if (!el) return;

    // Remove previous highlights
    el.querySelectorAll('mark[data-comment-highlight]').forEach(m => {
      const parent = m.parentNode;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
    });

    // Apply highlights for each comment with selected text
    for (const c of comments) {
      if (!c.selected_text || c.status === 'dismissed') continue;

      const doc = el.ownerDocument;
      const ranges = findTextRanges(el, doc, c.selected_text);
      const color = TAG_COLORS[c.tag] || TAG_COLORS.comment;
      const isActive = c.id === activeCommentId;
      const alpha = isActive ? 0.35 : 0.12;
      const borderAlpha = isActive ? 0.7 : 0.25;

      for (const range of ranges) {
        try {
          const mark = doc.createElement('mark');
          mark.setAttribute('data-comment-highlight', c.id);
          mark.style.backgroundColor = rgbaStr(color, alpha);
          mark.style.borderBottom = `2px solid ${rgbaStr(color, borderAlpha)}`;
          mark.style.borderRadius = '2px';
          mark.style.transition = 'background-color 0.2s, border-color 0.2s';
          mark.style.padding = '0';
          range.surroundContents(mark);
        } catch {
          // surroundContents can fail if range spans multiple elements
        }
      }
    }
  }, [previewRef, comments, activeCommentId]);

  return null;
}
