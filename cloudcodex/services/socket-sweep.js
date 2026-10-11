/**
 * The periodic re-check of open WebSocket sessions: a session that has ended closes its sockets
 *
 * A socket authenticates on its first message and is trusted from then on, so a session ended later (a
 * deactivation, or a row deleted by hand) would keep its socket. Every minute the sweep collects the session
 * digests the open sockets carry, asks the database which still hold a live session for an active user (and,
 * on a hosted instance, an OIDC session), and closes the rest with 4004. The lookup is batched, and a failed
 * sweep is logged and the timer keeps running.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { c2_query } from '../mysql_connect.js';
import { localSignInEnabled } from './auth-providers.js';

/** How often the sweep runs. */
export const SWEEP_INTERVAL_MS = 60_000;

/** Digests per statement, so the placeholder list stays bounded however many sockets are open. */
const CHUNK = 500;

/**
 * The subset of `digests` that still belongs to a live session of an active user. On a hosted instance only
 * OIDC sessions count, matching validateAndAutoLogin.
 * @param {Iterable<string>} digests
 * @param {{ chunkSize?: number }} [options]
 * @returns {Promise<Set<string>>}
 */
export async function liveSessionDigests(digests, { chunkSize = CHUNK } = {}) {
  const all = [...new Set(digests)];
  const live = new Set();
  const hostedClause = localSignInEnabled() ? '' : " AND s.auth_provider = 'oidc'";
  for (let i = 0; i < all.length; i += chunkSize) {
    const chunk = all.slice(i, i + chunkSize);
    const rows = await c2_query(
      `SELECT s.id FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id IN (${chunk.map(() => '?').join(',')})
          AND s.expires_at > NOW() AND u.deactivated_at IS NULL${hostedClause}`,
      chunk
    );
    for (const row of rows) live.add(row.id);
  }
  return live;
}

/**
 * One pass: close every open socket whose session is no longer live.
 * @param {{ openDigests: () => Set<string>, closeSessions: (digests: Set<string>) => number,
 *           live?: (digests: Set<string>) => Promise<Set<string>> }} deps
 * @returns {Promise<number>} how many sockets were closed
 */
export async function sweepSocketSessions({ openDigests, closeSessions, live = liveSessionDigests }) {
  const open = openDigests();
  if (open.size === 0) return 0;
  const alive = await live(open);
  const stale = new Set([...open].filter((digest) => !alive.has(digest)));
  if (stale.size === 0) return 0;
  return closeSessions(stale);
}

/**
 * Runs `sweep` on every interval. A failure is logged, never thrown out of the timer.
 * @param {{ sweep: () => Promise<unknown>, intervalMs?: number }} options
 * @returns {() => void} stops the sweep
 */
export function startSocketSweep({ sweep, intervalMs = SWEEP_INTERVAL_MS }) {
  const timer = setInterval(async () => {
    try {
      await sweep();
    } catch (err) {
      console.error(`[${new Date().toISOString()}] socket session sweep failed:`, err);
    }
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
