/**
 * Cloud Codex - Standard Log Layout
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import Login from '../components/Login';
import Sidebar from '../components/Sidebar';
import ProductMark from '../components/ProductMark';
import FirstRunGate from '../components/FirstRunGate';
import {
  showModal,
  getSessionTokenFromCookie,
  attemptAutoLogin,
  fetchAdminStatus,
  validateInviteToken,
} from '../util';
import { GitHubStatusProvider } from '../hooks/useGitHubStatus';
import { useSignedOutTarget, clearOidcBounce, fetchProviders, signInFrom } from '../hooks/useSignedOutTarget';
import { onSessionEnded } from '../lib/session-ended.js';
import { hasUnsavedChanges, unsavedCopyText } from '../lib/unsaved-changes.js';
// --- No Login ---

function NoLoginMessage({ onSignIn }) {
  return (
    <div className="welcome-message">
      <div className="logo-container">
        <ProductMark className="welcome-logo" size={64} />
        <h2>Welcome to Cloud Codex</h2>
        <p>Please log in to get started.</p>
        <button type="button" className="btn btn-primary" onClick={onSignIn}>Sign in</button>
      </div>
    </div>
  );
}

// --- Session notice (a dead session with unsaved changes) ---

/**
 * Blocks the page after a dead session while an editor holds unsaved changes. The page behind it is unchanged, so
 * the content stays where it was; the notice offers a sign-in in a new tab, a copy of the text, and a re-check.
 */
function SessionNotice({ stillOut, onSignIn, onCopy, onCheck }) {
  return (
    <>
      <div className="session-notice-dimmer" aria-hidden="true" />
      <div
        className="session-notice"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="session-notice-title"
        aria-describedby="session-notice-body"
      >
        <h2 id="session-notice-title" className="session-notice__title">Your session ended.</h2>
        <p id="session-notice-body" className="session-notice__body">
          Your unsaved changes are still here. Sign in again to save them.
        </p>
        {stillOut && (
          <p role="status" className="session-notice__status">
            Still signed out. Finish signing in in the other tab, then choose &ldquo;I have signed in&rdquo;.
          </p>
        )}
        <div className="session-notice__actions">
          <button type="button" className="btn btn-primary" onClick={onSignIn} autoFocus>Sign in again</button>
          <button type="button" className="btn btn-ghost" onClick={onCopy}>Copy my changes</button>
          <button type="button" className="btn btn-ghost" onClick={onCheck}>I have signed in</button>
        </div>
      </div>
    </>
  );
}

// --- Layout ---

function StdLayout({ children }) {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const bounceToSignIn = useSignedOutTarget();
  // Whether this page last found someone signed in, read by the session-ended listener below.
  const signedInRef = useRef(false);
  // The page's session ended while an editor held unsaved changes: the notice stays, and nothing navigates.
  const [sessionNotice, setSessionNotice] = useState(false);
  const [stillOut, setStillOut] = useState(false);

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

  // A request on this page was refused because the server ended the session (lib/session-ended.js). With nothing
  // unsaved it is the cookie-less case reached late, so it takes the same front door. With unsaved changes on the
  // page the front door would navigate them away, so the notice takes over and the page stays as it is. The first
  // announcement wins: a page's parallel requests fail together.
  useEffect(() => onSessionEnded(() => {
    if (!signedInRef.current) return;
    signedInRef.current = false;
    if (hasUnsavedChanges()) {
      // Overlays of the shell (the search palette) close first, so the notice's own focus is not taken back.
      window.dispatchEvent(new Event('c2:close-overlays'));
      setSessionNotice(true);
      return;
    }
    setUser(false);
    frontDoor();
  }), [frontDoor]);

  // The landing's Sign in: the front door's rules (signInFrom). A providers answer that cannot be read opens the modal.
  const signIn = useCallback(async () => {
    const providers = await fetchProviders();
    signInFrom({
      providers,
      assign: (url) => window.location.assign(url),
      openLogin: () => showModal(<Login />, 'modal-md'),
    });
  }, []);

  // Sign in again, in a new tab: the current page there goes through the signed-out front door, and this tab keeps
  // its content.
  const signInAgain = useCallback(() => {
    window.open(`${window.location.pathname}${window.location.search}${window.location.hash}`, '_blank', 'noopener');
  }, []);

  // "I have signed in": asks the server with the cookie this tab now holds. A valid session clears the notice and
  // the autosave carries on; otherwise the notice says so.
  const checkSignInAgain = useCallback(async () => {
    const token = getSessionTokenFromCookie();
    const back = token ? await attemptAutoLogin(token) : null;
    if (!back) {
      setStillOut(true);
      return;
    }
    signedInRef.current = true;
    clearOidcBounce();
    setStillOut(false);
    setSessionNotice(false);
  }, []);

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
      userinfo_subject: 'Your sign-in provider returned details for a different account. Please try again.',
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
      {sessionNotice && (
        <SessionNotice
          stillOut={stillOut}
          onSignIn={signInAgain}
          onCopy={() => navigator.clipboard?.writeText(unsavedCopyText())}
          onCheck={checkSignInAgain}
        />
      )}
      <div className={`app-shell ${!user ? 'no-sidebar' : ''}`}>
        {user && <Sidebar user={user} isAdmin={isAdmin} />}
        <main className="main-content">
          {authChecked && (user ? <><FirstRunGate />{children}</> : <NoLoginMessage onSignIn={signIn} />)}
        </main>
      </div>
    </GitHubStatusProvider>
  );
}

export default StdLayout;