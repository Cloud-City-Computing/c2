/**
 * Cloud Codex — Tests for src/components/CommentForm.jsx
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CommentForm from '../../../src/components/CommentForm.jsx';

describe('CommentForm', () => {
  it('focuses the textarea on mount', () => {
    render(<CommentForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByPlaceholderText(/add a comment/i));
  });

  it('disables submit while content is empty', () => {
    render(<CommentForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: /add comment/i })).toBeDisabled();
  });

  it('enables submit once non-whitespace content is typed', async () => {
    const user = userEvent.setup();
    render(<CommentForm onSubmit={vi.fn()} onCancel={vi.fn()} />);

    await user.type(screen.getByPlaceholderText(/add a comment/i), 'Hello');
    expect(screen.getByRole('button', { name: /add comment/i })).toBeEnabled();
  });

  it('submits with trimmed content and the default tag "comment"', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(() => Promise.resolve());
    render(<CommentForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByPlaceholderText(/add a comment/i), '   Hello world   ');
    await user.click(screen.getByRole('button', { name: /add comment/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ content: 'Hello world', tag: 'comment' });
    });
  });

  it('lets the user pick a different tag before submitting', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(() => Promise.resolve());
    render(<CommentForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /question/i }));
    await user.type(screen.getByPlaceholderText(/add a comment/i), 'Why?');
    await user.click(screen.getByRole('button', { name: /add comment/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ content: 'Why?', tag: 'question' });
    });
  });

  it('submits on Cmd+Enter', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(() => Promise.resolve());
    render(<CommentForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    const textarea = screen.getByPlaceholderText(/add a comment/i);
    await user.type(textarea, 'Hi');
    await user.keyboard('{Meta>}{Enter}{/Meta}');

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  });

  it('shows a truncated selected text when over 80 chars', () => {
    const long = 'a'.repeat(100);
    render(<CommentForm selectedText={long} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    const sel = screen.getByText(/selected/i).parentElement.textContent;
    expect(sel).toContain('...');
    expect(sel.length).toBeLessThan(long.length);
  });

  it('cancel button calls onCancel', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<CommentForm onSubmit={vi.fn()} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('flips submit text to "Adding..." while in flight', async () => {
    const user = userEvent.setup();
    let resolve;
    const onSubmit = vi.fn(() => new Promise((r) => { resolve = r; }));
    render(<CommentForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByPlaceholderText(/add a comment/i), 'wait');
    await user.click(screen.getByRole('button', { name: /add comment/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /adding/i })).toBeDisabled();
    });
    resolve();
  });
});
