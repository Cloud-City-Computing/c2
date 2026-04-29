/**
 * GitHubCodeEmbed — Tiptap atom node that renders a live snippet of a file
 * from a GitHub repository. Stores (owner, repo, path, ref, lineStart,
 * lineEnd, pinnedSha) as node attributes; fetches content on mount and
 * surfaces a "stale" indicator when the pinned SHA no longer matches the
 * branch tip.
 *
 * Pattern mirrors DrawioBlock.jsx — atom + ReactNodeViewRenderer + parseHTML
 * round-trip via data-* attributes.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useEffect, useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { createLowlight, common } from 'lowlight';
import { hastToHtml } from '../editorUtils';
import { apiFetch } from '../util';

const lowlight = createLowlight(common);

function GitHubCodeEmbedView({ node, deleteNode, editor }) {
  const { owner, repo, path, ref, lineStart, lineEnd, pinnedSha } = node.attrs;
  const [snippet, setSnippet] = useState({ loading: true, content: '', sha: null, language: 'plaintext', htmlUrl: '', error: null });
  const cancelRef = useRef(false);

  useEffect(() => {
    cancelRef.current = false;
    setSnippet((s) => ({ ...s, loading: true, error: null }));

    const params = new URLSearchParams({ owner, repo, path, ref: ref || 'HEAD' });
    if (lineStart) params.set('start', String(lineStart));
    if (lineEnd) params.set('end', String(lineEnd));

    apiFetch('GET', `/api/github/embed/code?${params}`)
      .then((res) => {
        if (cancelRef.current) return;
        setSnippet({
          loading: false,
          content: res.content || '',
          sha: res.sha,
          language: res.language || 'plaintext',
          htmlUrl: res.html_url || '',
          error: null,
        });
      })
      .catch((err) => {
        if (cancelRef.current) return;
        setSnippet({
          loading: false,
          content: '',
          sha: null,
          language: 'plaintext',
          htmlUrl: '',
          error: err?.body?.message || err?.message || 'Failed to load snippet',
        });
      });

    return () => { cancelRef.current = true; };
  }, [owner, repo, path, ref, lineStart, lineEnd]);

  const isStale = pinnedSha && snippet.sha && pinnedSha !== snippet.sha;
  const isEditable = editor?.isEditable;

  const renderHighlighted = (code, lang) => {
    try {
      const tree = lang
        ? lowlight.highlight(lang, code)
        : lowlight.highlightAuto(code);
      return hastToHtml(tree);
    } catch {
      return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  };

  const ghBlobUrl = snippet.htmlUrl
    || `https://github.com/${owner}/${repo}/blob/${ref || 'HEAD'}/${path}`;
  const rangeLabel = lineStart ? `#L${lineStart}${lineEnd ? `-L${lineEnd}` : ''}` : '';

  return (
    <NodeViewWrapper className="gh-code-embed" data-type="githubCodeEmbed">
      <div className="gh-code-embed__header">
        <span className="gh-code-embed__icon" aria-hidden>{'<>'}</span>
        <a className="gh-code-embed__path" href={ghBlobUrl} target="_blank" rel="noopener noreferrer">
          {owner}/{repo}@{ref || 'HEAD'}/{path}{rangeLabel}
        </a>
        <span className="gh-code-embed__lang">{snippet.language}</span>
        {isStale && <span className="gh-code-embed__stale" title="Pinned SHA no longer matches branch tip">stale</span>}
        {isEditable && (
          <button
            type="button"
            className="gh-code-embed__remove"
            onClick={deleteNode}
            title="Remove embed"
          >
            ×
          </button>
        )}
      </div>
      <div className="gh-code-embed__body">
        {snippet.loading && <div className="gh-code-embed__placeholder">Loading…</div>}
        {snippet.error && <div className="gh-code-embed__error">⚠ {snippet.error}</div>}
        {!snippet.loading && !snippet.error && (
          <pre className={`hljs language-${snippet.language}`}>
            <code
              // Sandboxed: content comes from our own /api proxy; lowlight emits
              // structured HAST that hastToHtml renders to a small fixed
              // vocabulary of <span class="hljs-..."> elements.
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: renderHighlighted(snippet.content, snippet.language) }}
            />
          </pre>
        )}
      </div>
    </NodeViewWrapper>
  );
}

const GitHubCodeEmbed = Node.create({
  name: 'githubCodeEmbed',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      owner: { default: '' },
      repo: { default: '' },
      path: { default: '' },
      ref: { default: 'HEAD' },
      lineStart: {
        default: null,
        parseHTML: (el) => {
          const v = el.getAttribute('data-gh-line-start');
          return v ? Number(v) : null;
        },
        renderHTML: (attrs) => attrs.lineStart ? { 'data-gh-line-start': attrs.lineStart } : {},
      },
      lineEnd: {
        default: null,
        parseHTML: (el) => {
          const v = el.getAttribute('data-gh-line-end');
          return v ? Number(v) : null;
        },
        renderHTML: (attrs) => attrs.lineEnd ? { 'data-gh-line-end': attrs.lineEnd } : {},
      },
      pinnedSha: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-gh-pinned-sha') || null,
        renderHTML: (attrs) => attrs.pinnedSha ? { 'data-gh-pinned-sha': attrs.pinnedSha } : {},
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="githubCodeEmbed"]',
        getAttrs: (el) => ({
          owner: el.getAttribute('data-gh-owner') || '',
          repo: el.getAttribute('data-gh-repo') || '',
          path: el.getAttribute('data-gh-path') || '',
          ref: el.getAttribute('data-gh-ref') || 'HEAD',
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs = mergeAttributes(HTMLAttributes, {
      'data-type': 'githubCodeEmbed',
      'data-gh-owner': node.attrs.owner,
      'data-gh-repo': node.attrs.repo,
      'data-gh-path': node.attrs.path,
      'data-gh-ref': node.attrs.ref || 'HEAD',
      class: 'gh-code-embed',
    });
    const range = node.attrs.lineStart
      ? `#L${node.attrs.lineStart}${node.attrs.lineEnd ? `-L${node.attrs.lineEnd}` : ''}`
      : '';
    const label = `${node.attrs.owner}/${node.attrs.repo}@${node.attrs.ref || 'HEAD'}/${node.attrs.path}${range}`;
    return ['div', attrs, ['code', {}, label]];
  },

  addNodeView() {
    return ReactNodeViewRenderer(GitHubCodeEmbedView);
  },

  addCommands() {
    return {
      insertGitHubCodeEmbed: (attrs) => ({ commands }) => {
        return commands.insertContent({ type: this.name, attrs });
      },
    };
  },
});

export default GitHubCodeEmbed;
