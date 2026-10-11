/**
 * Cloud Codex - Account Panel Component
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { removeSessStorage, apiFetch, clearSessionCookie } from '../util';

/** How long a sign-out waits for the server's answer before it goes on without the issuer's URL. */
const SIGN_OUT_WAIT_MS = 5000;

/**
 * Only an http or https URL is ever navigated to. The server builds the end-session URL, so this is
 * the second guard, not the only one.
 * @param {unknown} value
 * @returns {boolean}
 */
function isHttpUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Signs out here first, then, for an OIDC session, sends the browser on to the issuer's end-session
 * URL so the issuer ends its own session (W6-CDX-6). The request is started before the cookie is
 * cleared, so it already carries the session token; the local teardown never waits on the network.
 * A failed or slow request still ends locally and lands on /.
 */
async function performLogout() {
  const request = apiFetch('POST', '/api/logout', {}).catch(() => null);
  removeSessStorage('currentUser');
  clearSessionCookie();

  let timer;
  const bound = new Promise((resolve) => { timer = setTimeout(() => resolve(null), SIGN_OUT_WAIT_MS); });
  const answer = await Promise.race([request, bound]);
  clearTimeout(timer);

  const endSessionUrl = answer?.endSessionUrl;
  window.location.href = isHttpUrl(endSessionUrl) ? endSessionUrl : '/';
}

function AccountPanel({ name, email }) {
  return (
    <div className="dropdown-menu">
      <p className="text-center"><strong>{name}</strong> ({email})</p>
      <hr />
      <div className="button-group">
        <button className="btn btn-ghost stretched-button" onClick={() => { window.location.href = '/account'; }}>Account Settings</button>
        <button className="btn btn-ghost stretched-button" onClick={performLogout}>Logout</button>
      </div>
    </div>
  );
}

export default AccountPanel;