/**
 * Cloud Codex - Standard Page Layout
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import Login from '../components/Login';
import AccountPanel from '../components/AccountPanel';
import { showModal, getSessionTokenFromCookie, attemptAutoLogin } from '../util';

function getHeaderElement( loggedIn ) {
  return (
    <header className="app-header">
      <h1 className="app-title">Cloud Codex</h1>
      { !loggedIn && 
        <button className="c2-btn login-button" onClick={() => showModal( <Login /> )}>Login</button> 
      }
      { loggedIn &&
        <button className="c2-btn account-button" onClick={() => showModal( <AccountPanel /> )}>Account</button>
      }
    </header>
  );
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