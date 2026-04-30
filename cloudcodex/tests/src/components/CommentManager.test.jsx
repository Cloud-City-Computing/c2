/**
 * Cloud Codex — Tests for src/components/CommentManager.jsx
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { utilMock, toastMock } = vi.hoisted(() => ({
  utilMock: {
    fetchComments: vi.fn(),
    resolveComment: vi.fn(),
    reopenComment: vi.fn(),
    deleteComment: vi.fn(),
    clearAllComments: vi.fn(),
    addCommentReply: vi.fn(),
    deleteCommentReply: vi.fn(),
    timeAgo: vi.fn(() => '1m ago'),
    TAG_LABELS: {
      comment: 'Comment',
      suggestion: 'Suggestion',
      question: 'Question',
      issue: 'Issue',
      note: 'Note',
    },
  },
  toastMock: { toastError: vi.fn() },
}));

vi.mock('../../../src/util.jsx', () => utilMock);
vi.mock('../../../src/components/Toast.jsx', () => toastMock);

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CommentManager from '../../../src/components/CommentManager.jsx';

const sampleComments = [
  {
    id: 1, user_id: 1, user_name: 'Alice', tag: 'comment', status: 'open',
    content: 'First comment', selected_text: 'highlighted', created_at: '2026-04-01',
    replies: [],
  },
  {
    id: 2, user_id: 2, user_name: 'Bob', tag: 'question', status: 'resolved',
    content: 'A question', created_at: '2026-04-01',
    replies: [{ id: 10, user_id: 1, user_name: 'Alice', content: 'Yes', created_at: '2026-04-01' }],
  },
];

beforeEach(() => {
  Object.values(utilMock).forEach((m) => typeof m?.mockReset === 'function' && m.mockReset());
  utilMock.timeAgo.mockReturnValue('1m ago');
  utilMock.TAG_LABELS = {
    comment: 'Comment',
    suggestion: 'Suggestion',
    question: 'Question',
    issue: 'Issue',
    note: 'Note',
  };
  utilMock.fetchComments.mockResolvedValue({ comments: sampleComments });
  utilMock.resolveComment.mockResolvedValue({ comment: { id: 1, status: 'resolved' } });
  utilMock.reopenComment.mockResolvedValue({ success: true });
  utilMock.deleteComment.mockResolvedValue({ success: true });
  utilMock.clearAllComments.mockResolvedValue({ success: true });
  utilMock.addCommentReply.mockResolvedValue({ reply: { id: 99, user_id: 1, user_name: 'Me', content: 'Hi', created_at: '2026-04-02' } });
  utilMock.deleteCommentReply.mockResolvedValue({ success: true });
  toastMock.toastError.mockReset();
});

describe('CommentManager', () => {
  it('shows Loading state until fetch returns', async () => {
    utilMock.fetchComments.mockReturnValueOnce(new Promise(() => {}));
    render(<CommentManager logId={1} onClose={vi.fn()} />);
    expect(screen.getByText(/loading comments/i)).toBeInTheDocument();
  });

  it('renders the title and stats once loaded', async () => {
    render(<CommentManager logId={1} logTitle="My Doc" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/comments — my doc/i)).toBeInTheDocument());
    expect(screen.getByText('1 open')).toBeInTheDocument();
    expect(screen.getByText('1 resolved')).toBeInTheDocument();
    expect(screen.getByText('2 total')).toBeInTheDocument();
  });

  it('renders each comment\'s tag, author, and content', async () => {
    render(<CommentManager logId={1} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('First comment')).toBeInTheDocument());
    expect(screen.getByText('A question')).toBeInTheDocument();
    // "Alice" appears as both comment author and reply author — at least one
    expect(screen.getAllByText('Alice').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('filters by status (Open only)', async () => {
    const user = userEvent.setup();
    render(<CommentManager logId={1} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('First comment')).toBeInTheDocument());

    const statusSelect = screen.getAllByRole('combobox')[1];
    await user.selectOptions(statusSelect, 'open');

    expect(screen.getByText('First comment')).toBeInTheDocument();
    expect(screen.queryByText('A question')).toBeNull();
  });

  it('filters by tag', async () => {
    const user = userEvent.setup();
    render(<CommentManager logId={1} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('First comment')).toBeInTheDocument());

    const tagSelect = screen.getAllByRole('combobox')[0];
    await user.selectOptions(tagSelect, 'question');

    expect(screen.queryByText('First comment')).toBeNull();
    expect(screen.getByText('A question')).toBeInTheDocument();
  });

  it('Resolve action calls resolveComment with status=resolved', async () => {
    const user = userEvent.setup();
    render(<CommentManager logId={1} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('First comment')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /^resolve$/i }));
    expect(utilMock.resolveComment).toHaveBeenCalledWith(1, 'resolved');
  });

  it('Dismiss action calls resolveComment with status=dismissed', async () => {
    const user = userEvent.setup();
    render(<CommentManager logId={1} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('First comment')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(utilMock.resolveComment).toHaveBeenCalledWith(1, 'dismissed');
  });

  it('Reopen action calls reopenComment for resolved items', async () => {
    const user = userEvent.setup();
    render(<CommentManager logId={1} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('A question')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /reopen/i }));
    expect(utilMock.reopenComment).toHaveBeenCalledWith(2);
  });

  it('Delete action removes the comment from the list', async () => {
    const user = userEvent.setup();
    render(<CommentManager logId={1} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('First comment')).toBeInTheDocument());
    const deleteBtns = screen.getAllByRole('button', { name: /^delete$/i });
    await user.click(deleteBtns[0]);
    expect(utilMock.deleteComment).toHaveBeenCalledWith(1);
    await waitFor(() => expect(screen.queryByText('First comment')).toBeNull());
  });

  it('Clear All disables when there are no comments and clears the list', async () => {
    const user = userEvent.setup();
    render(<CommentManager logId={1} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('First comment')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /clear all/i }));
    expect(utilMock.clearAllComments).toHaveBeenCalledWith(1);
    await waitFor(() => expect(screen.queryByText('First comment')).toBeNull());
  });

  it('Reply form shows when Reply is clicked, and submits', async () => {
    const user = userEvent.setup();
    render(<CommentManager logId={1} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('First comment')).toBeInTheDocument());

    const replyBtns = screen.getAllByRole('button', { name: /^reply$/i });
    await user.click(replyBtns[0]);

    await user.type(screen.getByPlaceholderText(/write a reply/i), 'Sure thing');
    // The button "Reply" inside the form (now there are two — pick the enabled one in the form)
    const submitBtn = screen.getAllByRole('button', { name: /^reply$/i }).find((b) => !b.disabled);
    await user.click(submitBtn);

    expect(utilMock.addCommentReply).toHaveBeenCalledWith(1, 'Sure thing');
  });

  it('Go to action calls onNavigate with the comment', async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<CommentManager logId={1} onClose={vi.fn()} onNavigate={onNavigate} />);
    await waitFor(() => expect(screen.getByText('First comment')).toBeInTheDocument());
    const goToBtns = screen.getAllByRole('button', { name: /go to/i });
    await user.click(goToBtns[0]);
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it('Close (×) in the header calls onClose', async () => {
    const onClose = vi.fn();
    const { container } = render(<CommentManager logId={1} onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('First comment')).toBeInTheDocument());
    // The header close button is the only button inside .comment-manager__header
    fireEvent.click(container.querySelector('.comment-manager__header button'));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders existing replies under each comment', async () => {
    render(<CommentManager logId={1} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Yes')).toBeInTheDocument());
  });

  it('shows the empty filter message when filtered list is empty', async () => {
    const user = userEvent.setup();
    utilMock.fetchComments.mockResolvedValueOnce({ comments: [sampleComments[0]] });
    render(<CommentManager logId={1} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('First comment')).toBeInTheDocument());

    const tagSelect = screen.getAllByRole('combobox')[0];
    await user.selectOptions(tagSelect, 'issue');
    expect(screen.getByText(/no comments match/i)).toBeInTheDocument();
  });
});
