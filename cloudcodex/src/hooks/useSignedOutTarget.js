/**
 * The deep-link bounce for a signed-out visitor on an OIDC-only instance
 *
 * A signed-out visitor who opens a deep link on an instance where OIDC is the only sign-in is sent, once per
 * tab, to /api/auth/oidc/start with the link as returnTo, so the link opens after sign-in. The marker in
 * sessionStorage is the loop guard, and an oauth_error return renders the landing instead of bouncing again.
 * The marker is cleared on a successful sign-in. The decision is pure (decideSignedOut) and is what the tests
 * pin; the hook only wires it to the providers route and the browser.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useCallback } from 'react';

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
 * What a signed-out visit does. The root and the 404 page never bounce.
 * @returns {{ action: 'bounce', url: string } | { action: 'landing' }}
 */
export function decideSignedOut({ pathname, search, oidcOnly, bounced, oauthError }) {
  if (pathname === '/' || pathname === '/404') return { action: 'landing' };
  if (!oidcOnly || bounced || oauthError) return { action: 'landing' };
  const target = `${pathname}${search}`;
  return { action: 'bounce', url: `/api/auth/oidc/start?returnTo=${encodeURIComponent(target)}` };
}

/**
 * Performs the bounce if the decision calls for one. Sets the marker before it assigns, and does nothing
 * when the marker cannot be stored, because a bounce that cannot remember itself would loop.
 * @returns {Promise<boolean>} true when the browser was sent to the sign-in start
 */
export async function startOidcBounce({ pathname, search, providers, storage, assign }) {
  let bounced;
  try {
    bounced = storage.getItem(OIDC_BOUNCE_MARKER) !== null;
  } catch {
    return false;
  }
  const oauthError = new URLSearchParams(search).has('oauth_error');
  const decision = decideSignedOut({ pathname, search, oidcOnly: isOidcOnly(providers), bounced, oauthError });
  if (decision.action !== 'bounce') return false;
  try {
    storage.setItem(OIDC_BOUNCE_MARKER, '1');
  } catch {
    return false;
  }
  assign(decision.url);
  return true;
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
 * A stable callback that resolves true when it has sent the browser to the sign-in start. Std_Layout calls
 * it on the signed-out path before it would redirect to the root.
 */
export function useSignedOutTarget() {
  return useCallback(async () => {
    const { pathname, search } = window.location;
    if (pathname === '/' || pathname === '/404') return false;
    const providers = await fetchProviders();
    return startOidcBounce({
      pathname,
      search,
      providers,
      storage: window.sessionStorage,
      assign: (url) => window.location.assign(url),
    });
  }, []);
}
