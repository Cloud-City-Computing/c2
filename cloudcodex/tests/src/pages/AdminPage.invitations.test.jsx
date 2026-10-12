/**
 * Cloud Codex - Tests for the admin console's invitation revoke error (X3, W6-CDX-39)
 *
 * A failing revoke must show the server's message, not the generic line the toast falls back to, and a
 * refusal (403) keeps its "Permission denied" prefix. The Toast module is a singleton, so each test loads
 * a fresh copy of the page and the toast container.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

const serverMessage = 'Could not revoke the invitation. Try again in a moment.';

vi.mock('../../../src/util.jsx', () => ({
  fetchAdminStatus: vi.fn(),
  fetchAdminStats: vi.fn(),
  fetchAdminPresence: vi.fn(),
  fetchAdminWorkspaces: vi.fn(),
  fetchAdminUsers: vi.fn(),
  fetchAdminSquads: vi.fn(),
  fetchAdminInvitations: vi.fn(),
  deleteAdminInvitation: vi.fn(),
  showModal: vi.fn(),
  destroyModal: vi.fn(),
  timeAgo: () => 'just now',
}));

vi.mock('../../../src/page_layouts/Std_Layout.jsx', () => ({
  default: ({ children }) => <div>{children}</div>,
}));
vi.mock('../../../src/components/WebhooksPanel.jsx', () => ({ default: () => null }));
vi.mock('../../../src/components/ConfirmDialog.jsx', () => ({ default: () => null }));

/** Loads a fresh page, toast container and util mocks, with one pending invitation whose revoke rejects. */
async function renderWithRejectedRevoke(error) {
  vi.resetModules();
  document.getElementById('toast-root')?.remove();
  const util = await import('../../../src/util.jsx');
  util.fetchAdminStatus.mockResolvedValue({ isAdmin: true });
  util.fetchAdminStats.mockResolvedValue({ stats: {} });
  util.fetchAdminPresence.mockResolvedValue({ onlineUsers: [] });
  util.fetchAdminInvitations.mockResolvedValue({
    invitations: [{
      id: 7,
      email: 'pending@example.test',
      accepted: false,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      created_at: new Date().toISOString(),
      invited_by_name: 'Kyle',
    }],
  });
  util.deleteAdminInvitation.mockRejectedValue(error);
  const { default: AdminPage } = await import('../../../src/pages/AdminPage.jsx');
  render(<AdminPage />);
  fireEvent.click(await screen.findByRole('button', { name: /Invitations/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
  // X8: Revoke opens a confirm first; the revoke itself runs when the confirm does.
  const confirm = util.showModal.mock.calls.at(-1)[0];
  await act(async () => { await confirm.props.onConfirm(); });
}

describe('AdminPage: a failing invitation revoke shows the server message (X3)', () => {
  afterEach(() => { cleanup(); });

  it('shows the body message of the error, not the generic fallback', async () => {
    await renderWithRejectedRevoke(Object.assign(new Error('Request failed'), {
      status: 500,
      body: { message: serverMessage },
    }));
    expect(await screen.findByText(serverMessage)).toBeInTheDocument();
    expect(screen.queryByText('An unexpected error occurred.')).toBeNull();
  });

  // The call site passes the error itself, so the status survives and the 403 prefix is shown.
  it('keeps the status of the error, so a refusal reads as a refusal', async () => {
    await renderWithRejectedRevoke(Object.assign(new Error('Request failed'), {
      status: 403,
      body: { message: serverMessage },
    }));
    expect(await screen.findByText(`Permission denied: ${serverMessage}`)).toBeInTheDocument();
  });

  // momus 7: only an API error (one with a status) carries a message worth showing; a network failure does not.
  it('shows the fallback copy, not the raw error text, for an error with no API status', async () => {
    await renderWithRejectedRevoke(new TypeError('Failed to fetch'));
    expect(await screen.findByText('Error revoking invitation.')).toBeInTheDocument();
    expect(screen.queryByText('Failed to fetch')).toBeNull();
  });

  // Task 2.4: statuses are chips (the pattern's pill at the 12 px floor).
  it('draws the invitation status as a chip', async () => {
    await renderWithRejectedRevoke(new Error('unused'));
    const status = document.querySelector('.status-badge');
    expect(status).not.toBeNull();
    expect(status.classList.contains('chip')).toBe(true);
  });
});
