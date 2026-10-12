/**
 * Cloud Codex - The Notifications list is live (W6-CDX-40 review, item 10)
 *
 * The list subscribes to the same channel as the sidebar's unread pill. A new notification, or a read, that
 * arrives on that channel reloads the list without a page reload.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/util.jsx', () => ({
  fetchNotifications: vi.fn(),
  fetchUnreadNotificationCount: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  getSessionTokenFromCookie: vi.fn(() => 'tok'),
  timeAgo: () => 'just now',
}));
vi.mock('../../../src/page_layouts/Std_Layout.jsx', () => ({
  default: ({ children }) => <div>{children}</div>,
}));

import { render, screen, waitFor, act, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { fetchNotifications, fetchUnreadNotificationCount, getSessionTokenFromCookie } from '../../../src/util.jsx';
import NotificationsPage from '../../../src/pages/NotificationsPage.jsx';
import useNotificationChannel from '../../../src/hooks/useNotificationChannel.js';
import { clearInboxCache } from '../../../src/lib/inbox-cache.js';

class FakeWebSocket {
  static instances = [];
  constructor() { this.listeners = {}; FakeWebSocket.instances.push(this); }
  addEventListener(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); }
  send() {}
  close() {}
  dispatch(name, payload) { (this.listeners[name] || []).forEach((fn) => fn(payload)); }
}

const note = (id, title) => ({ id, title, type: 'mention', read_at: null, created_at: '2026-10-12T00:00:00Z' });

beforeEach(() => {
  clearInboxCache();
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  getSessionTokenFromCookie.mockReturnValue('tok');
  fetchUnreadNotificationCount.mockResolvedValue({ count: 1 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the Notifications list follows the live channel', () => {
  it('shows a notification that arrives while the page is open, without a reload', async () => {
    let stored = [note(1, 'First mention')];
    fetchNotifications.mockImplementation(async () => ({ results: stored }));
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>);
    expect(await screen.findByText('First mention')).toBeTruthy();

    // The sidebar's channel: a second hook instance in the same tree, with its own socket.
    renderHook(() => useNotificationChannel(true, 1));
    await waitFor(() => expect(FakeWebSocket.instances.length).toBe(1));
    stored = [note(2, 'Live mention'), note(1, 'First mention')];
    await act(async () => {
      FakeWebSocket.instances[0].dispatch('message', {
        data: JSON.stringify({ type: 'notification', notification: note(2, 'Live mention') }),
      });
    });
    expect(await screen.findByText('Live mention')).toBeTruthy();
  });
});
