/**
 * Cloud Codex - Standard Page Layout
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import Login from '../components/Login';
import { showModal, getSessionTokenFromCookie, attemptAutoLogin } from '../util';

function getHeaderElement( loggedIn ) {
  if ( !loggedIn ) {
    return (
        <header className="app-header">
          <h1 className="app-title">Cloud Codex</h1>
          <button className="c2-btn login-button" onClick={() => showModal( <Login /> )}>
            Login
          </button>
        </header>
    );
  }
  else {
    return (
      <header className="app-header">
        <h1 className="app-title">Cloud Codex</h1>
      </header>
    );
  }
}

function StdLayout( { children } ) {
  const sessionToken = getSessionTokenFromCookie();
  let userLoggedIn = false;
  if ( sessionToken && sessionToken !== "" ) {
    userLoggedIn = attemptAutoLogin( sessionToken );
  }
  return (
    <>
      <div className="app-shell">
        {/* Top Header */}
        { getHeaderElement( userLoggedIn ) }
        {/* Main Page Content */}
        <main className="main-page-content">
          { children }
        </main>
      </div>
    </>
  );
}

export default StdLayout;