/**
 * Cloud Codex - the invite dialog's menus under the real dialog contract (W6-CDX-39, momus 2 and 8c).
 * showModal mounts the invite dialog exactly as the app does, with its focus trap and Escape handling.
 * Inside it, Tab closes the squad menu and leaves focus on its trigger in the dialog; Escape closes the menu and
 * leaves the dialog open; the popup is portalled into the dialog, so it is inside the aria-modal region.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../src/util.jsx', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    fetchAdminSquads: vi.fn(() => Promise.resolve({ squads: [{ id: 3, name: 'Core', workspace_name: 'HQ' }] })),
    createAdminInvitation: vi.fn(),
  };
});

const util = await import('../../../src/util.jsx');
const { InviteUserModal } = await import('../../../src/pages/AdminPage.jsx');

beforeEach(() => {
  document.body.innerHTML = '';
  for (const id of ['modal-root', 'modal-dimmer', 'dropdown-root']) {
    const el = document.createElement('div');
    el.id = id;
    if (id === 'modal-dimmer') el.style.display = 'none';
    document.body.appendChild(el);
  }
});
afterEach(() => { document.body.innerHTML = ''; });

async function openInvite() {
  act(() => { util.showModal(<InviteUserModal />, 'modal-md'); });
  const squad = await screen.findByRole('button', { name: /^Squad \(optional\)/ });
  return { squad, dialog: document.querySelector('#modal-root .modal-content-wrapper') };
}

describe('the invite dialog\'s squad menu, under showModal\'s focus trap', () => {
  it('Tab closes the menu and leaves focus on its trigger, inside the dialog', async () => {
    const user = userEvent.setup();
    const { squad, dialog } = await openInvite();
    await user.click(squad);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Tab}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(squad);
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.querySelector('#modal-root .modal-content-wrapper')).not.toBeNull();
  });

  it('the popup is inside the aria-modal dialog, so it is in the region assistive tech reads', async () => {
    const user = userEvent.setup();
    const { squad, dialog } = await openInvite();
    await user.click(squad);
    const menu = screen.getByRole('menu');
    expect(dialog.contains(menu)).toBe(true);
    expect(menu.closest('[aria-modal="true"]')).toBe(dialog);
  });

  it('Escape closes the menu and leaves the dialog open', async () => {
    const user = userEvent.setup();
    const { squad } = await openInvite();
    await user.click(squad);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.querySelector('#modal-root .modal-content-wrapper')).not.toBeNull();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('Tab from the last item in the dialog with the menu open still closes the menu, then the trap holds', async () => {
    const user = userEvent.setup();
    const { squad } = await openInvite();
    await user.click(squad);
    fireEvent.keyDown(document.activeElement, { key: 'Tab', shiftKey: true });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(squad);
  });
});
