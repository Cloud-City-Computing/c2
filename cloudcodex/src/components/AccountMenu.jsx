/**
 * Cloud Codex - Account Settings Menu Component
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { clearInner, createAndAppend } from "../util";
import { createRoot } from 'react-dom/client';

/**
 * Renders a new JSX element in the account menu area by clearing the existing content and 
 * appending the new element.
 * @param { JSX.Element } jsxElement - The new JSX element to render in the account menu area
 * @returns { void }
 */
function replaceAccountMenu( jsxElement ) {
  const pageContainer = document.getElementById( 'searchPageContainer' );
  if ( pageContainer ) {
    clearInner( pageContainer );
    const menuRoot = createRoot( createAndAppend( pageContainer, 'div', 'account-menu-root' ) );
    menuRoot.render( jsxElement );
  }
}

/**
 * Returns a JSX element for the account information update panel, which includes a form for updating
 * the user's name and email.
 * @returns { JSX.Element } - The account information update panel JSX
 */
function accountInfoUpdatePanel() {
  return (
    <div className="account-info-update-panel">
      <h2>Update Account Information</h2>
      <form>
        <label>
          Name:
          <input type="text" name="name" />
        </label>
        <label>
          Email:
          <input type="email" name="email" />
        </label>
        <button type="submit" className="c2-btn">Update Info</button>
      </form>
    </div>
  );
}

/**
 * Returns a JSX element for the account preferences panel
 * @returns { JSX.Element } - The account preferences panel JSX
 */
function accountPreferencesPanel() {
  return (
    <div className="account-preferences-panel">
      <h2>Account Preferences</h2>
      <form>
        <label>
          Receive Newsletter:
          <input type="checkbox" name="newsletter" />
        </label>
        <label>
          Enable Two-Factor Authentication:
          <input type="checkbox" name="2fa" />
        </label>
        <button type="submit" className="c2-btn">Update Preferences</button>
      </form>
    </div>
  );
}

/**
 * Returns a JSX element for the manage organizations panel
 * @returns { JSX.Element } - The manage organizations panel JSX
 */
function manageOrganizationsPanel() {
  return (
    <div className="manage-organizations-panel">
      <h2>Manage Organizations</h2>
      <p>This feature is coming soon. Please check back later.</p>
    </div>
  );
}

/**
 * Renders the account menu with options for updating account information, 
 * changing preferences, and managing organizations.
 * @returns { JSX.Element } - The AccountMenu component JSX
 */
function AccountMenu() {
  const panels = [
    ["Change Account Info", accountInfoUpdatePanel],
    ["Change Preferences", accountPreferencesPanel],
    ["Manage Organizations", manageOrganizationsPanel]
  ]
  return (
    <div className="account-menu">
      <p>Account Actions</p>
      <ul>
        { panels.map( ( [ label, panelFunc ] ) => (
          <li key={ label }>
            <a onClick={ () => replaceAccountMenu( panelFunc() ) } href="#">
              { label }
            </a>
          </li>
        ) ) }
      </ul>
    </div>
  );
}

export default AccountMenu;