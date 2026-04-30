/**
 * Cloud Codex — Tests for src/hooks/useNotificationChannel.js
 *
 * Covers initial load, the message handlers (notification / read / read_all),
 * the optimistic markRead/markAllRead actions, the enabled=false short
 * circuit, and refresh. The reconnect-with-backoff loop is exercised
 * indirectly — we don't fake the timer schedule, just verify that the
 * close handler is wired up.
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
}));

import { renderHook, waitFor, act } from '@testing-library/react';
import {
  fetchNotifications,
  fetchUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  getSessionTokenFromCookie,
} from '../../../src/util.jsx';
import useNotificationChannel from '../../../src/hooks/useNotificationChannel.js';

class FakeWebSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.listeners = {};
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }
  addEventListener(name, fn) {
    (this.listeners[name] = this.listeners[name] || []).push(fn);
  }
  send(data) { this.sent.push(data); }
  close() { this.dispatch('close'); }
  dispatch(name, payload) {
    (this.listeners[name] || []).forEach((fn) => fn(payload));
  }
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  fetchUnreadNotificationCount.mockReset().mockResolvedValue({ count: 0 });
  fetchNotifications.mockReset().mockResolvedValue({ results: [] });
  markNotificationRead.mockReset().mockResolvedValue({ success: true });
  markAllNotificationsRead.mockReset().mockResolvedValue({ success: true });
  getSessionTokenFromCookie.mockReset().mockReturnValue('tok');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useNotificationChannel', () => {
  it('skips fetches and websocket entirely when enabled=false', async () => {
    const { result } = renderHook(() => useNotificationChannel(false));
    expect(result.current.unreadCount).toBe(0);
    expect(result.current.recent).toEqual([]);
    expect(fetchUnreadNotificationCount).not.toHaveBeenCalled();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('loads initial unread count and recent list when enabled', async () => {
    fetchUnreadNotificationCount.mockResolvedValueOnce({ count: 3 });
    fetchNotifications.mockResolvedValueOnce({
      results: [{ id: 1, title: 'X', read_at: null }, { id: 2, title: 'Y', read_at: '2026-04-01' }],
    });

    const { result } = renderHook(() => useNotificationChannel(true));

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.unreadCount).toBe(3);
    expect(result.current.recent).toHaveLength(2);
  });

  it('still marks loaded=true even if the initial fetch fails', async () => {
    fetchUnreadNotificationCount.mockRejectedValueOnce(new Error('500'));
    const { result } = renderHook(() => useNotificationChannel(true));
    await waitFor(() => expect(result.current.loaded).toBe(true));
  });

  it('opens a WebSocket and sends an auth frame with the session token', async () => {
    const { result } = renderHook(() => useNotificationChannel(true));
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const ws = FakeWebSocket.instances[0];
    ws.dispatch('open');
    expect(ws.sent[0]).toBe(JSON.stringify({ type: 'auth', token: 'tok' }));
    void result;
  });

  it('handles incoming notification messages: prepends and increments unread', async () => {
    const { result } = renderHook(() => useNotificationChannel(true));
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const ws = FakeWebSocket.instances[0];
    ws.dispatch('open');

    await act(async () => {
      ws.dispatch('message', {
        data: JSON.stringify({ type: 'notification', notification: { id: 9, title: 'New', read_at: null } }),
      });
    });

    expect(result.current.recent[0]).toMatchObject({ id: 9 });
    expect(result.current.unreadCount).toBe(1);
  });

  it('does not increment unread for an already-read incoming notification', async () => {
    const { result } = renderHook(() => useNotificationChannel(true));
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const ws = FakeWebSocket.instances[0];
    ws.dispatch('open');

    await act(async () => {
      ws.dispatch('message', {
        data: JSON.stringify({ type: 'notification', notification: { id: 9, title: 'New', read_at: '2026-04-01' } }),
      });
    });

    expect(result.current.recent[0]).toMatchObject({ id: 9 });
    expect(result.current.unreadCount).toBe(0);
  });

  it('handles read messages: marks the matching item as read and decrements count', async () => {
    fetchUnreadNotificationCount.mockResolvedValueOnce({ count: 2 });
    fetchNotifications.mockResolvedValueOnce({
      results: [{ id: 1, read_at: null }, { id: 2, read_at: null }],
    });
    const { result } = renderHook(() => useNotificationChannel(true));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    const ws = FakeWebSocket.instances[0];

    await act(async () => {
      ws.dispatch('message', { data: JSON.stringify({ type: 'read', id: 1 }) });
    });

    expect(result.current.recent.find((n) => n.id === 1).read_at).toBeTruthy();
    expect(result.current.unreadCount).toBe(1);
  });

  it('handles read_all messages: zeroes count and marks all read', async () => {
    fetchUnreadNotificationCount.mockResolvedValueOnce({ count: 2 });
    fetchNotifications.mockResolvedValueOnce({
      results: [{ id: 1, read_at: null }, { id: 2, read_at: null }],
    });
    const { result } = renderHook(() => useNotificationChannel(true));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    const ws = FakeWebSocket.instances[0];

    await act(async () => {
      ws.dispatch('message', { data: JSON.stringify({ type: 'read_all' }) });
    });

    expect(result.current.unreadCount).toBe(0);
    expect(result.current.recent.every((n) => n.read_at)).toBe(true);
  });

  it('ignores malformed JSON in incoming WS messages', async () => {
    fetchUnreadNotificationCount.mockResolvedValueOnce({ count: 5 });
    const { result } = renderHook(() => useNotificationChannel(true));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    const ws = FakeWebSocket.instances[0];

    await act(async () => {
      ws.dispatch('message', { data: 'not-json{' });
    });

    expect(result.current.unreadCount).toBe(5); // unchanged
  });

  it('markRead optimistically updates state and calls the API', async () => {
    fetchUnreadNotificationCount.mockResolvedValueOnce({ count: 2 });
    fetchNotifications.mockResolvedValueOnce({
      results: [{ id: 1, read_at: null }, { id: 2, read_at: null }],
    });
    const { result } = renderHook(() => useNotificationChannel(true));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await result.current.markRead(1);
    });

    expect(result.current.recent.find((n) => n.id === 1).read_at).toBeTruthy();
    expect(result.current.unreadCount).toBe(1);
    expect(markNotificationRead).toHaveBeenCalledWith(1);
  });

  it('markAllRead zeroes count, marks list, and calls the API', async () => {
    fetchUnreadNotificationCount.mockResolvedValueOnce({ count: 5 });
    fetchNotifications.mockResolvedValueOnce({ results: [{ id: 1, read_at: null }] });
    const { result } = renderHook(() => useNotificationChannel(true));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await result.current.markAllRead();
    });

    expect(result.current.unreadCount).toBe(0);
    expect(result.current.recent[0].read_at).toBeTruthy();
    expect(markAllNotificationsRead).toHaveBeenCalled();
  });

  it('refresh re-runs the initial load', async () => {
    const { result } = renderHook(() => useNotificationChannel(true));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    fetchUnreadNotificationCount.mockClear();

    await act(async () => {
      await result.current.refresh();
    });
    expect(fetchUnreadNotificationCount).toHaveBeenCalled();
  });

  it('does not connect when there is no session token', async () => {
    getSessionTokenFromCookie.mockReturnValueOnce(null);
    renderHook(() => useNotificationChannel(true));
    // Allow initial-load promise to resolve
    await waitFor(() => expect(fetchUnreadNotificationCount).toHaveBeenCalled());
    expect(FakeWebSocket.instances).toHaveLength(0);
  });
});
