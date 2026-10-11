/**
 * Tests for src/hooks/useSignedOutTarget.js: where a signed-out visitor's deep link goes (W6-CDX-8, W6-CDX-26)
 *
 * Three outcomes. OIDC offered and bounceable (OIDC is the only sign-in, or suite mode is on): once per tab to
 * the sign-in start with the target as returnTo; the marker in sessionStorage is the loop guard, and an
 * oauth_error return renders the landing. No OIDC at all: the target is kept (validated with the one
 * validator, services/return-to.js) and the Login modal opens; a successful local sign-in then goes to it.
 * Anything else renders the landing. The decision is pure and tested directly; the hook only wires it.
 *
 * tests/fixtures/return-to-corpus.json is the hostile-input contract every returnTo must honour, so every
 * corpus entry runs through the bounce here too, not only through the validator's own test.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  OIDC_BOUNCE_MARKER,
  SIGN_IN_TARGET_KEY,
  isOidcOnly,
  decideSignedOut,
  startOidcBounce,
  resolveSignedOut,
  keepSignInTarget,
  takeSignInTarget,
  clearOidcBounce,
  useSignedOutTarget,
} from '../../../src/hooks/useSignedOutTarget.js';
import { __resetSuiteCache } from '../../../src/hooks/useSuite.js';

const corpus = JSON.parse(
  readFileSync(path.resolve('tests/fixtures/return-to-corpus.json'), 'utf8'),
);

const ONLY_OIDC = { google: false, github: false, local: false, oidc: { enabled: true, name: 'SSO' } };
const OIDC_AND_LOCAL = { google: false, github: false, local: true, oidc: { enabled: true, name: 'SSO' } };
const LOCAL_ONLY = { google: false, github: false, local: true, oidc: { enabled: false, name: 'SSO' } };

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
  };
}

/** The returnTo a bounce URL carries, decoded. */
function returnToOf(url) {
  return new URL(url, 'http://app.test').searchParams.get('returnTo');
}

const deepLink = { pathname: '/doc/9', search: '', oidcOffered: true, oidcOnly: true, suiteOn: false, bounced: false, oauthError: false };

describe('isOidcOnly', () => {
  it('is true when oidc is the only sign-in offered', () => {
    expect(isOidcOnly(ONLY_OIDC)).toBe(true);
  });

  it.each([
    ['local is offered', OIDC_AND_LOCAL],
    ['google is offered', { ...ONLY_OIDC, google: true }],
    ['oidc is not enabled', { ...ONLY_OIDC, oidc: { enabled: false } }],
    ['the server does not report local (an older server)', { google: false, oidc: { enabled: true } }],
    ['there is no providers object', undefined],
  ])('is false when %s', (_label, providers) => {
    expect(isOidcOnly(providers)).toBe(false);
  });
});

describe('decideSignedOut', () => {
  it('bounces a signed-out deep link once, with the path and query as returnTo', () => {
    expect(decideSignedOut({ ...deepLink, search: '?q=x', pathname: '/docs/archive/7' })).toEqual({
      action: 'bounce',
      url: '/api/auth/oidc/start?returnTo=' + encodeURIComponent('/docs/archive/7?q=x'),
    });
  });

  it('renders the landing on the root and the 404 page, which never bounce or open the modal', () => {
    expect(decideSignedOut({ ...deepLink, pathname: '/' })).toEqual({ action: 'landing' });
    expect(decideSignedOut({ ...deepLink, pathname: '/404' })).toEqual({ action: 'landing' });
    expect(decideSignedOut({ ...deepLink, oidcOffered: false, pathname: '/' })).toEqual({ action: 'landing' });
  });

  it('renders the landing once the marker is set (the loop guard)', () => {
    expect(decideSignedOut({ ...deepLink, bounced: true })).toEqual({ action: 'landing' });
  });

  it('renders the landing on an oauth_error return, which must not bounce again', () => {
    expect(decideSignedOut({ ...deepLink, oauthError: true })).toEqual({ action: 'landing' });
  });

  it('bounces in suite mode even when local login is also enabled (oidc offered, not oidc-only)', () => {
    const decision = decideSignedOut({ ...deepLink, oidcOnly: false, suiteOn: true });
    expect(decision.action).toBe('bounce');
    expect(returnToOf(decision.url)).toBe('/doc/9');
  });

  it('renders the landing when OIDC is offered beside local login outside suite mode (unchanged)', () => {
    expect(decideSignedOut({ ...deepLink, oidcOnly: false, suiteOn: false })).toEqual({ action: 'landing' });
  });

  it('opens the Login modal, keeping the validated target, when no OIDC is offered', () => {
    expect(decideSignedOut({ ...deepLink, oidcOffered: false, oidcOnly: false, search: '?tab=2' })).toEqual({
      action: 'login',
      target: '/doc/9?tab=2',
    });
  });

  it('keeps "/" as the target for a hostile path when no OIDC is offered', () => {
    expect(decideSignedOut({ ...deepLink, oidcOffered: false, oidcOnly: false, pathname: '/doc%20x' })).toEqual({
      action: 'login',
      target: '/',
    });
  });

  it('falls back to "/" for an encoded path, as Cloud Command does (the bounce still happens)', () => {
    const decision = decideSignedOut({ ...deepLink, pathname: '/doc%20x' });
    expect(decision.action).toBe('bounce');
    expect(returnToOf(decision.url)).toBe('/');
  });

  // Every corpus entry is the hostile-input contract: the bounce's returnTo must be the corpus answer.
  const cases = corpus.cases.filter((c) => c.input !== '/' && c.input !== '/404');
  it.each(cases.map((c, i) => [i, c.input, c.expected]))('corpus case %i bounces with the corpus answer as returnTo', (_i, input, expected) => {
    const decision = decideSignedOut({ ...deepLink, pathname: input, search: '' });
    expect(decision.action, JSON.stringify(input)).toBe('bounce');
    expect(returnToOf(decision.url), JSON.stringify(input)).toBe(expected);
  });
});

