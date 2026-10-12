/**
 * Cloud Codex - the invite dialog's squad and role pickers are menus (W6-CDX-39, Task 2.3)
 *
 * The native selects become Menu triggers: a button with aria-haspopup="menu", named by its label, that
 * shows the current choice. Choosing an item sets the value the invitation is sent with.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../src/util.jsx', () => ({
  fetchAdminSquads: vi.fn(),
  createAdminInvitation: vi.fn(),
  showModal: vi.fn(),
  destroyModal: vi.fn(),
  showToast: vi.fn(),
  timeAgo: () => 'just now',
}));

const { InviteUserModal } = await import('../../../src/pages/AdminPage.jsx');
const util = await import('../../../src/util.jsx');

beforeEach(() => {
  vi.clearAllMocks();
  util.fetchAdminSquads.mockResolvedValue({ squads: [{ id: 3, name: 'Core', workspace_name: 'HQ' }] });
  util.createAdminInvitation.mockResolvedValue({ message: 'Sent', signup_url: 'https://x.test/s', emailed: true });
});

describe('InviteUserModal: the squad and role pickers are menus', () => {
  it('renders no native select', async () => {
    const { container } = render(<InviteUserModal />);
    await screen.findByRole('button', { name: 'Squad (optional)' });
    expect(container.querySelector('select')).toBeNull();
  });

  it('opens a squad menu, names the choice on the trigger, and sends the chosen squad and role', async () => {
    const user = userEvent.setup();
    render(<InviteUserModal />);
    await user.type(screen.getByLabelText('Email Address:'), 'new@example.test');

    const squad = await screen.findByRole('button', { name: 'Squad (optional)' });
    expect(squad.getAttribute('aria-haspopup')).toBe('menu');
    expect(squad.textContent).toContain('No squad, assign later');
    await user.click(squad);
    await user.click(screen.getByRole('menuitem', { name: 'HQ / Core' }));
    expect(squad.textContent).toContain('HQ / Core');

    const role = await screen.findByRole('button', { name: 'Role:' });
    expect(role.textContent).toContain('Member');
    await user.click(role);
    await user.click(screen.getByRole('menuitem', { name: 'Owner' }));
    expect(role.textContent).toContain('Owner');

    await user.click(screen.getByRole('button', { name: 'Send Invitation' }));
    expect(util.createAdminInvitation).toHaveBeenCalledWith('new@example.test', expect.objectContaining({
      squadId: 3,
      role: 'owner',
    }));
  });
});
