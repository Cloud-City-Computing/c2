/**
 * Cloud Codex - the Workspaces page renders the shared page header (W6-CDX-42, A5)
 *
 * Outside suite mode the Workspaces page is still reachable. Its title is the page's h1 inside the shared
 * PageHeader, and an admin's one primary action sits in the header's action slot.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../src/util.jsx', () => ({
  fetchWorkspaces: vi.fn(() => Promise.resolve({ workspaces: [] })),
  createWorkspace: vi.fn(),
  updateWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  fetchSquads: vi.fn(() => Promise.resolve({ squads: [] })),
  createSquad: vi.fn(),
  updateSquad: vi.fn(),
  deleteSquad: vi.fn(),
  fetchSquadMembers: vi.fn(() => Promise.resolve({ members: [] })),
  inviteSquadMember: vi.fn(),
  updateSquadMember: vi.fn(),
  removeSquadMember: vi.fn(),
  fetchSquadInvitations: vi.fn(() => Promise.resolve({ invitations: [] })),
  cancelInvitation: vi.fn(),
  searchUsers: vi.fn(),
  showModal: vi.fn(),
  destroyModal: vi.fn(),
  fetchAdminStatus: vi.fn(() => Promise.resolve({ isAdmin: true })),
  timeAgo: () => 'just now',
}));
vi.mock('../../../src/page_layouts/Std_Layout.jsx', () => ({
  default: ({ children }) => <div>{children}</div>,
}));

import WorkspacesPage from '../../../src/pages/WorkspacesPage.jsx';

describe('WorkspacesPage header', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('titles the page in the shared page header', async () => {
    const { container } = render(<MemoryRouter><WorkspacesPage /></MemoryRouter>);
    const title = await screen.findByRole('heading', { level: 1, name: 'Workspaces' });
    expect(title.closest('.page-header')).not.toBeNull();
    expect(container.querySelector('.log-header')).toBeNull();
  });

  it('puts the admin primary action in the header action slot', async () => {
    const { container } = render(<MemoryRouter><WorkspacesPage /></MemoryRouter>);
    const action = await screen.findByRole('button', { name: /new workspace/i });
    expect(action.closest('.page-header__actions')).not.toBeNull();
    expect(container.querySelectorAll('.page-header__actions .btn-primary')).toHaveLength(1);
  });
});