describe('resolveSignedOut and startOidcBounce', () => {
  let assign;

  beforeEach(() => {
    assign = vi.fn();
  });

  it('sets the marker and assigns the start URL on the first signed-out deep link', async () => {
    const storage = fakeStorage();
    const outcome = await resolveSignedOut({ pathname: '/doc/9', search: '', providers: ONLY_OIDC, suiteOn: false, storage, assign });

    expect(outcome).toBe('bounced');
    expect(storage.data[OIDC_BOUNCE_MARKER]).toBe('1');
    expect(assign).toHaveBeenCalledWith('/api/auth/oidc/start?returnTo=' + encodeURIComponent('/doc/9'));
  });

  it('bounces in suite mode with local login also enabled', async () => {
    const storage = fakeStorage();
    expect(await startOidcBounce({ pathname: '/doc/9', search: '', providers: OIDC_AND_LOCAL, suiteOn: true, storage, assign })).toBe(true);
    expect(assign).toHaveBeenCalledOnce();
  });

  it('does not bounce a second time in the same tab (the loop guard)', async () => {
    const storage = fakeStorage({ [OIDC_BOUNCE_MARKER]: '1' });
    expect(await resolveSignedOut({ pathname: '/doc/9', search: '', providers: ONLY_OIDC, suiteOn: false, storage, assign })).toBe('landing');
    expect(assign).not.toHaveBeenCalled();
  });

  it('keeps the landing for an oauth_error return and does not bounce', async () => {
    const storage = fakeStorage();
    expect(await resolveSignedOut({ pathname: '/doc/9', search: '?oauth_error=no_account', providers: ONLY_OIDC, suiteOn: false, storage, assign })).toBe('landing');
    expect(assign).not.toHaveBeenCalled();
  });

  it('does not bounce when the providers route cannot be read, and opens the Login modal instead', async () => {
    const storage = fakeStorage();
    expect(await resolveSignedOut({ pathname: '/doc/9', search: '', providers: null, suiteOn: false, storage, assign })).toBe('login');
    expect(assign).not.toHaveBeenCalled();
    expect(storage.data[OIDC_BOUNCE_MARKER]).toBeUndefined();
  });

  it('does not bounce when sessionStorage cannot hold the marker, since that would loop', async () => {
    const storage = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    };
    expect(await startOidcBounce({ pathname: '/doc/9', search: '', providers: ONLY_OIDC, suiteOn: false, storage, assign })).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });

  it('opens the Login modal, not a bounce, on a local-only instance, and keeps the target', async () => {
    const storage = fakeStorage();
    expect(await resolveSignedOut({ pathname: '/doc/9', search: '?x=1', providers: LOCAL_ONLY, suiteOn: false, storage, assign })).toBe('login');
    expect(assign).not.toHaveBeenCalled();
    expect(storage.data[SIGN_IN_TARGET_KEY]).toBe('/doc/9?x=1');
  });
});

describe('the kept sign-in target', () => {
  it('is handed back once, then forgotten', () => {
    const storage = fakeStorage();
    keepSignInTarget(storage, '/doc/9');
    expect(takeSignInTarget(storage)).toBe('/doc/9');
    expect(takeSignInTarget(storage)).toBeNull();
  });

  it('is never stored unvalidated: a hostile value is kept as "/"', () => {
    const storage = fakeStorage();
    keepSignInTarget(storage, '//evil.example/x');
    expect(takeSignInTarget(storage)).toBe('/');
  });

  it('reads as nothing when storage refuses', () => {
    const storage = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    };
    expect(() => keepSignInTarget(storage, '/doc/9')).not.toThrow();
    expect(takeSignInTarget(storage)).toBeNull();
  });
});

describe('clearOidcBounce', () => {
  it('removes the marker, which a successful sign-in does', () => {
    const storage = fakeStorage({ [OIDC_BOUNCE_MARKER]: '1' });
    clearOidcBounce(storage);
    expect(storage.data).toEqual({});
  });
});

describe('useSignedOutTarget', () => {
  const fetchMock = vi.fn();

  function answer(url) {
    if (url === '/api/oauth/providers') return { success: true, providers: ONLY_OIDC };
    if (url === '/api/suite') return { enabled: false, name: null };
    return {};
  }

  beforeEach(() => {
    __resetSuiteCache();
    fetchMock.mockReset();
    fetchMock.mockImplementation((url) => Promise.resolve({ json: () => Promise.resolve(answer(url)) }));
    vi.stubGlobal('fetch', fetchMock);
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('answers landing on the root without asking the server, so the landing is untouched', async () => {
    window.history.replaceState({}, '', '/');
    const { result } = renderHook(() => useSignedOutTarget());
    expect(await result.current()).toBe('landing');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks the providers route and the suite route, then bounces a deep link', async () => {
    window.history.replaceState({}, '', '/doc/9');
    const { result } = renderHook(() => useSignedOutTarget());
    expect(await result.current()).toBe('bounced');
    expect(fetchMock).toHaveBeenCalledWith('/api/oauth/providers');
    expect(fetchMock).toHaveBeenCalledWith('/api/suite', expect.anything());
    window.history.replaceState({}, '', '/');
  });
});
