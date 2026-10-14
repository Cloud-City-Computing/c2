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
import { safeReturnTo } from '../../../services/return-to.js';

const corpus = JSON.parse(
  readFileSync(path.resolve('tests/fixtures/return-to-corpus.json'), 'utf8'),
);

/** Replaces window.sessionStorage with a getter that throws. Returns the function that restores the original. */
function stubStorageThrows() {
  const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
  Object.defineProperty(window, 'sessionStorage', { configurable: true, get() { throw new Error('denied'); } });
  return () => {
    if (original) Object.defineProperty(window, 'sessionStorage', original);
    else delete window.sessionStorage;
  };
}

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

  it('renders the landing on the 404 page, which never bounces or opens the modal', () => {
    expect(decideSignedOut({ ...deepLink, pathname: '/404' })).toEqual({ action: 'landing' });
    expect(decideSignedOut({ ...deepLink, oidcOffered: false, pathname: '/404' })).toEqual({ action: 'landing' });
  });

  it('bounces an OIDC-only bare root (OIDC is the only sign-in) once, with / as returnTo', () => {
    expect(decideSignedOut({ ...deepLink, pathname: '/' })).toEqual({
      action: 'bounce',
      url: '/api/auth/oidc/start?returnTo=%2F',
    });
  });

  it('keeps the sign-in screen on a bare root where local sign-in is offered, or OIDC is not', () => {
    expect(decideSignedOut({ ...deepLink, pathname: '/', oidcOnly: false })).toEqual({ action: 'landing' });
    expect(decideSignedOut({ ...deepLink, pathname: '/', oidcOffered: false, oidcOnly: false })).toEqual({ action: 'landing' });
  });

  it('does not bounce a bare root that already bounced, returned with an error, or came from a sign-out', () => {
    expect(decideSignedOut({ ...deepLink, pathname: '/', bounced: true })).toEqual({ action: 'landing' });
    expect(decideSignedOut({ ...deepLink, pathname: '/', oauthError: true })).toEqual({ action: 'landing' });
    expect(decideSignedOut({ ...deepLink, pathname: '/', search: '?signedOut=1' })).toEqual({ action: 'landing' });
  });

  it('renders the landing once the marker is set (the loop guard)', () => {
    expect(decideSignedOut({ ...deepLink, bounced: true })).toEqual({ action: 'landing' });
  });

  it('renders the landing on an oauth_error return, which must not bounce again', () => {
    expect(decideSignedOut({ ...deepLink, oauthError: true })).toEqual({ action: 'landing' });
  });

  it('opens the Login modal when OIDC is offered beside local login, whatever a suite flag says (CDX-SA-2)', () => {
    // The suite flag is gone: with OIDC beside local login the modal answers, and nothing bounces.
    expect(decideSignedOut({ ...deepLink, oidcOnly: false, suiteOn: true, search: '?x=1' })).toEqual({
      action: 'login',
      target: '/doc/9?x=1',
    });
  });

  it('opens the Login modal, keeping the target, when OIDC is offered beside local login outside suite mode', () => {
    // Before W6-CDX-26's fix this stayed on the deep URL with the landing (or redirected to "/"). It is the modal now.
    expect(decideSignedOut({ ...deepLink, oidcOnly: false, suiteOn: false, search: '?x=1' })).toEqual({
      action: 'login',
      target: '/doc/9?x=1',
    });
  });

  it('keeps the URL fragment in the target, because a browser never sends it to the server', () => {
    const decision = decideSignedOut({ ...deepLink, search: '?x=1', hash: '#top' });
    expect(decision.action).toBe('bounce');
    expect(returnToOf(decision.url)).toBe('/doc/9?x=1#top');
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

  it('falls back to "/" for an encoded path (the bounce still happens)', () => {
    const decision = decideSignedOut({ ...deepLink, pathname: '/doc%20x' });
    expect(decision.action).toBe('bounce');
    expect(returnToOf(decision.url)).toBe('/');
  });

  // Every corpus entry is the hostile-input contract, fed the way production feeds it: the browser's
  // location, split by the URL parser into pathname, search and hash. The corpus answer is what the
  // validator gives a RAW value. The browser normalises some values first (dot segments, backslashes,
  // characters it percent-encodes, an empty "?" or "#"), so the production target can differ from the
  // corpus answer. The test pins the production target, and checks it is always "/" or a same-origin path.
  const cases = corpus.cases.filter((c) => c.input !== '/' && c.input !== '/404');
  const productionTarget = (input) => {
    if (!(input.startsWith('/') && !input.startsWith('//'))) return { parts: { pathname: input, search: '', hash: '' }, expected: '/' };
    const { pathname, search, hash } = new URL(input, 'http://app.test');
    const joined = pathname + search + hash;
    return { parts: { pathname, search, hash }, expected: safeReturnTo(joined) };
  };
  it.each(cases.map((c, i) => [i, c.input, c.expected]))('corpus case %i bounces with the production target as returnTo', (_i, input, corpusAnswer) => {
    const { parts, expected } = productionTarget(input);
    const decision = decideSignedOut({ ...deepLink, ...parts });
    // The browser can resolve the input to the root (for example "/\\evil.example" becomes "//evil.example", a host,
    // so the pathname is "/"). The bare root follows its own rule: OIDC-only bounces with "/" as returnTo, so the hostile
    // input never reaches the URL, and a local-sign-in instance lands (the root tests above pin both sides).
    if (parts.pathname === '/') {
      expect(decision, JSON.stringify(input)).toEqual({ action: 'bounce', url: '/api/auth/oidc/start?returnTo=%2F' });
      return;
    }
    expect(decision.action, JSON.stringify(input)).toBe('bounce');
    expect(returnToOf(decision.url), `${JSON.stringify(input)} (corpus answer ${JSON.stringify(corpusAnswer)})`).toBe(expected);
    const safe = expected === '/' || (expected.startsWith('/') && !expected.startsWith('//') && !expected.includes('\\'));
    expect(safe, JSON.stringify(expected)).toBe(true);
  });
});

