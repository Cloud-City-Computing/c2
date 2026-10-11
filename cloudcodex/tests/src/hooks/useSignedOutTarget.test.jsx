/**
 * Tests for src/hooks/useSignedOutTarget.js: the deep-link bounce for an OIDC-only instance
 *
 * A signed-out deep link on an instance where OIDC is the only provider goes once per tab to the sign-in
 * start, with the target as returnTo. The marker in sessionStorage is the loop guard: a return that did not
 * sign in, or an oauth_error return, renders the landing instead. The decision is pure and tested directly;
 * the hook only wires it to the providers route and the browser.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  OIDC_BOUNCE_MARKER,
  isOidcOnly,
  decideSignedOut,
  startOidcBounce,
  clearOidcBounce,
  useSignedOutTarget,
} from '../../../src/hooks/useSignedOutTarget.js';

const ONLY_OIDC = { google: false, github: false, local: false, oidc: { enabled: true, name: 'SSO' } };

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
  };
}

describe('isOidcOnly', () => {
  it('is true when oidc is the only sign-in offered', () => {
    expect(isOidcOnly(ONLY_OIDC)).toBe(true);
  });

  it.each([
    ['local is offered', { ...ONLY_OIDC, local: true }],
    ['google is offered', { ...ONLY_OIDC, google: true }],
    ['oidc is not enabled', { ...ONLY_OIDC, oidc: { enabled: false } }],
    ['the server does not report local (an older server)', { google: false, oidc: { enabled: true } }],
    ['there is no providers object', undefined],
  ])('is false when %s', (_label, providers) => {
    expect(isOidcOnly(providers)).toBe(false);
  });
});

describe('decideSignedOut', () => {
  const base = { pathname: '/docs/archive/7', search: '?q=x', oidcOnly: true, bounced: false, oauthError: false };

  it('bounces a signed-out deep link once, with the path and query as returnTo', () => {
    expect(decideSignedOut(base)).toEqual({
      action: 'bounce',
      url: '/api/auth/oidc/start?returnTo=' + encodeURIComponent('/docs/archive/7?q=x'),
    });
  });

  it('renders the landing on the root and the 404 page, which never bounce', () => {
    expect(decideSignedOut({ ...base, pathname: '/' })).toEqual({ action: 'landing' });
    expect(decideSignedOut({ ...base, pathname: '/404' })).toEqual({ action: 'landing' });
  });

  it('renders the landing once the marker is set (the loop guard)', () => {
    expect(decideSignedOut({ ...base, bounced: true })).toEqual({ action: 'landing' });
  });

  it('renders the landing on an oauth_error return, which must not bounce again', () => {
    expect(decideSignedOut({ ...base, oauthError: true })).toEqual({ action: 'landing' });
  });

  it('renders the landing on an instance that offers more than OIDC', () => {
    expect(decideSignedOut({ ...base, oidcOnly: false })).toEqual({ action: 'landing' });
  });
});

describe('startOidcBounce', () => {
  let assign;

  beforeEach(() => {
    assign = vi.fn();
  });

  it('sets the marker and assigns the start URL on the first signed-out deep link', async () => {
    const storage = fakeStorage();
    const bounced = await startOidcBounce({ pathname: '/doc/9', search: '', providers: ONLY_OIDC, storage, assign });

    expect(bounced).toBe(true);
    expect(storage.data[OIDC_BOUNCE_MARKER]).toBe('1');
    expect(assign).toHaveBeenCalledWith('/api/auth/oidc/start?returnTo=' + encodeURIComponent('/doc/9'));
  });

  it('does not bounce a second time in the same tab', async () => {
    const storage = fakeStorage({ [OIDC_BOUNCE_MARKER]: '1' });
    expect(await startOidcBounce({ pathname: '/doc/9', search: '', providers: ONLY_OIDC, storage, assign })).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });

  it('does not bounce when the providers route cannot say OIDC is the only one', async () => {
    const storage = fakeStorage();
    expect(await startOidcBounce({ pathname: '/doc/9', search: '', providers: null, storage, assign })).toBe(false);
    expect(assign).not.toHaveBeenCalled();
    expect(storage.data).toEqual({});
  });

  it('does not bounce when sessionStorage cannot hold the marker, since that would loop', async () => {
    const storage = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    };
    expect(await startOidcBounce({ pathname: '/doc/9', search: '', providers: ONLY_OIDC, storage, assign })).toBe(false);
    expect(assign).not.toHaveBeenCalled();
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

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('answers false on the root without asking the server, so the landing is untouched', async () => {
    window.history.replaceState({}, '', '/');
    const { result } = renderHook(() => useSignedOutTarget());
    expect(await result.current()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
