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
 * Definition of the AccountMenu component that provides options for updating account information,
 * changing preferences, and managing organizations.
 * @returns { JSX.Element } - The AccountMenu component JSX
 */
function accountInfoUpdatePanel() {
  return (
    <div className="account-settings-panel">
      <h2 className="panel-title">Update Account Information</h2>
      <form className="account-form">
        <div className="form-group">
          <label htmlFor="name">Name</label>
          <input id="name" type="text" name="name" />
        </div>

        <div className="form-group">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" name="email" />
        </div>

        <button type="submit" className="c2-btn stretched-button">
          Update Info
        </button>
      </form>
    </div>
  );
}

/**
 * Renders the account preferences panel with options for receiving newsletters and 
 * enabling two-factor authentication.
 * @returns { JSX.Element } - The account preferences panel JSX
 */
function accountPreferencesPanel() {
  return (
    <div className="account-settings-panel">
      <h2 className="panel-title">Account Preferences</h2>
      <form className="account-form">
        <div className="checkbox-group">
          <label>
            <input type="checkbox" name="newsletter" />
            Receive Newsletter
          </label>
        </div>

        <div className="checkbox-group">
          <label>
            <input type="checkbox" name="2fa" />
            Enable Two-Factor Authentication
          </label>
        </div>

        <button type="submit" className="c2-btn stretched-button">
          Update Preferences
        </button>
      </form>
    </div>
  );
}

/**
 * Renders the manage organizations panel with a placeholder message 
 * indicating that the feature is coming soon.
 * @returns { JSX.Element } - The manage organizations panel JSX
 */
function manageOrganizationsPanel() {
  return (
    <div className="account-settings-panel">
      <h2 className="panel-title">Manage Organizations</h2>
      <p className="panel-muted">
        This feature is coming soon. Please check back later.
      </p>
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