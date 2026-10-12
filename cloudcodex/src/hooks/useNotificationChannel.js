/**
 * useNotificationChannel — subscribes the user to the notification WebSocket
 * and exposes inbox state (unread count + most recent items) for the UI.
 *
 * One instance per app; mount near the top of the tree (Std_Layout) so the
 * bell badge is always live across page changes.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  fetchNotifications,
  fetchUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  getSessionTokenFromCookie,
} from '../util';
import { readInboxCache, writeInboxCache } from '../lib/inbox-cache.js';

const RECENT_LIMIT = 10;

// Page subscribers (the Notifications list) hear every inbox frame, so they reload when one arrives. A Set, not a
// callback prop, because the list lives in another part of the same layout's tree.
const frameListeners = new Set();

/** Calls `listener(type)` for each `notification`, `read` or `read_all` frame. Returns the unsubscribe. */
export function subscribeInboxFrames(listener) {
  frameListeners.add(listener);
  return () => frameListeners.delete(listener);
}

/**
 * @param {boolean} enabled   whether someone is signed in
 * @param {number} [userId]   the signed-in user, so the last inbox is shown at once on a remount (inbox-cache.js)
 */
export default function useNotificationChannel(enabled, userId) {
  const cached = readInboxCache(userId);
  const [unreadCount, setUnreadCount] = useState(() => cached?.unreadCount ?? 0);
  const [recent, setRecent] = useState(() => cached?.recent ?? []);
  const [loaded, setLoaded] = useState(() => cached !== null);
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);
  const reconnectAttempt = useRef(0);

  const loadInitial = useCallback(async () => {
    try {
      const [countRes, listRes] = await Promise.all([
        fetchUnreadNotificationCount(),
        fetchNotifications({ limit: RECENT_LIMIT }),
      ]);
      setUnreadCount(countRes?.count || 0);
      setRecent(listRes?.results || []);
      setLoaded(true);
    } catch {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    loadInitial();
  }, [enabled, loadInitial]);

  useEffect(() => {
    if (loaded) writeInboxCache(userId, { unreadCount, recent });
  }, [loaded, userId, unreadCount, recent]);

  // The server's count is the truth after a read, so a read frame asks for it rather than subtracting. A local
  // subtraction plus the echo of the same read counted it twice.
  const refreshCount = useCallback(async () => {
    try {
      const countRes = await fetchUnreadNotificationCount();
      setUnreadCount(countRes?.count || 0);
    } catch {
      // The next frame or reconnect corrects it.
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    let disposed = false;
    let isReconnect = false;

    function connect() {
      const token = getSessionTokenFromCookie();
      if (!token) return;

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${window.location.host}/notifications-ws`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({ type: 'auth', token }));
        reconnectAttempt.current = 0;
        // On reconnect (not first connect), refetch — notifications that
        // arrived during the gap aren't pushed retroactively.
        if (isReconnect) {
          loadInitial();
        }
        isReconnect = true;
      });

      ws.addEventListener('message', (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }

        if (msg.type === 'notification' && msg.notification) {
          setRecent((prev) => {
            const next = [msg.notification, ...prev.filter((n) => n.id !== msg.notification.id)];
            return next.slice(0, RECENT_LIMIT);
          });
          if (!msg.notification.read_at) {
            setUnreadCount((c) => c + 1);
          }
        } else if (msg.type === 'read' && typeof msg.id === 'number') {
          setRecent((prev) => prev.map((n) =>
            n.id === msg.id ? { ...n, read_at: n.read_at || new Date().toISOString() } : n,
          ));
          refreshCount();
        } else if (msg.type === 'read_all') {
          setRecent((prev) => prev.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
          setUnreadCount(0);
        } else {
          return;
        }
        for (const listener of frameListeners) listener(msg.type);
      });

      ws.addEventListener('close', () => {
        if (disposed) return;
        const delay = Math.min(30000, 1000 * 2 ** Math.min(reconnectAttempt.current, 5));
        reconnectAttempt.current += 1;
        reconnectTimer.current = setTimeout(connect, delay);
      });

      ws.addEventListener('error', () => {
        try { ws.close(); } catch { /* ignore */ }
      });
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        try { wsRef.current.close(); } catch { /* ignore */ }
      }
    };
  }, [enabled, loadInitial, refreshCount]);

  const markRead = useCallback(async (id) => {
    setRecent((prev) => prev.map((n) =>
      n.id === id ? { ...n, read_at: n.read_at || new Date().toISOString() } : n,
    ));
    try {
      await markNotificationRead(id);
    } catch {
      // The count is re-read below only on success; the next frame or reconnect corrects a missed one.
      return;
    }
    refreshCount();
  }, [refreshCount]);

  const markAllRead = useCallback(async () => {
    setRecent((prev) => prev.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
    setUnreadCount(0);
    try {
      await markAllNotificationsRead();
    } catch {
      // ignore
    }
  }, []);

  const refresh = useCallback(() => loadInitial(), [loadInitial]);

  return { unreadCount, recent, loaded, markRead, markAllRead, refresh };
}
