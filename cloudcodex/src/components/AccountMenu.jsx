/**
 * Cloud Codex - Account Settings Menu Component
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useState, useEffect } from "react";
import { clearInner, createAndAppend, getSessStorage, getSessionTokenFromCookie, serverReq, GetVal, SetVal } from "../util";
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
 * Performs the account info update
 * @returns { void }
 */
async function doCustUpdate() {
  // validate password fields match
  const password = GetVal( 'password' );
  const confirmPassword = GetVal( 'confirmPassword' );
  if ( password !== confirmPassword ) {
    alert( 'Passwords do not match. Please try again.' );
    return;
  }

  // send update request to server
  const userId = getSessStorage( 'currentUser' )?.id;
  const sessToken = getSessionTokenFromCookie();
  if ( !userId || !sessToken ) {
    alert( 'User not authenticated. Please log in again.' );
    return;
  }

  const update = await serverReq( 'POST', '/api/update-account', {
    token: sessToken,
    userId: userId,
    name: GetVal( 'name' ),
    email: GetVal( 'email' ),
    password: password
  } );

  if ( update.success ) {
    alert( 'Account information updated successfully.' );
  }
  else {
    alert( 'Error updating account information: ' + update.message );
  }
}

/**
 * Definition of the AccountMenu component that provides options for updating account information,
 * changing preferences, and managing organizations.
 * @returns { JSX.Element } - The AccountMenu component JSX
 */
function AccountInfoUpdatePanel() {
  const [userObj, setContent] = useState('');

  useEffect(() => {
    const loadData = async () => {
      const userId = getSessStorage( 'currentUser' )?.id;
      const sessToken = await getSessionTokenFromCookie();
      if ( !userId || !sessToken ) {
        alert( 'User not authenticated. Please log in again.' );
        return;
      }
      else {
        const userData = await serverReq( 'POST', '/api/get-user', { token: sessToken, userId: userId } );
        if ( userData.success ) {
          setContent( JSON.stringify( userData.user ) );

          // Pre-fill form fields with current user data
          SetVal( 'name', userData?.user?.name );
          SetVal( 'email', userData?.user?.email );
        }
        else {
          alert( 'Error fetching user data: ' + userData.message );
        }
      }
    };
    loadData();
  }, [] );

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

        <div className="form-group">
          <label htmlFor="password">New Password</label>
          <input id="password" type="password" name="password" />
        </div>

        <div className="form-group">
          <label htmlFor="confirmPassword">Confirm New Password</label>
          <input id="confirmPassword" type="password" name="confirmPassword" />
        </div>

        <button type="submit" className="c2-btn stretched-button" onClick={ () => doCustUpdate() }>
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
function AccountPreferencesPanel() {
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
function ManageOrganizationsPanel() {
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
    ["Change Account Info", <AccountInfoUpdatePanel />],
    ["Change Preferences", <AccountPreferencesPanel />],
    ["Manage Organizations", <ManageOrganizationsPanel />]
  ]
  return (
    <div className="account-menu">
      <p>Account Actions</p>
      <ul>
        { panels.map( ( [ label, jsx_el ] ) => (
          <li key={ label }>
            <a onClick={ () => replaceAccountMenu( jsx_el ) } href="#">
              { label }
            </a>
          </li>
        ) ) }
      </ul>
    </div>
  );
}

export default AccountMenu;