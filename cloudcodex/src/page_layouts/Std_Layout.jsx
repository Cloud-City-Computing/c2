/**
 * Cloud Codex - Standard Page Layout
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useEffect, useState } from "react";
import Login from '../components/Login';
import AccountPanel from '../components/AccountPanel';
import { showModal, getSessionTokenFromCookie, attemptAutoLogin, showDropdownMenu } from '../util';

/**
 * Generates an account icon SVG element for use in the header when a user is logged in.
 * @returns { JSX.Element } - The SVG element representing the account icon
 */
function getAccountIconSVG() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="feather feather-user">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
      <circle cx="12" cy="7" r="4"></circle>
    </svg>
  );
}

/**
 * Creates the header element for the application, which includes the title and user account controls.
 * If a user is logged in, it shows an account icon that opens a dropdown menu with account options.
 * If no user is logged in, it shows a login button that opens the login modal.
 * @param { JSON } user - The current logged-in user object, or null if no user is logged in
 * @returns { JSX.Element } - The header element JSX
 */
function getHeaderElement( user ) {
  return (
    <header className="app-header">
      <h1 className="app-title">Cloud Codex</h1>
      { !user && 
        <button className="c2-btn login-button" onClick={() => showModal( <Login /> )}>Login</button> 
      }
      { user &&
        <span className="account-button" onClick={() => showDropdownMenu( <AccountPanel { ...user }/> )} role="img" aria-label="account">
          { getAccountIconSVG() }
        </span>
      }
    </header>
  );
}

/**
 * Defines the standard layout for the application, which includes a header and a main content area.
 * The header displays the application title and user account controls based on the login state.
 * The main content area renders the child components passed to this layout.
 * @param { JSX.Element } children - The child components to be rendered within the main content area of the layout
 * @returns { JSX.Element } - The complete layout JSX element
 */
function StdLayout( { children } ) {
  const [ user, setUser ] = useState( null );
  useEffect( () => {
    const loadData = async () => {
      const sessionToken = getSessionTokenFromCookie();
      if ( sessionToken && sessionToken !== "" ) {
        const loggedInUser = await attemptAutoLogin( sessionToken );
        setUser( loggedInUser );
      }
    };
    loadData();
  }, [] );
  return (
    <>
      <div className="app-shell">
        {/* Top Header */}
        { getHeaderElement( user ) }
        {/* Main Page Content */}
        <main className="main-page-content">
          { children }
        </main>
      </div>
    </>
  );
}

export default StdLayout;