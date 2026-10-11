/**
 * The signed-out deep-link decision: bounce to the sign-in, open the Login modal, or render the landing
 *
 * A signed-out visitor who opens a deep link gets one of three outcomes. Where OIDC is offered and is the only
 * sign-in, or suite mode is on, the link sends them, once per tab, to /api/auth/oidc/start with the link as
 * returnTo; the marker in sessionStorage is the loop guard, and an oauth_error return renders the landing instead
 * of bouncing again. Where no OIDC is offered at all, the link is kept (validated) and the Login modal opens; a
 * successful local sign-in then goes to the kept target. Everything else renders the landing. The bare root bounces
 * only where OIDC is the only sign-in (hosted), by the same loop guard, and never after a sign-out (?signedOut=1
 * shows the message) or an error return. The target is
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
import { SIGN_IN_TARGET_KEY, getStorage, keepSignInTarget, takeSignInTarget, clearSignInTarget } from '../lib/sign-in-target.js';

export { SIGN_IN_TARGET_KEY, keepSignInTarget, takeSignInTarget, clearSignInTarget };

/** The sessionStorage key whose presence means this tab has already been bounced once. */
export const OIDC_BOUNCE_MARKER = 'c2-oidc-bounce';

/**
 * OIDC is the only sign-in when the providers route reports it enabled, and neither Google nor local is
 * offered. An older server that does not report local is never treated as OIDC-only.
 * @param {object|undefined} providers the `providers` object from GET /api/oauth/providers
 * @returns {boolean}
 */
export function isOidcOnly(providers) {
  return providers?.oidc?.enabled === true && providers.google !== true && providers.local === false;
}

/**
 * The path, query and fragment a signed-out visit asked for, reduced by the one validator; "/" for anything
 * refused. The fragment is part of the target, because a browser never sends it to the server.
 */
function targetOf(pathname, search, hash = '') {
  return safeReturnTo(`${pathname}${search}${hash}`);
}

/**
 * What a signed-out visit does. The 404 page never bounces and never opens the modal. The bare root bounces only
 * where OIDC is the only sign-in (hosted), so a local-sign-in instance keeps its sign-in screen.
 * @returns {{ action: 'bounce', url: string } | { action: 'login', target: string } | { action: 'landing' }}
 */
export function decideSignedOut({ pathname, search, hash = '', oidcOffered, oidcOnly, suiteOn, bounced, oauthError }) {
  if (pathname === '/404') return { action: 'landing' };
  if (pathname === '/') {
    const afterSignOut = new URLSearchParams(search).get('signedOut') === '1';
    if (!oidcOffered || !oidcOnly || bounced || oauthError || afterSignOut) return { action: 'landing' };
    return { action: 'bounce', url: `/api/auth/oidc/start?returnTo=${encodeURIComponent('/')}` };
  }
  const target = targetOf(pathname, search, hash);
  // No OIDC, or OIDC beside local login outside suite mode: the modal offers the sign-ins and keeps the link.
  if (!oidcOffered || (!oidcOnly && !suiteOn && !bounced && !oauthError)) return { action: 'login', target };
  if (bounced || oauthError) return { action: 'landing' };
  return { action: 'bounce', url: `/api/auth/oidc/start?returnTo=${encodeURIComponent(target)}` };
}

/**
 * Performs the bounce if the decision calls for one. Sets the marker before it assigns, and does nothing
 * when the marker cannot be stored, because a bounce that cannot remember itself would loop.
 * @returns {boolean} true when the browser was sent to the sign-in start
 */
export function startOidcBounce({ pathname, search, hash = '', providers, suiteOn = false, storage, assign }) {
  if (!storage) return false;
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
    hash,
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
export function resolveSignedOut({ pathname, search, hash = '', providers, suiteOn = false, storage, assign }) {
  if (startOidcBounce({ pathname, search, hash, providers, suiteOn, storage, assign })) return 'bounced';
  const oidcOffered = providers?.oidc?.enabled === true;
  const bounced = readFlag(storage, OIDC_BOUNCE_MARKER);
  const oauthError = new URLSearchParams(search).has('oauth_error');
  const decision = decideSignedOut({
    pathname,
    search,
    hash,
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

/** Whether a flag is set. Refused storage (null, or a read that throws) reads as set, so no bounce happens. */
function readFlag(storage, key) {
  if (!storage) return true;
  try {
    return storage.getItem(key) !== null;
  } catch {
    return true;
  }
}

/** Forgets the bounce, so a later signed-out visit in this tab can bounce again. */
export function clearOidcBounce(storage = getStorage()) {
  if (!storage) return;
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
 * on the signed-out path. The 404 page answers 'landing' without asking the server.
 */
export function useSignedOutTarget() {
  return useCallback(async () => {
    const { pathname, search, hash } = window.location;
    if (pathname === '/404') return 'landing';
    const [providers, suiteOn] = await Promise.all([fetchProviders(), suiteEnabled()]);
    return resolveSignedOut({
      pathname,
      search,
      hash,
      providers,
      suiteOn,
      storage: getStorage(),
      assign: (url) => window.location.assign(url),
    });
  }, []);
}
