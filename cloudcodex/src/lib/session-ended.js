/**
 * Cloud Codex - The "session ended" signal from any request to the layout
 *
 * apiFetch sees a 401 "Invalid or expired session" on a request that carried a session cookie: the server has
 * ended that session (a sign-out in the other product, a back-channel logout), so this tab's cached user is
 * stale. It announces that once per refusal on this window, and the standard layout, which owns the signed-out
 * front door, answers it the same way it answers a cookie-less visit. A window event rather than a direct call
 * keeps apiFetch free of the layout, and needs no import cycle.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

export const SESSION_ENDED_EVENT = 'c2:session-ended';

/** The server's message for a request whose session row is gone or expired (middleware/auth.js). */
export const DEAD_SESSION_MESSAGE = 'Invalid or expired session';

/** Tells the layout that this tab's session has ended on the server. */
export function announceSessionEnded() {
  window.dispatchEvent(new Event(SESSION_ENDED_EVENT));
}

/**
 * Calls handler on each announcement while subscribed.
 * @param {() => void} handler
 * @returns {() => void} unsubscribe
 */
export function onSessionEnded(handler) {
  window.addEventListener(SESSION_ENDED_EVENT, handler);
  return () => window.removeEventListener(SESSION_ENDED_EVENT, handler);
}