describe('resolveSignedOut and startOidcBounce', () => {
  let assign;

  beforeEach(() => {
    assign = vi.fn();
  });

  it('an OIDC-only bare root bounces once, and a local-sign-in bare root keeps its screen and no marker', async () => {
    const oidcOnly = fakeStorage();
    expect(await resolveSignedOut({ pathname: '/', search: '', providers: ONLY_OIDC, suiteOn: false, storage: oidcOnly, assign }))
      .toBe('bounced');
    expect(assign).toHaveBeenLastCalledWith('/api/auth/oidc/start?returnTo=%2F');
    expect(oidcOnly.data[OIDC_BOUNCE_MARKER]).toBe('1');

    const local = fakeStorage();
    expect(await resolveSignedOut({ pathname: '/', search: '', providers: OIDC_AND_LOCAL, suiteOn: false, storage: local, assign }))
      .toBe('landing');
    expect(await resolveSignedOut({ pathname: '/', search: '', providers: LOCAL_ONLY, suiteOn: false, storage: local, assign }))
      .toBe('landing');
    expect(local.data[OIDC_BOUNCE_MARKER]).toBeUndefined();
    expect(local.data[SIGN_IN_TARGET_KEY]).toBeUndefined();
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it('sets the marker and assigns the start URL on the first signed-out deep link', async () => {
    const storage = fakeStorage();
    const outcome = await resolveSignedOut({ pathname: '/doc/9', search: '', providers: ONLY_OIDC, suiteOn: false, storage, assign });

    expect(outcome).toBe('bounced');
    expect(storage.data[OIDC_BOUNCE_MARKER]).toBe('1');
    expect(assign).toHaveBeenCalledWith('/api/auth/oidc/start?returnTo=' + encodeURIComponent('/doc/9'));
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
    fetchMock.mockReset();
    fetchMock.mockImplementation((url) => Promise.resolve({ json: () => Promise.resolve(answer(url)) }));
    vi.stubGlobal('fetch', fetchMock);
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('treats a sessionStorage whose getter throws as refused: no bounce, and the landing still renders', async () => {
    const restore = stubStorageThrows();
    try {
      window.history.replaceState({}, '', '/doc/9');
      const { result } = renderHook(() => useSignedOutTarget());
      expect(await result.current()).toBe('landing');
      expect(fetchMock).toHaveBeenCalledWith('/api/oauth/providers');
    } finally {
      restore();
      window.history.replaceState({}, '', '/');
    }
  });

  it('with the getter throwing and no OIDC offered, still opens the Login modal', async () => {
    fetchMock.mockImplementation((url) => Promise.resolve({ json: () => Promise.resolve(
      url === '/api/oauth/providers' ? { success: true, providers: LOCAL_ONLY } : { enabled: false, name: null },
    ) }));
    const restore = stubStorageThrows();
    try {
      window.history.replaceState({}, '', '/doc/9');
      const { result } = renderHook(() => useSignedOutTarget());
      expect(await result.current()).toBe('login');
    } finally {
      restore();
      window.history.replaceState({}, '', '/');
    }
  });

  it('bounces an OIDC-only bare root to the sign-in, asking the providers route first', async () => {
    window.history.replaceState({}, '', '/');
    const { result } = renderHook(() => useSignedOutTarget());
    expect(await result.current()).toBe('bounced');
    expect(fetchMock).toHaveBeenCalledWith('/api/oauth/providers');
    window.history.replaceState({}, '', '/');
  });

  it('keeps the sign-in screen on a bare root of an instance with local sign-in', async () => {
    fetchMock.mockImplementation((url) => Promise.resolve({ json: () => Promise.resolve(
      url === '/api/oauth/providers' ? { success: true, providers: OIDC_AND_LOCAL } : { enabled: false, name: null },
    ) }));
    window.history.replaceState({}, '', '/');
    const { result } = renderHook(() => useSignedOutTarget());
    expect(await result.current()).toBe('landing');
    expect(window.sessionStorage.getItem(OIDC_BOUNCE_MARKER)).toBeNull();
  });

  it('asks only the providers route, then bounces a deep link (no suite route, CDX-SA-2)', async () => {
    window.history.replaceState({}, '', '/doc/9');
    const { result } = renderHook(() => useSignedOutTarget());
    expect(await result.current()).toBe('bounced');
    expect(fetchMock).toHaveBeenCalledWith('/api/oauth/providers');
    expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain('/api/suite');
    window.history.replaceState({}, '', '/');
  });
});
