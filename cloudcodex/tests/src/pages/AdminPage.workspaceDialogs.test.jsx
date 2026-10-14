/**
 * Cloud Codex - The Admin console holds the workspace and squad dialogs (W6-CDX-40 review, item 12)
 *
 * The Admin console is where a workspace can be renamed, given a squad, and deleted; a squad can be renamed, given a member, and
 * deleted; a squad's pending invitations can be cancelled. Each action here reaches the same route and utility
 * the Workspaces page uses, and each is tested through the page.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { captured } = vi.hoisted(() => ({ captured: { element: null } }));
vi.mock('../../../src/util.jsx', () => ({
  fetchAdminStatus: vi.fn(),
  fetchAdminStats: vi.fn(),
  fetchAdminPresence: vi.fn(),
  fetchAdminWorkspaces: vi.fn(),
  fetchAdminUsers: vi.fn(),
  fetchAdminSquads: vi.fn(),
  fetchAdminSquadMembers: vi.fn(),
  fetchAdminInvitations: vi.fn(),
  deleteAdminWorkspace: vi.fn(),
  deleteSquad: vi.fn(),
  fetchSquadInvitations: vi.fn(),
  cancelInvitation: vi.fn(),
  searchUsers: vi.fn(),
  inviteSquadMember: vi.fn(),
  updateWorkspace: vi.fn(),
  createSquad: vi.fn(),
  showModal: vi.fn((el) => { captured.element = el; }),
  destroyModal: vi.fn(),
  timeAgo: () => 'just now',
  apiFetch: vi.fn(),
  getSessionTokenFromCookie: vi.fn(),
  attemptAutoLogin: vi.fn(),
  deleteAdminInvitation: vi.fn(),
  createAdminInvitation: vi.fn(),
  createAdminWorkspace: vi.fn(),
  deleteAdminUser: vi.fn(),
  updateAdminUserAdmin: vi.fn(),
  resetAdminUser2fa: vi.fn(),
  fetchAdminUserPermissions: vi.fn(),
  updateAdminUserPermissions: vi.fn(),
  updateAdminSquadMember: vi.fn(),
  removeAdminSquadMember: vi.fn(),
}));
vi.mock('../../../src/page_layouts/Std_Layout.jsx', () => ({
  default: ({ children }) => <div>{children}</div>,
}));
vi.mock('../../../src/components/WebhooksPanel.jsx', () => ({ default: () => null }));

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import * as util from '../../../src/util.jsx';
import AdminPage from '../../../src/pages/AdminPage.jsx';
import { NewSquadModal, RenameOrgModal, RenameSquadModal, InviteMemberModal } from '../../../src/pages/WorkspacesPage.jsx';
import ConfirmDialog from '../../../src/components/ConfirmDialog.jsx';

const WORKSPACE = { id: 9, name: 'Acme', owner: 'alice', squad_count: 1, member_count: 2, created_at: '2026-10-01T00:00:00Z' };
const SQUAD = { id: 5, name: 'Platform', workspace_id: 9, workspace_name: 'Acme', member_count: 1, archive_count: 0 };
const INVITE = { id: 42, email: 'pending@example.test', role: 'member', created_at: '2026-10-10T00:00:00Z' };

beforeEach(() => {
  vi.clearAllMocks();
  captured.element = null;
  util.fetchAdminStatus.mockResolvedValue({ isAdmin: true });
  util.fetchAdminStats.mockResolvedValue({ stats: {} });
  util.fetchAdminPresence.mockResolvedValue({ onlineUsers: [] });
  util.fetchAdminUsers.mockResolvedValue({ users: [] });
  util.fetchAdminInvitations.mockResolvedValue({ invitations: [] });
  util.fetchAdminWorkspaces.mockResolvedValue({ workspaces: [WORKSPACE] });
  util.fetchAdminSquads.mockResolvedValue({ squads: [SQUAD] });
  util.fetchAdminSquadMembers.mockResolvedValue({ members: [] });
  util.fetchSquadInvitations.mockResolvedValue({ invitations: [INVITE] });
});

async function openPanel(name) {
  render(<AdminPage />);
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(name) }));
}

describe('the workspace row holds rename, a new squad and delete', () => {
  it('Rename opens the workspace rename dialog for that workspace', async () => {
    await openPanel('Workspaces');
    fireEvent.click(await screen.findByRole('button', { name: 'Rename' }));
    expect(captured.element.type).toBe(RenameOrgModal);
    expect(captured.element.props.workspace.id).toBe(9);
  });

  it('New squad opens the squad dialog for that workspace', async () => {
    await openPanel('Workspaces');
    fireEvent.click(await screen.findByRole('button', { name: 'New squad' }));
    expect(captured.element.type).toBe(NewSquadModal);
    expect(captured.element.props.workspaceId).toBe(9);
  });

  it('Delete still deletes the workspace after a confirm', async () => {
    util.deleteAdminWorkspace.mockResolvedValue({ success: true });
    await openPanel('Workspaces');
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(captured.element.type).toBe(ConfirmDialog);
    render(captured.element);
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' }).at(-1));
    await waitFor(() => expect(util.deleteAdminWorkspace).toHaveBeenCalledWith(9));
  });
});

describe('the expanded squad holds invite, rename, pending invitations and delete', () => {
  async function expandSquad() {
    await openPanel('Squads');
    fireEvent.click(await screen.findByText('Platform'));
    await waitFor(() => expect(util.fetchSquadInvitations).toHaveBeenCalledWith(5));
  }

  it('lists the pending squad invitations, each with a cancel', async () => {
    await expandSquad();
    expect(await screen.findByText('pending@example.test')).toBeTruthy();
  });

  it('Cancel invitation cancels that squad invitation', async () => {
    util.cancelInvitation.mockResolvedValue({ success: true });
    await expandSquad();
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel invitation' }));
    await waitFor(() => expect(util.cancelInvitation).toHaveBeenCalledWith(42));
  });

  it('Invite member opens the invite dialog for that squad', async () => {
    await expandSquad();
    fireEvent.click(await screen.findByRole('button', { name: 'Invite member' }));
    expect(captured.element.type).toBe(InviteMemberModal);
    expect(captured.element.props.squadId).toBe(5);
  });

  it('Rename squad opens the squad rename dialog', async () => {
    await expandSquad();
    fireEvent.click(await screen.findByRole('button', { name: 'Rename squad' }));
    expect(captured.element.type).toBe(RenameSquadModal);
    expect(captured.element.props.squad.id).toBe(5);
  });

  it('Delete squad deletes it after a confirm', async () => {
    util.deleteSquad.mockResolvedValue({ success: true });
    await expandSquad();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete squad' }));
    expect(captured.element.type).toBe(ConfirmDialog);
    render(captured.element);
    const dialog = screen.getAllByRole('button', { name: 'Delete' }).at(-1);
    fireEvent.click(dialog);
    await waitFor(() => expect(util.deleteSquad).toHaveBeenCalledWith(5));
  });
});

void within;
