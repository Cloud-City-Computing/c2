/**
 * Cloud Codex - Standard Log Layout
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Login from '../components/Login';
import SuiteCluster from '../components/SuiteCluster';
import useSuite from '../hooks/useSuite';
import AccountPanel from '../components/AccountPanel';
import SearchBox from '../components/SearchBox';
import NotificationBell from '../components/NotificationBell';
import FirstRunGate from '../components/FirstRunGate';
import {
  showModal,
  getSessionTokenFromCookie,
  attemptAutoLogin,
  showDropdownMenu,
  fetchAdminStatus,
  validateInviteToken,
} from '../util';
import useGitHubStatus, { GitHubStatusProvider } from '../hooks/useGitHubStatus';
import { useSignedOutTarget, clearOidcBounce } from '../hooks/useSignedOutTarget';
import { onSessionEnded } from '../lib/session-ended.js';
// The one sentence after a sign-out, the same as Cloud Command's (W6-CMD-22). Suite mode only.
const signedOutSentence = (suiteName) => `You're signed out of ${suiteName}.`;
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

function WorkspaceIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  );
}

function ArchiveIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ActivityIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
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

function AdminIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function GitHubNavIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
      fill="currentColor" aria-hidden="true">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
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
  { to: '/workspaces', label: 'Workspaces', Icon: WorkspaceIcon },
  { to: '/archives', label: 'Archives', Icon: ArchiveIcon },
  { to: '/activity', label: 'Activity', Icon: ActivityIcon },
  { to: '/github', label: 'GitHub', Icon: GitHubNavIcon },
  { to: '/account', label: 'Account', Icon: AccountIcon },
];

const ADMIN_NAV_ITEM = { to: '/admin', label: 'Admin', Icon: AdminIcon };

function Sidebar({ collapsed, onToggle, isAdmin }) {
  const location = useLocation();
  const { connected: githubConnected } = useGitHubStatus();
  const base = githubConnected === false ? NAV_ITEMS.filter(i => i.to !== '/github') : NAV_ITEMS;
  const items = isAdmin ? [...base, ADMIN_NAV_ITEM] : base;

  return (
    <aside className="sidebar">
      <button className="sidebar__toggle" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
        {collapsed ? <ExpandIcon /> : <CollapseIcon />}
      </button>
      <nav className="sidebar__nav">
        {items.map(({ to, label, Icon }) => (
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

const SUITE_OFF = { enabled: false, name: null, commandWorkspaceUrl: null };

export function TopBar({ user, suite = SUITE_OFF }) {
  // The suite cluster takes the brand slot only for a signed-in user in suite mode: the Cloud
  // Command link it offers comes from a session-only request. Otherwise the slot is unchanged.
  const showCluster = Boolean(user && suite.enabled && suite.commandWorkspaceUrl);
  return (
    <header className="topbar">
      <div className="topbar__left">
        {showCluster ? (
          <SuiteCluster suiteName={suite.name} commandWorkspaceUrl={suite.commandWorkspaceUrl} />
        ) : (
          <Link to="/" className="topbar__brand">
            <img src={transparent_logo} alt="Cloud City Computing" className="topbar__brand-logo" />
            <span className="topbar__brand-title">Cloud Codex</span>
          </Link>
        )}
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
          <>
            <NotificationBell enabled={Boolean(user)} />
            <button
              className="account-button"
              onClick={() => showDropdownMenu(<AccountPanel {...user} />)}
              aria-label="Account menu"
            >
              {user.avatar_url ? (
                <img src={user.avatar_url} alt={user.name} className="account-button__avatar" />
              ) : (
                <AccountIcon />
              )}
            </button>
          </>
        )}
      </div>
    </header>
  );
}

// --- Mobile Bottom Navigation ---

function MobileNav({ isAdmin }) {
  const location = useLocation();
  const { connected: githubConnected } = useGitHubStatus();
  const base = githubConnected === false ? NAV_ITEMS.filter(i => i.to !== '/github') : NAV_ITEMS;
  const items = isAdmin ? [...base, ADMIN_NAV_ITEM] : base;

  return (
    <nav className="mobile-nav" aria-label="Mobile navigation">
      {items.map(({ to, label, Icon }) => (
        <Link
          key={to}
          to={to}
          className={`mobile-nav__item${
            location.pathname === to ||
            (to !== '/' && location.pathname.startsWith(to))
              ? ' active' : ''
          }`}
        >
          <Icon />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}

// --- No Login ---

function NoLoginMessage({ suiteName, signedOut }) {
  return (
    <div className="welcome-message">
      <div className="logo-container">
        <img src={transparent_logo} alt="Cloud City Computing Logo" className="welcome-logo" />
        <h2>Welcome to Cloud Codex</h2>
        {signedOut && suiteName && <p className="signed-out-sentence">{signedOutSentence(suiteName)}</p>}
        <p>Please log in to get started.</p>
      </div>
    </div>
  );
}

// --- Layout ---

function StdLayout({ children }) {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const suite = useSuite(user);
  // Read once, before anything strips it: the landing after a sign-out says so in suite mode (W6-CDX-26).
  const [signedOut] = useState(() => new URLSearchParams(window.location.search).get('signedOut') === '1');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      const prefs = JSON.parse(localStorage.getItem('c2-user-prefs'));
      return prefs?.sidebarDefault === 'collapsed';
    } catch { return false; }
  });

  const bounceToSignIn = useSignedOutTarget();
  // Whether this page last found someone signed in, read by the session-ended listener below.
  const signedInRef = useRef(false);

  // The signed-out front door (hooks/useSignedOutTarget.js): a deep link goes to the sign-in once per tab where OIDC
  // is the sign-in, and where local sign-in is offered the link is kept and the Login modal opens.
  const frontDoor = useCallback(async () => {
    const outcome = await bounceToSignIn();
    if (outcome === 'login') showModal(<Login />, 'modal-md');
  }, [bounceToSignIn]);

  const checkAuth = useCallback(async () => {
    const token = getSessionTokenFromCookie();
    let loggedInUser = null;

    if (token) {
      loggedInUser = await attemptAutoLogin(token);
      signedInRef.current = Boolean(loggedInUser);
      setUser(loggedInUser ?? false);

      // Check admin status if logged in
      if (loggedInUser) {
        // A sign-in ends the deep-link bounce for this tab (hooks/useSignedOutTarget.js).
        clearOidcBounce();
        try {
          const adminRes = await fetchAdminStatus();
          setIsAdmin(adminRes.isAdmin === true);
        } catch { /* ignore */ }
      }
    } else {
      setUser(false);
    }

    // Signed out, with no cookie or with one the server no longer accepts. A deep link goes to the sign-in
    // once per tab where OIDC is the sign-in (hooks/useSignedOutTarget.js). Where no OIDC is offered, the
    // link is kept and the Login modal opens; a successful sign-in then returns to it.
    if (!loggedInUser) await frontDoor();

    setAuthChecked(true);
  }, [frontDoor]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // A request on this page was refused because the server ended the session (lib/session-ended.js). That is the
  // cookie-less case reached late, so it takes the same front door. The first announcement wins: a page's parallel
  // requests fail together, and one front door is enough.
  useEffect(() => onSessionEnded(() => {
    if (!signedInRef.current) return;
    signedInRef.current = false;
    setUser(false);
    frontDoor();
  }), [frontDoor]);

  // Handle invitation tokens from URL
  useEffect(() => {
    if (user !== false || !authChecked) return;
    const params = new URLSearchParams(window.location.search);
    const inviteParam = params.get('invite');
    if (!inviteParam) return;

    validateInviteToken(inviteParam)
      .then(res => {
        if (res.valid) {
          showModal(<Login inviteToken={inviteParam} inviteEmail={res.email} />, 'modal-md');
        }
      })
      .catch(() => {});
  }, [user, authChecked]);

  // Handle OAuth errors from redirect
  useEffect(() => {
    if (!authChecked) return;
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get('oauth_error');
    if (!oauthError) return;
    // The OIDC callback names its provider, so its refusal copy says "sign-in", not "Google".
    const fromOidc = params.get('oauth_provider') === 'oidc';

    // Clean the URL
    const url = new URL(window.location);
    url.searchParams.delete('oauth_error');
    url.searchParams.delete('oauth_provider');
    window.history.replaceState({}, '', url.pathname + url.search);

    const oidcMessages = {
      email_not_verified: 'Your email address is not verified with your sign-in provider.',
      no_account: 'No account found for this sign-in. Ask your administrator for an invitation.',
      email_conflict: 'That email address already belongs to another account here. Ask your administrator.',
      identity_conflict: 'This account is already linked to a different sign-in identity. Ask your administrator to relink it.',
      two_factor_enabled: 'This account has two-factor authentication on, so it cannot be linked to single sign-on by email. Sign in with your password and code instead.',
      flow_expired: 'Sign-in session expired. Please try again.',
      account_deactivated: 'This account has been deactivated. Ask your administrator.',
    };

    const messages = {
      domain_not_allowed: 'Your Google account domain is not allowed. Contact your administrator.',
      no_account: 'No account found for this Google email. Ask your administrator for an invitation.',
      email_not_verified: 'Your Google email is not verified.',
      identity_conflict: 'This email is already linked to a different Google account. Ask your administrator to relink it.',
      two_factor_enabled: 'This account has two-factor authentication on, so it cannot be linked to Google by email. Sign in with your password and code instead.',
      account_deactivated: 'This account has been deactivated. Ask your administrator.',
      token_exchange_failed: 'Google sign-in failed. Please try again.',
      token_verification_failed: 'Google sign-in verification failed. Please try again.',
      invalid_state: 'Sign-in session expired. Please try again.',
      access_denied: 'Google sign-in was cancelled.',
    };

    const message = fromOidc
      ? oidcMessages[oauthError] || 'Sign-in failed. Please try again.'
      : messages[oauthError] || 'Google sign-in failed. Please try again.';
    showModal(<Login />, 'modal-md');
    // Brief delay so the modal mounts before we could show a message
    setTimeout(() => {
      const errEl = document.querySelector('.modal-content .form-error');
      if (!errEl) {
        const form = document.querySelector('.modal-form');
        if (form) {
          const p = document.createElement('p');
          p.className = 'form-error';
          p.textContent = message;
          form.parentElement.insertBefore(p, form);
        }
      }
    }, 100);
  }, [authChecked]);

  // GitHub status is asked only once the auth check has found a user: the
  // route is behind requireAuth, so asking for anyone else is a 401.
  return (
    <GitHubStatusProvider enabled={Boolean(user)}>
      <div className={`app-shell ${user && sidebarCollapsed ? 'sidebar-collapsed' : ''} ${!user ? 'no-sidebar' : ''}`}>
        <TopBar user={user} suite={suite} />
        {user && (
          <Sidebar
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed(c => !c)}
            isAdmin={isAdmin}
          />
        )}
        <main className="main-content">
          {authChecked && (user ? <><FirstRunGate />{children}</> : <NoLoginMessage suiteName={suite.enabled ? suite.name : null} signedOut={signedOut} />)}
        </main>
        {user && <MobileNav isAdmin={isAdmin} />}
        <footer className="log-footer">
          <p>&copy; {new Date().getFullYear()} <a href="https://cloudcitycomputing.com/" target="_blank" rel="noopener noreferrer">Cloud City Computing, LLC</a>. All rights reserved.</p>
        </footer>
      </div>
    </GitHubStatusProvider>
  );
}

export default StdLayout;