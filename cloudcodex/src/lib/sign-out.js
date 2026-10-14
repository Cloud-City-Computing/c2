/**
 * Cloud Codex - sign-out (W6-CDX-40: moved from the account panel, which the sidebar footer replaces)
 *
 * Sign-out deletes the server's session row, then clears the session cookie through the one client helper
 * that knows both names (W6-CDX-3). For an OIDC session the server answers with the issuer's end-session URL,
 * and the browser goes on there so the issuer ends its own session (W6-CDX-6).
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { removeSessStorage, apiFetch, clearSessionCookie } from '../util.jsx';
import { clearInboxCache } from './inbox-cache.js';

/** How long a sign-out waits for the server's answer before it goes on without the issuer's URL. */
export const SIGN_OUT_WAIT_MS = 5000;

/**
 * Only an http or https URL is ever navigated to. The server builds the end-session URL, so this is
 * the second guard, not the only one.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isHttpUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Starts the request before the cookie is cleared, so it already carries the session token; the local
 * teardown never waits on the network. A failed or slow request still ends locally and lands on /?signedOut=1.
 * @returns {Promise<void>}
 */
export async function signOut() {
  const request = apiFetch('POST', '/api/logout', {}).catch(() => null);
  clearInboxCache();
  removeSessStorage('currentUser');
  clearSessionCookie();

  let timer;
  const bound = new Promise((resolve) => { timer = setTimeout(() => resolve(null), SIGN_OUT_WAIT_MS); });
  const answer = await Promise.race([request, bound]);
  clearTimeout(timer);

  const endSessionUrl = answer?.endSessionUrl;
  // /?signedOut=1 is the landing after a sign-out: the front door reads it and never bounces the visitor back in.
  window.location.href = isHttpUrl(endSessionUrl) ? endSessionUrl : '/?signedOut=1';
}
