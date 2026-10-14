/**
 * Cloud Codex - A remounted sidebar shows the last unread count and archives at once (W6-CDX-40 review, item 8)
 *
 * Every page mounts its own layout, so the sidebar remounts on navigation. The second mount here has fetches that
 * never answer: its pill and its Archives group must still show the values from the first mount.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/util.jsx', () => ({
  apiFetch: vi.fn(),
  fetchUnreadNotificationCount: vi.fn(),
  fetchNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  getSessionTokenFromCookie: vi.fn(() => 'tok'),
}));

import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { apiFetch, fetchUnreadNotificationCount, fetchNotifications } from '../../../src/util.jsx';
import Sidebar from '../../../src/components/Sidebar.jsx';
import { clearInboxCache } from '../../../src/lib/inbox-cache.js';

class FakeWebSocket {
  constructor() { this.listeners = {}; }
  addEventListener(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); }
  send() {}
  close() {}
}

const USER = { id: 7, name: 'Cached Person' };
const pending = () => new Promise(() => {});

function mountSidebar() {
  return render(
    <MemoryRouter>
      <Sidebar user={USER} isAdmin={false} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  clearInboxCache();
  vi.stubGlobal('WebSocket', FakeWebSocket);
  fetchNotifications.mockResolvedValue({ results: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('a remounted sidebar', () => {
  it('shows the cached unread pill and the cached archives before its fetches answer', async () => {
    apiFetch.mockImplementation((method, url) => (url === '/api/archives'
      ? Promise.resolve({ success: true, archives: [{ id: 3, name: 'Engineering Handbook' }] })
      : Promise.resolve({ connected: false, workspaces: [] })));
    fetchUnreadNotificationCount.mockResolvedValue({ count: 4 });

    const first = mountSidebar();
    await waitFor(() => expect(screen.getByRole('link', { name: 'Notifications, 4 unread' })).toBeTruthy());
    await waitFor(() => expect(screen.getByRole('link', { name: 'Engineering Handbook' })).toBeTruthy());
    first.unmount();

    // The second mount: every request is still pending.
    apiFetch.mockImplementation(() => pending());
    fetchUnreadNotificationCount.mockImplementation(() => pending());
    fetchNotifications.mockImplementation(() => pending());
    mountSidebar();
    expect(screen.getByRole('link', { name: 'Notifications, 4 unread' }).querySelector('.sidebar__pill').textContent).toBe('4');
    expect(screen.getByRole('link', { name: 'Engineering Handbook' })).toBeTruthy();
  });
});
