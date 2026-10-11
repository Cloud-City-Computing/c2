/**
 * Digests of sessions a sign-out has just closed, so a socket still authenticating cannot register on one
 *
 * A socket records its session's digest before its auth read starts, so a sign-out that runs at any
 * point finds it. A socket whose auth read was already in flight when the sign-out closed sockets
 * is refused here when the read returns. The set is short-lived and bounded: a session that is gone
 * stays gone (its row is deleted), so this only has to outlive one auth read.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

/** How long a closed digest is remembered: far longer than one auth read takes. */
const TTL_MS = 5 * 60 * 1000;
const CAPACITY = 10000;

/** digest -> the time it was closed. Insertion order is age order. */
const closed = new Map();

function prune(now) {
  for (const [digest, closedAt] of closed) {
    if (closed.size <= CAPACITY && now - closedAt <= TTL_MS) break;
    closed.delete(digest);
  }
}

/**
 * Records digests as closed by a sign-out.
 * @param {Iterable<string>} digests
 */
export function markSessionsClosed(digests) {
  const now = Date.now();
  for (const digest of digests) {
    closed.delete(digest);
    closed.set(digest, now);
  }
  prune(now);
}

/**
 * Whether a digest was closed by a sign-out within the window.
 * @param {string} digest
 * @returns {boolean}
 */
export function sessionClosedRecently(digest) {
  prune(Date.now());
  return closed.has(digest);
}

/** Test-only: forget every closed digest. */
export function resetClosedSessions() {
  closed.clear();
}
