/**
 * DrawioBlock — Tiptap custom node extension for draw.io (diagrams.net) diagrams.
 * Stores the diagram XML in an attribute and the rendered SVG for display.
 * Clicking "Edit" opens diagrams.net in a popup window via the embed API.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import DOMPurify from 'dompurify';
import { encodeBase64, decodeBase64, extractSvgFromDataUri } from '../editorUtils';

const DRAWIO_URL = 'https://embed.diagrams.net/?embed=1&proto=json&spin=1&ui=dark&libraries=1';

function DrawioBlockView({ node, updateAttributes, editor, deleteNode }) {
  const { xml, svg } = node.attrs;
  const popupRef = useRef(null);
  const [loading, setLoading] = useState(false);

  const isEditable = editor?.isEditable;

  const handleMessage = useCallback((evt) => {
    // Only accept messages from diagrams.net
    if (!evt.data || typeof evt.data !== 'string') return;
    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }

    if (msg.event === 'init') {
      // Editor ready — load existing diagram or start blank
      popupRef.current?.postMessage(
        JSON.stringify({ action: 'load', xml: xml || '', autosave: 0 }),
        '*'
      );
      setLoading(false);
    } else if (msg.event === 'save') {
      // User clicked save — request export as SVG
      popupRef.current?.postMessage(
        JSON.stringify({ action: 'export', format: 'svg', spin: 'Exporting...' }),
        '*'
      );
    } else if (msg.event === 'export') {
      // diagrams.net returns SVG as a data URI (data:image/svg+xml;base64,...)
      // Extract the raw SVG markup from it
      const svgContent = extractSvgFromDataUri(msg.data || '');
      updateAttributes({
        xml: msg.xml || xml,
        svg: svgContent,
      });
      // Close the popup
      popupRef.current?.close();
      popupRef.current = null;
      window.removeEventListener('message', handleMessage);
    } else if (msg.event === 'exit') {
      popupRef.current?.close();
      popupRef.current = null;
      window.removeEventListener('message', handleMessage);
    }
  }, [xml, updateAttributes]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      window.removeEventListener('message', handleMessage);
      if (popupRef.current && !popupRef.current.closed) {
        popupRef.current.close();
      }
    };
  }, [handleMessage]);

  const openEditor = () => {
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.focus();
      return;
    }
    setLoading(true);
    window.addEventListener('message', handleMessage);
    popupRef.current = window.open(
      DRAWIO_URL,
      'drawio-editor',
      'width=1200,height=800,scrollbars=yes,resizable=yes'
    );

    // Detect if popup was closed without saving
    const checkClosed = setInterval(() => {
      if (popupRef.current?.closed) {
        clearInterval(checkClosed);
        setLoading(false);
        window.removeEventListener('message', handleMessage);
        popupRef.current = null;
      }
    }, 1000);
  };

  const sanitizedSvg = svg ? DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } }) : '';

  return (
    <NodeViewWrapper className="drawio-block" data-type="drawioBlock">
      <div className="drawio-block__header">
        <span className="drawio-block__label">▣ Diagram</span>
        {isEditable && (
          <div className="drawio-block__actions">
            <button
              className="drawio-block__edit-btn"
              onClick={openEditor}
              contentEditable={false}
              type="button"
              disabled={loading}
            >
              {loading ? '⏳ Opening…' : '✏ Edit in draw.io'}
            </button>
            <button
              className="drawio-block__delete-btn"
              onClick={deleteNode}
              contentEditable={false}
              type="button"
              title="Remove diagram"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      <div className="drawio-block__preview" contentEditable={false}>
        {sanitizedSvg ? (
          <div dangerouslySetInnerHTML={{ __html: sanitizedSvg }} />
        ) : (
          <div className="drawio-block__placeholder">
            {isEditable
              ? 'Click "Edit in draw.io" to create a diagram'
              : 'Empty diagram'}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

const DrawioBlock = Node.create({
  name: 'drawioBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      xml: {
        default: '',
        renderHTML: (attrs) => {
          if (!attrs.xml) return {};
          try {
            return { 'data-drawio-xml': encodeBase64(attrs.xml) };
          } catch {
            return {};
          }
        },
        parseHTML: (el) => {
          const b64 = el.getAttribute('data-drawio-xml');
          if (b64) {
            try { return decodeBase64(b64); } catch { /* fall through */ }
          }
          return '';
        },
      },
      svg: {
        default: '',
        // No renderHTML — SVG is embedded inline in the node's renderHTML
        // so diagram text labels are searchable via the FULLTEXT index.
        rendered: false,
        parseHTML: (el) => {
          // Backward compat: existing documents store SVG as base64 data attribute
          const b64 = el.getAttribute('data-drawio-svg');
          if (b64) {
            try { return decodeBase64(b64); } catch { /* fall through */ }
          }
          // New format: SVG embedded directly as child content
          const svgEl = el.querySelector('svg');
          return svgEl ? svgEl.outerHTML : '';
        },
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'div[data-type="drawioBlock"]' },
      { tag: 'div[data-drawio-xml]' },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs = mergeAttributes(HTMLAttributes, {
      'data-type': 'drawioBlock',
      class: 'drawio-diagram',
    });

    // Embed SVG inline so diagram text labels survive REGEXP_REPLACE tag
    // stripping and become searchable in the FULLTEXT index.
    if (node.attrs.svg && typeof document !== 'undefined') {
      const div = document.createElement('div');
      for (const [key, value] of Object.entries(attrs)) {
        if (value != null && value !== false) div.setAttribute(key, String(value));
      }
      div.innerHTML = DOMPurify.sanitize(node.attrs.svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
      });
      return div;
    }

    return ['div', attrs];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DrawioBlockView);
  },

  addCommands() {
    return {
      insertDrawioBlock: () => ({ commands }) => {
        return commands.insertContent({
          type: this.name,
          attrs: { xml: '', svg: '' },
        });
      },
    };
  },

  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        const { selection } = editor.state;
        if (selection instanceof NodeSelection && selection.node.type.name === this.name) {
          editor.commands.deleteSelection();
          return true;
        }
        return false;
      },
      Delete: ({ editor }) => {
        const { selection } = editor.state;
        if (selection instanceof NodeSelection && selection.node.type.name === this.name) {
          editor.commands.deleteSelection();
          return true;
        }
        return false;
      },
    };
  },
});

export default DrawioBlock;
