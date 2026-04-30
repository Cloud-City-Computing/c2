/**
 * Mention — Tiptap inline atom node + lightweight `@`-trigger suggestion plugin.
 *
 * Triggered by typing `@` followed by a search query (no spaces).
 * Queries `/api/users/search` to populate the picker, inserts a styled
 * mention node carrying the recipient's user id. Server-side mention
 * extraction keys on `data-mention-user-id`.
 *
 * Mentions are not triggered inside code/code-block nodes — the plugin
 * walks ancestor node types and bails out when found.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useEffect, useState, useRef } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { searchUsers } from '../util';

const MentionPluginKey = new PluginKey('mentionSuggestion');

function MentionView({ node }) {
  const username = node.attrs.username || 'user';
  return (
    <NodeViewWrapper as="span" className="mention" data-mention-user-id={node.attrs.userId} data-mention-username={username}>
      @{username}
    </NodeViewWrapper>
  );
}

function isInsideCodeOrPre($pos) {
  for (let depth = $pos.depth; depth >= 0; depth--) {
    const node = $pos.node(depth);
    const name = node.type?.name;
    if (name === 'codeBlock' || name === 'code' || name === 'codeBlockLowlight') {
      return true;
    }
  }
  return false;
}

/**
 * Build the suggestion plugin. The plugin tracks an open trigger at a
 * caret position, exposes `query` and a `range` via plugin state, and
 * delegates rendering of the popup to a React portal mounted by
 * `MentionPicker` (rendered alongside the editor).
 */
function createSuggestionPlugin(onStateChange) {
  return new Plugin({
    key: MentionPluginKey,
    state: {
      init() {
        return { active: false, query: '', from: 0, to: 0 };
      },
      apply(tr, _prev) {
        const { selection } = tr;
        const { $from } = selection;

        if (!selection.empty) return { active: false, query: '', from: 0, to: 0 };
        if (isInsideCodeOrPre($from)) return { active: false, query: '', from: 0, to: 0 };

        // Search backwards in the current text block for an `@` that
        // hasn't been broken by whitespace/punctuation.
        const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
        const match = textBefore.match(/(?:^|\s)@([\w.-]{0,30})$/);
        if (!match) return { active: false, query: '', from: 0, to: 0 };

        const triggerLen = match[0].length - (match[0].startsWith('@') ? 0 : 1); // length of "@…"
        const from = $from.pos - triggerLen;
        const to = $from.pos;
        return { active: true, query: match[1] || '', from, to };
      },
    },
    view() {
      return {
        update: (view) => {
          const next = MentionPluginKey.getState(view.state);
          if (onStateChange) onStateChange(next, view);
        },
        destroy() {
          if (onStateChange) onStateChange({ active: false, query: '', from: 0, to: 0 }, null);
        },
      };
    },
  });
}

const Mention = Node.create({
  name: 'mention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  draggable: false,

  addAttributes() {
    return {
      userId: {
        default: 0,
        parseHTML: (el) => Number(el.getAttribute('data-mention-user-id') || 0),
        renderHTML: (attrs) => ({ 'data-mention-user-id': String(attrs.userId || 0) }),
      },
      username: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-mention-username') || '',
        renderHTML: (attrs) => ({ 'data-mention-username': attrs.username || '' }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-mention-user-id]',
        getAttrs: (el) => ({
          userId: Number(el.getAttribute('data-mention-user-id') || 0),
          username: el.getAttribute('data-mention-username') || '',
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs = mergeAttributes(HTMLAttributes, {
      'data-mention-user-id': String(node.attrs.userId || 0),
      'data-mention-username': node.attrs.username || '',
      class: 'mention',
    });
    return ['span', attrs, `@${node.attrs.username || 'user'}`];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MentionView);
  },

  addCommands() {
    return {
      insertMention: (attrs) => ({ commands }) => {
        return commands.insertContent([
          { type: this.name, attrs },
          { type: 'text', text: ' ' },
        ]);
      },
    };
  },

  addProseMirrorPlugins() {
    const onStateChange = this.options.onStateChange;
    return [createSuggestionPlugin(onStateChange)];
  },
});

/**
 * MentionPicker — drop into the editor wrapper. Watches the suggestion
 * plugin state via the editor's tr listener and renders an absolute popup
 * near the caret. Selecting an entry inserts a mention node.
 */
export function MentionPicker({ editor }) {
  const [state, setState] = useState({ active: false, query: '', from: 0, to: 0 });
  const [items, setItems] = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [coords, setCoords] = useState(null);
  const debounceRef = useRef(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (!editor) return undefined;
    const handler = ({ editor: ed }) => {
      const next = MentionPluginKey.getState(ed.state);
      if (!next) return;
      setState(next);
      if (next.active) {
        try {
          setCoords(ed.view.coordsAtPos(next.from));
        } catch {
          setCoords(null);
        }
      } else {
        setCoords(null);
      }
    };
    editor.on('transaction', handler);
    editor.on('selectionUpdate', handler);
    return () => {
      editor.off('transaction', handler);
      editor.off('selectionUpdate', handler);
    };
  }, [editor]);

  // Debounced fetch of users matching the current query
  useEffect(() => {
    if (!state.active) {
      setItems([]);
      return undefined;
    }
    const q = state.query.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const reqId = ++reqIdRef.current;
      try {
        const res = await searchUsers(q);
        if (reqId !== reqIdRef.current) return;
        const list = Array.isArray(res?.users) ? res.users : (Array.isArray(res?.results) ? res.results : []);
        setItems(list.slice(0, 8));
        setActiveIdx(0);
      } catch {
        setItems([]);
      }
    }, 120);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [state.active, state.query]);

  // Keyboard handling — bind to the document while the picker is active.
  useEffect(() => {
    if (!state.active || items.length === 0) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % items.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + items.length) % items.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        select(items[activeIdx]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        // Move past trigger to dismiss
        editor.chain().focus().setTextSelection(state.to).run();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.active, items, activeIdx, state.from, state.to]);

  const select = (item) => {
    if (!editor || !item) return;
    editor
      .chain()
      .focus()
      .deleteRange({ from: state.from, to: state.to })
      .insertContent([
        { type: 'mention', attrs: { userId: item.id, username: item.name } },
        { type: 'text', text: ' ' },
      ])
      .run();
  };

  if (!state.active || !coords) return null;
  if (items.length === 0) return null;

  const style = {
    position: 'fixed',
    top: coords.bottom + 4,
    left: coords.left,
    zIndex: 1000,
  };

  return (
    <div className="mention-picker" style={style} role="listbox">
      {items.map((item, idx) => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={idx === activeIdx}
          className={`mention-picker__item${idx === activeIdx ? ' active' : ''}`}
          onMouseEnter={() => setActiveIdx(idx)}
          onMouseDown={(e) => { e.preventDefault(); select(item); }}
        >
          {item.avatar_url ? (
            <img src={item.avatar_url} alt="" className="mention-picker__avatar" />
          ) : (
            <span className="mention-picker__avatar mention-picker__avatar--placeholder">
              {(item.name || '?').charAt(0).toUpperCase()}
            </span>
          )}
          <span className="mention-picker__name">{item.name}</span>
          {item.email && <span className="mention-picker__email">{item.email}</span>}
        </button>
      ))}
    </div>
  );
}

export default Mention;
