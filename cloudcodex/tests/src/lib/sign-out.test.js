/**
 * Cloud Codex - Tests for src/lib/sign-out.js, the sign-out the sidebar footer runs (moved from AccountPanel, W6-CDX-40)
 *
 * Sign-out deletes the server's session row, then clears the session cookie through the one client helper
 * that knows both names (W6-CDX-3), so an https page does not keep a __Host-sessionToken.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { utilMock } = vi.hoisted(() => ({
  utilMock: {
    apiFetch: vi.fn(),
    removeSessStorage: vi.fn(),
    clearSessionCookie: vi.fn(),
  },
}));

vi.mock('../../../src/util.jsx', () => utilMock);

import { signOut, isHttpUrl } from '../../../src/lib/sign-out.js';

const realLocation = window.location;
let location;

beforeEach(() => {
  for (const fn of Object.values(utilMock)) fn.mockReset();
  location = { href: 'http://localhost:3000/account' };
  Object.defineProperty(window, 'location', { value: location, writable: true, configurable: true });
});

afterEach(() => {
  Object.defineProperty(window, 'location', { value: realLocation, writable: true, configurable: true });
  vi.useRealTimers();
});

describe('signOut', () => {
  it('deletes the session, forgets the cached user, clears the cookie', async () => {
    utilMock.apiFetch.mockResolvedValueOnce({ success: true });
    await signOut();
    expect(utilMock.clearSessionCookie).toHaveBeenCalledTimes(1);
    expect(utilMock.apiFetch).toHaveBeenCalledWith('POST', '/api/logout', {});
    expect(utilMock.removeSessStorage).toHaveBeenCalledWith('currentUser');
  });

  it('still clears the cookie when the server cannot be reached', async () => {
    utilMock.apiFetch.mockRejectedValueOnce(new Error('offline'));
    await signOut();
    expect(utilMock.clearSessionCookie).toHaveBeenCalledTimes(1);
  });

  // W6-CDX-6: an OIDC sign-out is sent on to the issuer's end-session URL, after the local teardown.
  it('navigates to the endSessionUrl the server answers', async () => {
    const endSessionUrl = 'https://id.example.test/end-session?client_id=codex-web&state=abc';
    utilMock.apiFetch.mockResolvedValueOnce({ success: true, endSessionUrl });
    await signOut();
    expect(location.href).toBe(endSessionUrl);
    expect(utilMock.clearSessionCookie).toHaveBeenCalledTimes(1);
  });

  it('goes to /?signedOut=1 for a local session, which has no endSessionUrl', async () => {
    utilMock.apiFetch.mockResolvedValueOnce({ success: true });
    await signOut();
    expect(location.href).toBe('/?signedOut=1');
  });

  it('never navigates to a URL that is not http or https', async () => {
    for (const endSessionUrl of ['javascript:alert(1)', 'data:text/html,hi', '/relative', 'not a url']) {
      location.href = 'http://localhost:3000/account';
      utilMock.apiFetch.mockResolvedValueOnce({ success: true, endSessionUrl });
      await signOut();
      expect(location.href).toBe('/?signedOut=1');
    }
  });

  it('ends the local session at once, before the server answers', () => {
    utilMock.apiFetch.mockReturnValueOnce(new Promise(() => {}));
    signOut();
    expect(utilMock.clearSessionCookie).toHaveBeenCalledTimes(1);
    expect(utilMock.removeSessStorage).toHaveBeenCalledWith('currentUser');
    expect(utilMock.apiFetch).toHaveBeenCalledWith('POST', '/api/logout', {});
  });

  it('stops waiting for a server that never answers after five seconds, and goes to /?signedOut=1', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    utilMock.apiFetch.mockReturnValueOnce(new Promise(() => {}));
    const done = signOut();
    await vi.advanceTimersByTimeAsync(5000);
    await done;
    expect(location.href).toBe('/?signedOut=1');
  });
});

describe('isHttpUrl', () => {
  it('accepts only http and https absolute URLs', () => {
    expect(isHttpUrl('https://id.example.test/x')).toBe(true);
    expect(isHttpUrl('http://localhost/x')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl(undefined)).toBe(false);
  });
});
