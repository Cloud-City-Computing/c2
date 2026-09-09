/**
 * Cloud Codex - Tests for ManageArchiveAccessModal (src/components/ArchiveBrowser.jsx)
 *
 * Covers the C2-1 follow-up: POST /api/archives/:id/access leaves `remove`
 * ungated so a cross-tenant grant made before the boundary check can still be
 * revoked, but the only id the modal could produce came from /users/search,
 * which the same branch scopes to the workspace. A grantee outside the
 * workspace was therefore unreachable from the UI. The revoke control now
 * hangs off the rows GET /api/archives/:id/access already returns.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { utilMock } = vi.hoisted(() => ({
  utilMock: {
    fetchCommentCount: vi.fn(async () => ({ count: 0 })),
    exportDocument: vi.fn(async () => ({})),
    fetchDocument: vi.fn(async () => ({ document: { html_content: '' } })),
    deleteLog: vi.fn(),
    showModal: vi.fn(),
    destroyModal: vi.fn(),
    apiFetch: vi.fn(async () => ({})),
    fetchArchives: vi.fn(async () => ({ archives: [] })),
    createArchive: vi.fn(),
    updateArchive: vi.fn(),
    deleteArchive: vi.fn(),
    fetchLogs: vi.fn(async () => ({ logs: [] })),
    manageArchiveAccess: vi.fn(async () => ({ success: true })),
    manageArchiveSquadAccess: vi.fn(async () => ({ success: true })),
    manageArchiveWorkspaceAccess: vi.fn(),
    fetchArchiveAccess: vi.fn(),
    searchUsers: vi.fn(async () => ({ users: [] })),
    uploadDocument: vi.fn(),
    fetchArchiveRepos: vi.fn(async () => ({ repos: [] })),
    linkArchiveRepo: vi.fn(),
    unlinkArchiveRepo: vi.fn(),
    importArchiveRepo: vi.fn(),
  },
}));

vi.mock('../../../src/util.jsx', () => utilMock);
vi.mock('../../../src/hooks/usePresence', () => ({
  default: () => ({ getLogUsers: () => [] }),
}));
vi.mock('../../../src/hooks/useGitHubStatus.jsx', () => ({
  default: () => ({ connected: false }),
}));

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ManageArchiveAccessModal } from '../../../src/components/ArchiveBrowser.jsx';

const ARCHIVE = { id: 7, name: 'Ops Runbooks', squad_id: 3 };

// dave is the cross-tenant grantee from the docs/security.md audit query: he
// sits in read_access but is in no squad of this workspace, so /users/search
// never returns him.
const access = (overrides = {}) => ({
  read_users: [{ id: 41, name: 'Dave Cross', email: 'dave@other.example' }],
  write_users: [],
  read_squads: [],
  write_squads: [],
  read_workspace: false,
  write_workspace: false,
  squad_id: 3,
  workspace_squads: [{ id: 3, name: 'Platform' }],
  owner_squad_name: 'Platform',
  owner_squad_members: [
    { user_id: 9, name: 'Alice Member', email: 'alice@example.com', role: 'member', can_read: 1, can_write: 1 },
  ],
  granted_squad_user_ids: [9],
  created_by: 2,
  created_by_name: 'Owner Person',
  ...overrides,
});

const renderModal = (props = {}) =>
  render(
    <MemoryRouter>
      <ManageArchiveAccessModal archive={ARCHIVE} {...props} />
    </MemoryRouter>
  );

beforeEach(() => {
  Object.values(utilMock).forEach((fn) => typeof fn?.mockReset === 'function' && fn.mockReset());
  utilMock.searchUsers.mockResolvedValue({ users: [] });
  utilMock.manageArchiveAccess.mockResolvedValue({ success: true });
  utilMock.manageArchiveSquadAccess.mockResolvedValue({ success: true });
  utilMock.fetchArchiveAccess.mockResolvedValue({ access: access() });
});

describe('ManageArchiveAccessModal revoke controls', () => {
  it('offers a revoke control on an explicit user grant the search picker cannot reach', async () => {
    renderModal();

    expect(await screen.findByText('Dave Cross')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke access for Dave Cross' })).toBeInTheDocument();

    // The picker really is a dead end for this grantee.
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Search by name or email...'), 'dave');
    await waitFor(() => expect(utilMock.searchUsers).toHaveBeenCalled());
    expect(screen.queryByText('dave@other.example')).toBeNull();
  });

  it('does not offer a revoke control on an inherited squad-membership row', async () => {
    renderModal();

    // The row is listed for context, so the operator can see why Alice has
    // access, but a remove for her would be a no-op: she holds no ACL row.
    expect(await screen.findByText('Alice Member')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke access for Alice Member' })).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Revoke access for/ })).toHaveLength(1);
  });

  it('revokes with the row id and action remove, without a selected user', async () => {
    const user = userEvent.setup();
    const onAccessSaved = vi.fn();
    const onAccessUpdated = vi.fn();
    renderModal({ onAccessSaved, onAccessUpdated });

    await user.click(await screen.findByRole('button', { name: 'Revoke access for Dave Cross' }));

    // Destructive, so it goes through the shared confirmation first.
    expect(await screen.findByText('Revoke Archive Access')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Revoke' }));

    await waitFor(() => expect(utilMock.manageArchiveAccess).toHaveBeenCalledTimes(1));
    expect(utilMock.manageArchiveAccess).toHaveBeenCalledWith(7, 41, 'read', 'remove');

    await waitFor(() => expect(utilMock.destroyModal).toHaveBeenCalled(), { timeout: 3000 });
    expect(onAccessSaved).toHaveBeenCalledWith('Successfully revoked read access for Dave Cross.');
    expect(onAccessUpdated).toHaveBeenCalled();
  });

  it('revokes only the permissions the row actually holds', async () => {
    utilMock.fetchArchiveAccess.mockResolvedValue({
      access: access({
        read_users: [{ id: 41, name: 'Dave Cross', email: 'dave@other.example' }],
        write_users: [{ id: 41, name: 'Dave Cross', email: 'dave@other.example' }],
      }),
    });
    const user = userEvent.setup();
    renderModal();

    await user.click(await screen.findByRole('button', { name: 'Revoke access for Dave Cross' }));
    await user.click(await screen.findByRole('button', { name: 'Revoke' }));

    await waitFor(() => expect(utilMock.manageArchiveAccess).toHaveBeenCalledTimes(2));
    expect(utilMock.manageArchiveAccess).toHaveBeenCalledWith(7, 41, 'read', 'remove');
    expect(utilMock.manageArchiveAccess).toHaveBeenCalledWith(7, 41, 'write', 'remove');
  });

  it('leaves the grant alone when the confirmation is cancelled', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(await screen.findByRole('button', { name: 'Revoke access for Dave Cross' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(utilMock.manageArchiveAccess).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Revoke access for Dave Cross' })).toBeInTheDocument();
  });

  it('revokes an explicit squad grant from its own row', async () => {
    utilMock.fetchArchiveAccess.mockResolvedValue({
      access: access({
        read_squads: [{ id: 88, name: 'Contractors' }],
        write_squads: [{ id: 88, name: 'Contractors' }],
      }),
    });
    const user = userEvent.setup();
    renderModal();

    await user.click(await screen.findByRole('button', { name: 'Squads' }));
    await user.click(await screen.findByRole('button', { name: 'Revoke access for squad Contractors' }));
    await user.click(await screen.findByRole('button', { name: 'Revoke' }));

    await waitFor(() => expect(utilMock.manageArchiveSquadAccess).toHaveBeenCalledTimes(2));
    expect(utilMock.manageArchiveSquadAccess).toHaveBeenCalledWith(7, 88, 'read', 'remove');
    expect(utilMock.manageArchiveSquadAccess).toHaveBeenCalledWith(7, 88, 'write', 'remove');
  });
});
