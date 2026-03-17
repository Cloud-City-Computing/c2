/**
 * Cloud Codex - Standard Page Layout
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useEffect, useState, useCallback } from 'react';
import Login from '../components/Login';
import AccountPanel from '../components/AccountPanel';
import {
  showModal,
  getSessionTokenFromCookie,
  attemptAutoLogin,
  showDropdownMenu,
  standardRedirect,
} from '../util';
import transparent_logo from '../assets/ccc_brand/ccc_transparent.png';

// --- Sub-components ---

function AccountIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24" height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="feather feather-user"
      aria-hidden="true"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function AppHeader({ user }) {
  return (
    <header className="app-header">
      <h1 className="app-title" onClick={() => standardRedirect('/')}>
        Cloud Codex
      </h1>
      {!user ? (
        <button
          className="c2-btn login-button"
          onClick={() => showModal(<Login />, 'modal-md')}
        >
          Login
        </button>
      ) : (
        <span
          className="account-button"
          onClick={() => showDropdownMenu(<AccountPanel {...user} />)}
          role="button"
          aria-label="Account menu"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && showDropdownMenu(<AccountPanel {...user} />)}
        >
          <AccountIcon />
        </span>
      )}
    </header>
  );
}

function NoLoginMessage() {
  return (
    <div className="welcome-message">
      <div className="logo-container">
        <img src={transparent_logo} alt="Cloud City Computing Logo" className="ccc-logo" />
      </div>
    </div>
  );
}

// --- Layout ---

function StdLayout({ children, leftMargin }) {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  const checkAuth = useCallback(async () => {
    const token = getSessionTokenFromCookie();

    if (token) {
      const loggedInUser = await attemptAutoLogin(token);
      setUser(loggedInUser ?? false);
    } else {
      setUser(false);
      // Redirect unauthenticated users away from protected pages
      if (window.location.pathname !== '/') standardRedirect('/');
    }

    setAuthChecked(true);
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  return (
    <div className="app-shell">
      <AppHeader user={user} />
      <main className="main-page-content">
        <div className="page-margin" id="std-left">
          {leftMargin && (
            <div className="account-menu-container">
              {leftMargin}
            </div>
          )}
        </div>
        <div className="page-container" id="searchPageContainer">
          {authChecked && (user ? children : <NoLoginMessage />)}
        </div>
        <div className="page-margin" id="std-right" />
      </main>
    </div>
  );
}

export default StdLayout;