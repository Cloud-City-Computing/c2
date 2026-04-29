/**
 * GitHubIssueEmbed — Tiptap atom node that renders a live preview of a
 * GitHub issue (title + state badge) in line with prose. Fetches the issue
 * on mount; tolerates 404 by showing a missing-state badge.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useEffect, useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { fetchGitHubIssue } from '../util';

function GitHubIssueEmbedView({ node, deleteNode, editor }) {
  const { owner, repo, number } = node.attrs;
  const [issue, setIssue] = useState({ loading: true, title: '', state: '', error: null, htmlUrl: '' });
  const cancelRef = useRef(false);

  useEffect(() => {
    cancelRef.current = false;
    fetchGitHubIssue(owner, repo, number)
      .then((res) => {
        if (cancelRef.current) return;
        setIssue({
          loading: false,
          title: res.issue?.title || '',
          state: res.issue?.state || '',
          htmlUrl: res.issue?.html_url || `https://github.com/${owner}/${repo}/issues/${number}`,
          error: null,
        });
      })
      .catch((err) => {
        if (cancelRef.current) return;
        setIssue({
          loading: false,
          title: '',
          state: 'unknown',
          htmlUrl: `https://github.com/${owner}/${repo}/issues/${number}`,
          error: err?.body?.message || err?.message || 'Failed to load issue',
        });
      });
    return () => { cancelRef.current = true; };
  }, [owner, repo, number]);

  const isEditable = editor?.isEditable;

  return (
    <NodeViewWrapper
      as="span"
      className={`gh-issue-embed gh-issue-embed--${issue.state || 'loading'}`}
      data-type="githubIssueEmbed"
    >
      <a className="gh-issue-embed__link" href={issue.htmlUrl} target="_blank" rel="noopener noreferrer">
        {issue.state === 'open' && <span className="gh-issue-embed__state gh-issue-embed__state--open">●</span>}
        {issue.state === 'closed' && <span className="gh-issue-embed__state gh-issue-embed__state--closed">●</span>}
        {(issue.state !== 'open' && issue.state !== 'closed') && <span className="gh-issue-embed__state">·</span>}
        <span className="gh-issue-embed__ref">{owner}/{repo}#{number}</span>
        {issue.title && <span className="gh-issue-embed__title">{issue.title}</span>}
        {issue.error && <span className="gh-issue-embed__error" title={issue.error}>!</span>}
      </a>
      {isEditable && (
        <button type="button" className="gh-issue-embed__remove" onClick={deleteNode} title="Remove">×</button>
      )}
    </NodeViewWrapper>
  );
}

const GitHubIssueEmbed = Node.create({
  name: 'githubIssueEmbed',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      owner: { default: '' },
      repo: { default: '' },
      number: {
        default: 0,
        parseHTML: (el) => Number(el.getAttribute('data-gh-issue-number') || 0),
        renderHTML: (attrs) => ({ 'data-gh-issue-number': String(attrs.number || 0) }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="githubIssueEmbed"]',
        getAttrs: (el) => ({
          owner: el.getAttribute('data-gh-owner') || '',
          repo: el.getAttribute('data-gh-repo') || '',
          number: Number(el.getAttribute('data-gh-issue-number') || 0),
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs = mergeAttributes(HTMLAttributes, {
      'data-type': 'githubIssueEmbed',
      'data-gh-owner': node.attrs.owner,
      'data-gh-repo': node.attrs.repo,
      class: 'gh-issue-embed',
    });
    return ['span', attrs, `${node.attrs.owner}/${node.attrs.repo}#${node.attrs.number}`];
  },

  addNodeView() {
    return ReactNodeViewRenderer(GitHubIssueEmbedView);
  },

  addCommands() {
    return {
      insertGitHubIssueEmbed: (attrs) => ({ commands }) => {
        return commands.insertContent({ type: this.name, attrs });
      },
    };
  },
});

export default GitHubIssueEmbed;
