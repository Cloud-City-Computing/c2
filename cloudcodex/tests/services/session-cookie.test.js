/**
 * Tests for services/session-cookie.js, the one server-side definition of the session cookie
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  SESSION_COOKIE,
  LEGACY_SESSION_COOKIE,
  sessionCookieName,
  legacyCookieAllowed,
  readSessionCookie,
} from '../../services/session-cookie.js';
import { contractDefault } from '../contract-default.js';

describe('the cookie names', () => {
  it('is __Host-sessionToken, and the legacy name is sessionToken', () => {
    expect(SESSION_COOKIE).toBe('__Host-sessionToken');
    expect(LEGACY_SESSION_COOKIE).toBe('sessionToken');
  });

  it('names a Secure cookie with the prefix, and only a non-Secure one with the legacy name', () => {
    expect(sessionCookieName({ secure: true })).toBe('__Host-sessionToken');
    expect(sessionCookieName({ secure: false })).toBe('sessionToken');
  });
});

describe('legacyCookieAllowed', () => {
  const prior = process.env.LEGACY_SESSION_COOKIE;
  afterEach(() => {
    if (prior === undefined) delete process.env.LEGACY_SESSION_COOKIE;
    else process.env.LEGACY_SESSION_COOKIE = prior;
  });

  it('is on when unset, which is what the contract says an unset value behaves as', () => {
    delete process.env.LEGACY_SESSION_COOKIE;
    const unset = legacyCookieAllowed();
    process.env.LEGACY_SESSION_COOKIE = contractDefault('LEGACY_SESSION_COOKIE');
    expect(unset).toBe(true);
    expect(legacyCookieAllowed()).toBe(unset);
  });

  it('is on when blank', () => {
    process.env.LEGACY_SESSION_COOKIE = '';
    expect(legacyCookieAllowed()).toBe(true);
  });

  it('is off only for exactly 0', () => {
    process.env.LEGACY_SESSION_COOKIE = '0';
    expect(legacyCookieAllowed()).toBe(false);
    for (const value of ['1', 'false', 'no', ' 0']) {
      process.env.LEGACY_SESSION_COOKIE = value;
      expect(legacyCookieAllowed(), value).toBe(true);
    }
  });
});

describe('readSessionCookie', () => {
  const on = { allowLegacy: true };
  const off = { allowLegacy: false };

  it('is null for no Cookie header, and for one carrying neither name', () => {
    expect(readSessionCookie(undefined, on)).toBeNull();
    expect(readSessionCookie('', on)).toBeNull();
    expect(readSessionCookie('theme=dark; density=compact', on)).toBeNull();
  });

  it('reads the prefixed cookie whatever the fallback says', () => {
    expect(readSessionCookie('__Host-sessionToken=good', on)).toBe('good');
    expect(readSessionCookie('__Host-sessionToken=good', off)).toBe('good');
  });

  // A sibling host can toss `sessionToken=...; Domain=<parent>; Path=/api`,
  // and a browser sends the longer path first. It cannot set a __Host- cookie.
  it('prefers the prefixed cookie over a legacy one, in either order', () => {
    expect(readSessionCookie('sessionToken=tossed; __Host-sessionToken=good', on)).toBe('good');
    expect(readSessionCookie('__Host-sessionToken=good; sessionToken=tossed', on)).toBe('good');
  });

  it('reads a lone legacy cookie only while the fallback is allowed', () => {
    expect(readSessionCookie('theme=dark; sessionToken=old', on)).toBe('old');
    expect(readSessionCookie('theme=dark; sessionToken=old', off)).toBeNull();
  });

  it('never falls back to the legacy name while a prefixed cookie is present, even an empty one', () => {
    expect(readSessionCookie('__Host-sessionToken=; sessionToken=tossed', on)).toBeNull();
  });

  it('treats an empty value as no token', () => {
    expect(readSessionCookie('sessionToken=', on)).toBeNull();
    expect(readSessionCookie('__Host-sessionToken=', on)).toBeNull();
  });

  it('matches names exactly, not by suffix or prefix', () => {
    expect(readSessionCookie('xsessionToken=a; sessionTokenx=b', on)).toBeNull();
    expect(readSessionCookie('__Host-sessionTokenx=a', on)).toBeNull();
  });

  it('tolerates cookie pairs separated without a space', () => {
    expect(readSessionCookie('theme=dark;__Host-sessionToken=good', on)).toBe('good');
  });

  // Only the ASCII space and tab a Cookie header puts between pairs are
  // separators. A name that starts with any other whitespace is a different
  // cookie, one a browser stores without the __Host- rules, so it must never
  // read as the prefixed cookie (or as the legacy one).
  it('matches a name only after ASCII space or tab, never after other whitespace', () => {
    for (const ws of ['\u00a0', '\ufeff', '\u2000', '\u3000', '\v', '\f']) {
      expect(readSessionCookie(`${ws}__Host-sessionToken=tossed; __Host-sessionToken=good`, on), JSON.stringify(ws)).toBe('good');
      expect(readSessionCookie(`theme=dark; ${ws}__Host-sessionToken=tossed`, off), JSON.stringify(ws)).toBeNull();
      expect(readSessionCookie(`${ws}sessionToken=tossed`, on), JSON.stringify(ws)).toBeNull();
    }
    expect(readSessionCookie('theme=dark;\t__Host-sessionToken=good', on)).toBe('good');
  });
});
