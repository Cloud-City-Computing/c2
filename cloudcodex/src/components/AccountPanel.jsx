/**
 * Cloud Codex - Login Component
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { removeSessStorage, serverReq, getSessionTokenFromCookie } from "../util";

/**
 * Performs logout by sending a request to the server and clearing session data on the client.
 * On successful logout, it reloads the page to update the UI.
 * @returns { void }
 */
async function performLogout() {
  const response = await serverReq( 'POST', '/api/logout', { token: getSessionTokenFromCookie() } );
  if ( response.success ) {
    // Clear session storage and cookies
    removeSessStorage( 'currentUser' );
    document.cookie = 'sessionToken=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    alert( 'Logged out successfully.' );
    window.location.reload(); // Reload the page to update the UI
  }
}

/**
 * Performs Navigation to account settings
 * @returns { void }
 */
function navigateToAccountSettings() {
  window.location.href = '/account';
}

/**
 * Logout component that displays user information and a logout button in a dropdown menu.
 * @param { JSON } id - User ID
 * @param { JSON } name - User name
 * @param { JSON } email - User email
 * @returns { JSX.Element } - The AccountPanel component JSX
 */
function AccountPanel( { id, name, email } ) {
  return (
    <div className="dropdown-menu">
      <p className="text-center"><strong>{ name }</strong> ({ email })</p>
      <hr />
      <div className="button-group">
        <button className="c2-btn stretched-button" onClick={ () => navigateToAccountSettings() }>Account Settings</button>
        <button className="c2-btn stretched-button" onClick={ () => performLogout() }>Logout</button>
      </div>
    </div>
  );
}

export default AccountPanel;