/**
 * Cloud Codex - Account Panel Component
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { removeSessStorage, apiFetch, clearSessionCookie } from '../util';

async function performLogout() {
  try {
    await apiFetch('POST', '/api/logout', {});
  } catch { /* best-effort */ }
  removeSessStorage('currentUser');
  clearSessionCookie();
  window.location.href = '/';
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