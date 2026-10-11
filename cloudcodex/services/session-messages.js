/**
 * Cloud Codex - The strings the server and the client share about a session that has ended
 *
 * Imported by the server (middleware/auth.js, services/collab.js) and by the client (src/lib/session-ended.js),
 * so the refusal the server sends is the one the client reads. Tests pin the literal values.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

/** The 401 body for a request whose session row is gone or expired (middleware/auth.js). */
export const DEAD_SESSION_MESSAGE = 'Invalid or expired session';

/** The close a collab socket gets when its session has ended (services/collab.js). */
export const SIGNED_OUT_SOCKET_CLOSE = Object.freeze({ code: 4004, reason: 'Signed out' });
