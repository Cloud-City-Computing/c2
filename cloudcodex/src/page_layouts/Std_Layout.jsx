/**
 * Cloud Codex - Standard Page Layout
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useEffect, useState, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Login from '../components/Login';
import AccountPanel from '../components/AccountPanel';
import SearchBox from '../components/SearchBox';
import {
  showModal,
  getSessionTokenFromCookie,
  attemptAutoLogin,
  showDropdownMenu,
  standardRedirect,
} from '../util';
import transparent_logo from '../assets/ccc_brand/ccc_transparent.png';

// --- Icons ---

function AccountIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function OrgIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  );
}

function ProjectIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

// --- Sidebar ---

const NAV_ITEMS = [
  { to: '/', label: 'Home', Icon: HomeIcon },
  { to: '/organizations', label: 'Organizations', Icon: OrgIcon },
  { to: '/projects', label: 'Projects', Icon: ProjectIcon },
  { to: '/account', label: 'Account', Icon: AccountIcon },
];

function Sidebar({ collapsed, onToggle }) {
  const location = useLocation();

  return (
    <aside className="sidebar">
      <button className="sidebar__toggle" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
        {collapsed ? <ExpandIcon /> : <CollapseIcon />}
      </button>
      <nav className="sidebar__nav">
        {NAV_ITEMS.map(({ to, label, Icon }) => (
          <Link
            key={to}
            to={to}
            className={`sidebar__link ${location.pathname === to ? 'active' : ''}`}
            title={label}
          >
            <Icon />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}

// --- Top Bar ---

function TopBar({ user }) {
  return (
    <header className="topbar">
      <div className="topbar__left">
        <Link to="/" className="topbar__brand">
          <img src={transparent_logo} alt="Cloud City Computing" className="topbar__brand-logo" />
          <span className="topbar__brand-title">Cloud Codex</span>
        </Link>
      </div>
      <div className="topbar__center">
        {user && <SearchBox inline />}
      </div>
      <div className="topbar__right">
        {!user ? (
          <button className="btn btn-primary" onClick={() => showModal(<Login />, 'modal-md')}>
            Login
          </button>
        ) : (
          <button
            className="account-button"
            onClick={() => showDropdownMenu(<AccountPanel {...user} />)}
            aria-label="Account menu"
          >
            <AccountIcon />
          </button>
        )}
      </div>
    </header>
  );
}

// --- No Login ---

function NoLoginMessage() {
  return (
    <div className="welcome-message">
      <div className="logo-container">
        <img src={transparent_logo} alt="Cloud City Computing Logo" className="welcome-logo" />
        <h2>Welcome to Cloud Codex</h2>
        <p>Please log in to get started.</p>
      </div>
    </div>
  );
}

// --- Layout ---

function StdLayout({ children }) {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      const prefs = JSON.parse(localStorage.getItem('c2-user-prefs'));
      return prefs?.sidebarDefault === 'collapsed';
    } catch { return false; }
  });

  const checkAuth = useCallback(async () => {
    const token = getSessionTokenFromCookie();

    if (token) {
      const loggedInUser = await attemptAutoLogin(token);
      setUser(loggedInUser ?? false);
    } else {
      setUser(false);
      if (window.location.pathname !== '/' && window.location.pathname !== '/404') {
        standardRedirect('/');
      }
    }

    setAuthChecked(true);
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <TopBar user={user} />
      {user && (
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(c => !c)}
        />
      )}
      <main className="main-content">
        {authChecked && (user ? children : <NoLoginMessage />)}
      </main>
      <footer className="page-footer">
        <p>&copy; {new Date().getFullYear()} <a href="https://cloudcitycomputing.com/" target="_blank" rel="noopener noreferrer">Cloud City Computing, LLC</a>. All rights reserved.</p>
      </footer>
    </div>
  );
}

export default StdLayout;