/**
 * The signed-out deep-link decision: bounce to the sign-in, open the Login modal, or render the landing
 *
 * A signed-out visitor who opens a deep link gets one of three outcomes. Where OIDC is offered and is the only
 * sign-in, or suite mode is on, the link sends them, once per tab, to /api/auth/oidc/start with the link as
 * returnTo; the marker in sessionStorage is the loop guard, and an oauth_error return renders the landing instead
 * of bouncing again. Where no OIDC is offered at all, the link is kept (validated) and the Login modal opens; a
 * successful local sign-in then goes to the kept target. Everything else renders the landing. The target is
 * always validated by services/return-to.js, the one validator the server also uses, so there is no second
 * returnTo path on the client. The marker is cleared on a successful sign-in.
 *
 * The decision is pure (decideSignedOut) and is what the tests pin; the hook only wires it to the providers
 * and suite routes and the browser.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useCallback } from 'react';
import { safeReturnTo } from '../../services/return-to.js';
import { suiteEnabled } from './useSuite.js';

/** The sessionStorage key whose presence means this tab has already been bounced once. */
export const OIDC_BOUNCE_MARKER = 'c2-oidc-bounce';

/** The sessionStorage key holding the validated deep link a local sign-in returns to. */
export const SIGN_IN_TARGET_KEY = 'c2-sign-in-target';

/**
 * OIDC is the only sign-in when the providers route reports it enabled, and neither Google nor local is
 * offered. An older server that does not report local is never treated as OIDC-only.
 * @param {object|undefined} providers the `providers` object from GET /api/oauth/providers
 * @returns {boolean}
 */
export function isOidcOnly(providers) {
  return providers?.oidc?.enabled === true && providers.google !== true && providers.local === false;
}

/** The path and query a signed-out visit asked for, reduced by the one validator; "/" for anything refused. */
function targetOf(pathname, search) {
  return safeReturnTo(`${pathname}${search}`);
}

/**
 * What a signed-out visit does. The root and the 404 page never bounce and never open the modal.
 * @returns {{ action: 'bounce', url: string } | { action: 'login', target: string } | { action: 'landing' }}
 */
export function decideSignedOut({ pathname, search, oidcOffered, oidcOnly, suiteOn, bounced, oauthError }) {
  if (pathname === '/' || pathname === '/404') return { action: 'landing' };
  const target = targetOf(pathname, search);
  if (!oidcOffered) return { action: 'login', target };
  if (bounced || oauthError) return { action: 'landing' };
  if (!oidcOnly && !suiteOn) return { action: 'landing' };
  return { action: 'bounce', url: `/api/auth/oidc/start?returnTo=${encodeURIComponent(target)}` };
}

/**
 * Performs the bounce if the decision calls for one. Sets the marker before it assigns, and does nothing
 * when the marker cannot be stored, because a bounce that cannot remember itself would loop.
 * @returns {boolean} true when the browser was sent to the sign-in start
 */
export function startOidcBounce({ pathname, search, providers, suiteOn = false, storage, assign }) {
  let bounced;
  try {
    bounced = storage.getItem(OIDC_BOUNCE_MARKER) !== null;
  } catch {
    return false;
  }
  const oauthError = new URLSearchParams(search).has('oauth_error');
  const decision = decideSignedOut({
    pathname,
    search,
    oidcOffered: providers?.oidc?.enabled === true,
    oidcOnly: isOidcOnly(providers),
    suiteOn,
    bounced,
    oauthError,
  });
  if (decision.action !== 'bounce') return false;
  try {
    storage.setItem(OIDC_BOUNCE_MARKER, '1');
  } catch {
    return false;
  }
  assign(decision.url);
  return true;
}

/**
 * The whole signed-out decision for a page load: 'bounced' (the browser was sent to the sign-in start), 'login'
 * (no OIDC; the validated target was kept and the caller should open the Login modal), or 'landing'.
 * With no providers answer, OIDC is not known to be offered, so the Login modal is the safe outcome.
 */
export function resolveSignedOut({ pathname, search, providers, suiteOn = false, storage, assign }) {
  if (startOidcBounce({ pathname, search, providers, suiteOn, storage, assign })) return 'bounced';
  const oidcOffered = providers?.oidc?.enabled === true;
  const bounced = readFlag(storage, OIDC_BOUNCE_MARKER);
  const oauthError = new URLSearchParams(search).has('oauth_error');
  const decision = decideSignedOut({
    pathname,
    search,
    oidcOffered,
    oidcOnly: isOidcOnly(providers),
    suiteOn,
    bounced,
    oauthError,
  });
  if (decision.action === 'login') {
    keepSignInTarget(storage, decision.target);
    return 'login';
  }
  return 'landing';
}

function readFlag(storage, key) {
  try {
    return storage.getItem(key) !== null;
  } catch {
    return true;
  }
}

/** Keeps the validated target a local sign-in returns to. Storage that refuses the write keeps nothing. */
export function keepSignInTarget(storage, target) {
  try {
    storage.setItem(SIGN_IN_TARGET_KEY, safeReturnTo(target));
  } catch {
    // Without storage the sign-in reloads the page it is on, which is the same deep link.
  }
}

/**
 * The kept target, validated again, or null. Read once: a successful sign-in forgets it.
 * @returns {string|null}
 */
export function takeSignInTarget(storage = window.sessionStorage) {
  try {
    const kept = storage.getItem(SIGN_IN_TARGET_KEY);
    storage.removeItem(SIGN_IN_TARGET_KEY);
    return kept === null ? null : safeReturnTo(kept);
  } catch {
    return null;
  }
}

/** Forgets the bounce, so a later signed-out visit in this tab can bounce again. */
export function clearOidcBounce(storage = window.sessionStorage) {
  try {
    storage.removeItem(OIDC_BOUNCE_MARKER);
  } catch {
    // Storage that refuses the write also refused the marker, so there is nothing to forget.
  }
}

/** The providers object from the public providers route, or null when it cannot be read. */
async function fetchProviders() {
  try {
    const res = await fetch('/api/oauth/providers');
    const body = await res.json();
    return body?.providers ?? null;
  } catch {
    return null;
  }
}

/**
 * A stable callback that resolves 'bounced', 'login' or 'landing' for the page it runs on. Std_Layout calls it
 * on the signed-out path; the root answers 'landing' without asking the server.
 */
export function useSignedOutTarget() {
  return useCallback(async () => {
    const { pathname, search } = window.location;
    if (pathname === '/' || pathname === '/404') return 'landing';
    const [providers, suiteOn] = await Promise.all([fetchProviders(), suiteEnabled()]);
    return resolveSignedOut({
      pathname,
      search,
      providers,
      suiteOn,
      storage: window.sessionStorage,
      assign: (url) => window.location.assign(url),
    });
  }, []);
}
