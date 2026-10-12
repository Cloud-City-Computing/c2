/**
 * Cloud Codex - the admin console is a tab row in a page header (W6-CDX-42, A5)
 *
 * The sections are tabs in the page header, not an inner sidebar. The console has no emoji (X12): a text scan
 * of every tab finds no pictograph. A Users row with a false flag shows no bare number (X7). Revoke on an
 * invitation confirms first, naming the invitation's address, and calls the API only when the confirm does (X8).
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const captured = vi.hoisted(() => ({ element: null }));

vi.mock('../../../src/util.jsx', () => ({
  fetchAdminStatus: vi.fn(),
  fetchAdminStats: vi.fn(),
  fetchAdminPresence: vi.fn(),
  fetchAdminWorkspaces: vi.fn(),
  fetchAdminUsers: vi.fn(),
  fetchAdminSquads: vi.fn(),
  fetchAdminSquadMembers: vi.fn(),
  fetchAdminInvitations: vi.fn(),
  deleteAdminInvitation: vi.fn(),
  fetchSquadInvitations: vi.fn(),
  showModal: vi.fn((el) => { captured.element = el; }),
  destroyModal: vi.fn(),
  timeAgo: () => 'just now',
}));
vi.mock('../../../src/page_layouts/Std_Layout.jsx', () => ({
  default: ({ children }) => <div>{children}</div>,
}));
vi.mock('../../../src/components/WebhooksPanel.jsx', () => ({ default: () => <p>Webhooks panel</p> }));

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import * as util from '../../../src/util.jsx';
import AdminPage from '../../../src/pages/AdminPage.jsx';
import ConfirmDialog from '../../../src/components/ConfirmDialog.jsx';

const PICTOGRAPH = /\p{Extended_Pictographic}/u;
const TABS = ['Overview', 'Users', 'Workspaces', 'Squads', 'Invitations', 'Webhooks'];
const USER = {
  id: 3, name: 'Dana', email: 'dana@example.test', squad_count: 0, is_admin: 0,
  created_at: '2026-10-01T00:00:00Z', two_factor_method: 'none', has_totp_secret: 0,
};
const INVITE = {
  id: 42, email: 'pending@example.test', accepted: 0, invited_by_name: 'Kyle',
  created_at: '2026-10-10T00:00:00Z', expires_at: new Date(Date.now() + 86400000).toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
  captured.element = null;
  util.fetchAdminStatus.mockResolvedValue({ isAdmin: true });
  util.fetchAdminStats.mockResolvedValue({ stats: { userCount: 2, workspaceCount: 1, squadCount: 1, archiveCount: 3, logCount: 9, pendingInviteCount: 1 } });
  util.fetchAdminPresence.mockResolvedValue({ onlineUsers: [] });
  util.fetchAdminUsers.mockResolvedValue({ users: [USER] });
  util.fetchAdminWorkspaces.mockResolvedValue({ workspaces: [{ id: 9, name: 'Acme', owner: 'alice', squad_count: 1, member_count: 2, created_at: '2026-10-01T00:00:00Z' }] });
  util.fetchAdminSquads.mockResolvedValue({ squads: [{ id: 5, name: 'Platform', workspace_name: 'Acme', member_count: 1, archive_count: 0 }] });
  util.fetchAdminInvitations.mockResolvedValue({ invitations: [INVITE] });
});

async function openTab(name) {
  fireEvent.click(await screen.findByRole('button', { name }));
}

describe('the admin console is a tab row in the page header', () => {
  it('renders the page title and one tab per section, with no inner sidebar', async () => {
    const { container } = render(<AdminPage />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Admin' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Admin sections' });
    expect(nav.querySelectorAll('button')).toHaveLength(TABS.length);
    for (const tab of TABS) expect(screen.getByRole('button', { name: tab })).toBeInTheDocument();
    expect(container.querySelector('.admin-sidebar')).toBeNull();
    expect(container.querySelector('.admin-sidebar__nav')).toBeNull();
  });

  it('marks the open tab as the current page and switches the section', async () => {
    render(<AdminPage />);
    await openTab('Users');
    expect(screen.getByRole('button', { name: 'Users' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByText('dana@example.test')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Overview' })).not.toHaveAttribute('aria-current');
  });
});

describe('X12: no emoji in the console', () => {
  it('no tab, section or stat tile carries a pictograph', async () => {
    const { container } = render(<AdminPage />);
    await screen.findByText('Pending invites');
    for (const tab of TABS) {
      await openTab(tab);
      await waitFor(() => expect(container.querySelector('.admin-main')).not.toBeNull());
      expect(container.querySelector('.admin-page').textContent, tab).not.toMatch(PICTOGRAPH);
    }
  });
});

describe('X7: a Users row shows no bare number', () => {
  it('the actions cell holds the buttons and no stray 0 after Permissions', async () => {
    const { container } = render(<AdminPage />);
    await openTab('Users');
    const row = (await screen.findByText('dana@example.test')).closest('.admin-member-row');
    const actions = row.querySelector('.admin-cell-actions');
    expect(actions.textContent).toBe('PermissionsDelete');
    expect(container.querySelectorAll('.admin-cell-actions').length).toBeGreaterThan(0);
  });

  it('labels the squad count in words', async () => {
    render(<AdminPage />);
    await openTab('Users');
    expect(await screen.findByText('0 squads')).toBeInTheDocument();
  });
});

describe('X8: Revoke confirms, naming the invitation', () => {
  it('opens a confirm that names the address, and calls the API only on confirm', async () => {
    util.deleteAdminInvitation.mockResolvedValue({ success: true });
    render(<AdminPage />);
    await openTab('Invitations');
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }));

    expect(captured.element.type).toBe(ConfirmDialog);
    expect(captured.element.props.title).toBe('Revoke the invitation to pending@example.test?');
    expect(util.deleteAdminInvitation).not.toHaveBeenCalled();

    await act(async () => { await captured.element.props.onConfirm(); });
    expect(util.deleteAdminInvitation).toHaveBeenCalledWith(42);
  });

  it('leaves the invitation alone when the confirm is cancelled', async () => {
    render(<AdminPage />);
    await openTab('Invitations');
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    expect(captured.element.type).toBe(ConfirmDialog);
    expect(util.deleteAdminInvitation).not.toHaveBeenCalled();
  });
});
