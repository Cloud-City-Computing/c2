/**
 * Cloud Codex - The sidebar is the product's own shell, with no suite zone and no switcher (CDX-SA-2, Task 2.4)
 *
 * The sidebar takes no suite prop. It always shows the product mark and name at the top, the Workspaces
 * slot and nav item, and never a suite cluster, whatever the removed suite variables held.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/util.jsx', () => ({
  apiFetch: vi.fn(async () => ({})),
  fetchUnreadNotificationCount: vi.fn(async () => ({ count: 0 })),
  fetchNotifications: vi.fn(async () => ({ results: [] })),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  getSessionTokenFromCookie: vi.fn(() => 'tok'),
}));

import { render, screen, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from '../../../src/components/Sidebar.jsx';
import { clearInboxCache } from '../../../src/lib/inbox-cache.js';

class FakeWebSocket {
  addEventListener() {}
  send() {}
  close() {}
}

beforeEach(() => {
  clearInboxCache();
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function mount() {
  const { container } = render(
    <MemoryRouter>
      <Sidebar user={{ id: 7, name: 'Shell Person' }} isAdmin={false} />
    </MemoryRouter>,
  );
  return container.querySelector('aside.sidebar');
}

describe('the sidebar has no suite zone', () => {
  it('shows the product mark and name at the top, and never a suite cluster', () => {
    const aside = mount();
    const brand = aside.querySelector('a.sidebar__brand');
    expect(brand).not.toBeNull();
    expect(brand.textContent).toContain('Cloud Codex');
    expect(aside.querySelector('.cc-suite')).toBeNull();
    expect(aside.textContent).not.toMatch(/this workspace/i);
  });

  it('offers Workspaces as a nav item and as the workspace slot', () => {
    const aside = mount();
    expect(within(aside).getByRole('link', { name: 'Workspaces' }).getAttribute('href')).toBe('/workspaces');
    expect(aside.querySelector('a.workspace-slot')?.getAttribute('href')).toBe('/workspaces');
  });
});
