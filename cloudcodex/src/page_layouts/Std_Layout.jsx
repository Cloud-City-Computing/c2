/**
 * Cloud Codex - Standard Page Layout
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import Login from '../components/Login';
import AccountPanel from '../components/AccountPanel';
import { showModal, getSessionTokenFromCookie, attemptAutoLogin, showDropdownMenu } from '../util';

function getAccountIconSVG() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="feather feather-user">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
      <circle cx="12" cy="7" r="4"></circle>
    </svg>
  );
}

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

function StdLayout( { children } ) {
  const sessionToken = getSessionTokenFromCookie();
  let user;
  if ( sessionToken && sessionToken !== "" ) {
    user = attemptAutoLogin( sessionToken );
  }
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