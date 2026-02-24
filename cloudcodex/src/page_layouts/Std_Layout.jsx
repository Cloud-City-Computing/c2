/**
 * Cloud Codex - Standard Page Layout
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useEffect, useState } from "react";
import Login from '../components/Login';
import AccountPanel from '../components/AccountPanel';
import { GetElById, showModal, getSessionTokenFromCookie, attemptAutoLogin, showDropdownMenu, clearInner, standardRedirect } from '../util';
import transparent_logo from '../assets/ccc_brand/ccc_transparent.png';

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
      <h1 className="app-title" onClick={() => standardRedirect( "/" )}>Cloud Codex</h1>
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

function clearPageMargins() {
  clearInner( GetElById( 'std-left' ) );
  clearInner( GetElById( 'std-right' ) );
}

/**
 * Displays a welcome message prompting the user to log in.
 * @returns { JSX.Element } - The welcome message JSX
 */
function noLoginMessage() {
  clearPageMargins(); // Ensure margins are cleared when showing the no-login message
  return (
    <div className="welcome-message">
      <div className="logo-container">
        <img src={ transparent_logo } alt="Cloud City Computing Logo" className="ccc-logo" />
      </div>
    </div>
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
  const [authChecked, setAuthChecked] = useState(false);
  useEffect( () => {
    const loadData = async () => {
      clearInner( GetElById( 'std-left' ) );
      clearInner( GetElById( 'std-right' ) );
      const sessionToken = getSessionTokenFromCookie();
      if (sessionToken && sessionToken !== "") {
        const loggedInUser = await attemptAutoLogin(sessionToken);
        setUser(loggedInUser ?? false);
      }
      else {
        setUser(false);
        if (window.location.pathname !== "/") {
          standardRedirect("/");
        }
      }
      setAuthChecked(true);
    };
    loadData();
  }, [] );
  return (
    <>
      <div className="app-shell">
        { getHeaderElement( user ) }
        <main className="main-page-content">
          <div className="page-margin" id="std-left"></div>
          <main className="page-container" id="searchPageContainer">
            {!authChecked && null}
            {authChecked && user && children}
            {authChecked && !user && noLoginMessage(user)}
          </main>
          <div className="page-margin" id="std-right"></div>
        </main>
      </div>
    </>
  );
}

export default StdLayout;