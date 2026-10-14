/**
 * usePresence — React hook for polling global document presence.
 *
 * Returns a Map of logId → [{ id, name, color }] for all documents
 * that currently have active users connected via WebSocket.
 *
 * Polls the /api/presence endpoint at a configurable interval.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchPresence } from '../util';
import { oneEntryPerUser } from '../lib/presence-users.js';

const DEFAULT_POLL_INTERVAL = 8000; // 8 seconds


/**
 * @param {number} [interval] — Polling interval in ms (default 8000)
 * @returns {{ presence: Object, getLogUsers: (logId: number|string) => Array }}
 */
export default function usePresence(interval = DEFAULT_POLL_INTERVAL) {
  const [presence, setPresence] = useState({});
  const timerRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchPresence();
      if (res.success) {
        setPresence(Object.fromEntries(
          // The avatar takes the colour of the first connection listed; a second tab's cursor may differ.
          Object.entries(res.presence || {}).map(([logId, users]) => [logId, oneEntryPerUser(users)]),
        ));
      }
    } catch {
      // Silent — presence is best-effort
    }
  }, []);

  useEffect(() => {
    load(); // Immediate first load
    timerRef.current = setInterval(load, interval);
    return () => clearInterval(timerRef.current);
  }, [load, interval]);

  /**
   * Get active users for a specific log.
   * @param {number|string} logId
   * @returns {Array<{ id: number, name: string, color: string }>}
   */
  const getLogUsers = useCallback((logId) => {
    return presence[String(logId)] || [];
  }, [presence]);

  return { presence, getLogUsers };
}
