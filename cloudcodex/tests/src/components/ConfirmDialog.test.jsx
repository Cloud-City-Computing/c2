/**
 * Cloud Codex — Tests for src/components/ConfirmDialog.jsx
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConfirmDialog from '../../../src/components/ConfirmDialog.jsx';

vi.mock('../../../src/util.jsx', () => ({
  destroyModal: vi.fn(),
}));

describe('ConfirmDialog', () => {
  it('renders the title, message, and a default Delete button styled as danger', () => {
    render(
      <ConfirmDialog title="Delete archive?" message="This is permanent." onConfirm={vi.fn()} />
    );
    expect(screen.getByRole('heading', { name: /delete archive\?/i })).toBeInTheDocument();
    expect(screen.getByText(/this is permanent/i)).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: /delete/i });
    expect(confirm.className).toMatch(/btn-danger/);
  });

  it('renders Cancel and confirm buttons; Cancel calls onCancel', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<ConfirmDialog title="t" message="m" onConfirm={vi.fn()} onCancel={onCancel} />);

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('disables both buttons while the confirm action is pending', async () => {
    const user = userEvent.setup();
    let resolve;
    const onConfirm = vi.fn(() => new Promise((r) => { resolve = r; }));
    render(<ConfirmDialog title="t" message="m" onConfirm={onConfirm} confirmLabel="Confirm" />);

    const confirmBtn = screen.getByRole('button', { name: /confirm/i });
    await user.click(confirmBtn);

    // Both buttons are disabled while loading and the label flips to "Working..."
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /working/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
    });

    resolve();
  });

  it('shows a Permission denied error when onConfirm rejects with status 403', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(() =>
      Promise.reject(Object.assign(new Error('You may not'), { status: 403 }))
    );
    render(<ConfirmDialog title="t" message="m" onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: /delete/i }));

    await waitFor(() => {
      expect(screen.getByText(/permission denied: you may not/i)).toBeInTheDocument();
    });
  });

  it('shows a generic error when onConfirm rejects without a body message', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(() => Promise.reject(new Error()));
    render(<ConfirmDialog title="t" message="m" onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: /delete/i }));
    await waitFor(() => {
      expect(screen.getByText(/an unexpected error occurred/i)).toBeInTheDocument();
    });
  });

  it('uses btn-primary instead of btn-danger when danger=false', () => {
    render(<ConfirmDialog title="t" message="m" confirmLabel="Save" danger={false} onConfirm={vi.fn()} />);
    const btn = screen.getByRole('button', { name: /save/i });
    expect(btn.className).toMatch(/btn-primary/);
    expect(btn.className).not.toMatch(/btn-danger/);
  });

  it('clicking the close button calls handleCancel', () => {
    const onCancel = vi.fn();
    const { container } = render(
      <ConfirmDialog title="t" message="m" onConfirm={vi.fn()} onCancel={onCancel} />
    );
    const closeBtn = container.querySelector('.close-button');
    fireEvent.click(closeBtn);
    expect(onCancel).toHaveBeenCalled();
  });
});
