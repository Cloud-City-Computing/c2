/**
 * Tests for the Google callback's hand-off to services/identity.js, with no domain restriction
 *
 * The existing route tests stop at the state check, so nothing drove the
 * callback past the token exchange. These do, with google-auth-library
 * replaced, to prove the route builds the policy today's behaviour needs
 * (link by verified email, no auto-create when GOOGLE_OAUTH_DOMAIN is unset),
 * maps every refusal to the redirect it always issued, and still binds state
 * to the initiating browser. An email match with two-factor authentication on
 * is refused as two_factor_enabled, while an identity already linked keeps
 * signing in with no second-factor challenge. The domain-restricted policy has its own file,
 * because routes/oauth.js reads GOOGLE_OAUTH_DOMAIN at import time.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const google = vi.hoisted(() => {
  process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
  delete process.env.GOOGLE_OAUTH_DOMAIN;
  return { getToken: vi.fn(), verifyIdToken: vi.fn() };
});

vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    generateAuthUrl(options) {
      return `https://accounts.google.example/auth?state=${options.state}`;
    }
    getToken(code) {
      return google.getToken(code);
    }
    verifyIdToken(options) {
      return google.verifyIdToken(options);
    }
  },
}));

import request from 'supertest';
import app from '../../app.js';
import { c2_query, generateSessionToken } from '../../mysql_connect.js';
import { resetMocks } from '../helpers.js';

const GOOGLE_COOKIE = 'oauth_state_google';

function payload(overrides = {}) {
  return { sub: 'google-sub-1', email: 'ada@example.com', email_verified: true, hd: undefined, ...overrides };
}

/** Starts a Google sign-in and completes it in the same browser. */
async function signIn(idTokenPayload) {
  google.getToken.mockResolvedValueOnce({ tokens: { id_token: 'id-token' } });
  google.verifyIdToken.mockResolvedValueOnce({ getPayload: () => idTokenPayload });
  const start = await request(app).get('/api/oauth/google');
  const state = new URL(start.headers.location).searchParams.get('state');
  return request(app)
    .get(`/api/oauth/google/callback?code=good-code&state=${state}`)
    .set('Cookie', `${GOOGLE_COOKIE}=${state}`);
}

function sessionCookie(res) {
  return (res.headers['set-cookie'] || []).find(c => c.startsWith('sessionToken='));
}

const writes = () => c2_query.mock.calls.filter(([sql]) => /^\s*(INSERT|UPDATE|DELETE)/i.test(sql));

describe('Google callback through the identity seam (no domain restriction)', () => {
  beforeEach(() => {
    resetMocks();
    google.getToken.mockReset();
    google.verifyIdToken.mockReset();
  });

  it('signs a linked identity in: link lookup, then the user fetch, then a session', async () => {
    c2_query.mockResolvedValueOnce([{ user_id: 42 }]);
    c2_query.mockResolvedValueOnce([{ id: 42, name: 'ada', avatar_url: null, is_admin: 0 }]);

    const res = await signIn(payload());

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
    expect(sessionCookie(res)).toMatch(/^sessionToken=mock-session-token/);
    expect(c2_query).toHaveBeenCalledTimes(2);
    expect(c2_query.mock.calls[0][1]).toEqual(['google-sub-1']);
    expect(c2_query.mock.calls[1][1]).toEqual([42]);
    expect(generateSessionToken.mock.calls[0][0]).toMatchObject({ id: 42, is_admin: false });
    expect(writes()).toEqual([]);
  });

  it('mints the session as a Google one', async () => {
    c2_query.mockResolvedValueOnce([{ user_id: 42 }]);
    c2_query.mockResolvedValueOnce([{ id: 42, name: 'ada', avatar_url: null, is_admin: 0 }]);

    await signIn(payload());

    expect(generateSessionToken).toHaveBeenCalledTimes(1);
    expect(generateSessionToken.mock.calls[0][3]).toEqual({ provider: 'google' });
  });

  // The session cookie is host-only: no writer sets Domain, so a sibling
  // subdomain can neither read it nor plant one this host would accept as its
  // own. Pinned on the one server-side writer.
  it('sets the session cookie host-only, with no Domain attribute on any Set-Cookie', async () => {
    c2_query.mockResolvedValueOnce([{ user_id: 42 }]);
    c2_query.mockResolvedValueOnce([{ id: 42, name: 'ada', avatar_url: null, is_admin: 0 }]);

    const res = await signIn(payload());

    const cookies = res.headers['set-cookie'] || [];
    expect(cookies.some(c => /sessionToken=/.test(c))).toBe(true);
    for (const cookie of cookies) expect(cookie).not.toMatch(/;\s*Domain=/i);
  });

  it('links an existing user by verified email, then signs them in', async () => {
    c2_query.mockResolvedValueOnce([]); // no link
    c2_query.mockResolvedValueOnce([{ id: 9, two_factor_method: 'none' }]); // user by email
    c2_query.mockResolvedValueOnce([]); // no Google account on that user yet
    c2_query.mockResolvedValueOnce({ affectedRows: 1, insertId: 1 }); // link
    c2_query.mockResolvedValueOnce([{ id: 9, name: 'ada', avatar_url: null, is_admin: 0 }]);

    const res = await signIn(payload());

    expect(res.headers.location).toBe('/');
    expect(writes()).toHaveLength(1);
    // Subject and email, then the user the row is copied from, while it still
    // holds that email and two-factor is off.
    expect(writes()[0][1]).toEqual(['google-sub-1', 'ada@example.com', 9, 'ada@example.com']);
  });

  it('refuses as two_factor_enabled when two-factor came on before the link INSERT (zero rows)', async () => {
    c2_query.mockResolvedValueOnce([]); // no link
    c2_query.mockResolvedValueOnce([{ id: 9, two_factor_method: 'none' }]); // off when looked up
    c2_query.mockResolvedValueOnce([]); // no Google account on that user
    c2_query.mockResolvedValueOnce({ affectedRows: 0, insertId: 0 }); // on by the INSERT

    const res = await signIn(payload());

    expect(res.headers.location).toBe('/?oauth_error=two_factor_enabled');
    expect(sessionCookie(res)).toBeUndefined();
    expect(generateSessionToken).not.toHaveBeenCalled();
    expect(c2_query).toHaveBeenCalledTimes(4);
  });

  it('refuses an email match that already holds another Google account as identity_conflict', async () => {
    c2_query.mockResolvedValueOnce([]); // this subject is linked to nobody
    c2_query.mockResolvedValueOnce([{ id: 9, two_factor_method: 'none' }]); // user by email
    c2_query.mockResolvedValueOnce([{ id: 31 }]); // that user's Google account, another subject

    const res = await signIn(payload());

    expect(res.headers.location).toBe('/?oauth_error=identity_conflict');
    expect(sessionCookie(res)).toBeUndefined();
    expect(writes()).toEqual([]);
    expect(generateSessionToken).not.toHaveBeenCalled();
  });

  it.each(['totp', 'email'])(
    'refuses an email match with %s two-factor on as two_factor_enabled: no link, no session',
    async (method) => {
      c2_query.mockResolvedValueOnce([]); // this subject is linked to nobody
      c2_query.mockResolvedValueOnce([{ id: 9, two_factor_method: method }]); // user by email

      const res = await signIn(payload());

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/?oauth_error=two_factor_enabled');
      expect(sessionCookie(res)).toBeUndefined();
      expect(writes()).toEqual([]);
      expect(generateSessionToken).not.toHaveBeenCalled();
      expect(c2_query).toHaveBeenCalledTimes(2);
    },
  );

  // Kept on purpose: a linked identity signs in on Google's own sign-in (its
  // MFA included), with no local second factor, even for a user who turned
  // two-factor on after linking. The linked path never reads two_factor_method
  // and mints no challenge; tests/integration/oauth-google-two-factor.test.js
  // proves the same against a real row that has it set.
  it('signs an already-linked identity in with no second-factor challenge', async () => {
    c2_query.mockResolvedValueOnce([{ user_id: 42 }]);
    c2_query.mockResolvedValueOnce([{ id: 42, name: 'ada', avatar_url: null, is_admin: 0 }]);

    const res = await signIn(payload());

    expect(res.headers.location).toBe('/');
    expect(sessionCookie(res)).toMatch(/^sessionToken=mock-session-token/);
    expect(generateSessionToken).toHaveBeenCalledTimes(1);
    const touched = c2_query.mock.calls.map(([sql]) => sql).join('\n');
    expect(touched).not.toMatch(/two_factor|password_reset_tokens/);
    expect(writes()).toEqual([]);
  });

  it('refuses an unknown person as no_account, because auto-create is off without a domain', async () => {
    c2_query.mockResolvedValueOnce([]);
    c2_query.mockResolvedValueOnce([]);

    const res = await signIn(payload());

    expect(res.headers.location).toBe('/?oauth_error=no_account');
    expect(sessionCookie(res)).toBeUndefined();
    expect(writes()).toEqual([]);
    expect(generateSessionToken).not.toHaveBeenCalled();
  });

  it('refuses an unverified email before any query', async () => {
    const res = await signIn(payload({ email_verified: false }));

    expect(res.headers.location).toBe('/?oauth_error=email_not_verified');
    expect(c2_query).not.toHaveBeenCalled();
  });

  it('accepts any hosted domain when none is required', async () => {
    c2_query.mockResolvedValueOnce([{ user_id: 42 }]);
    c2_query.mockResolvedValueOnce([{ id: 42, name: 'ada', avatar_url: null, is_admin: 0 }]);

    const res = await signIn(payload({ hd: 'anywhere.example' }));

    expect(res.headers.location).toBe('/');
  });

  it('still reports a vanished user as user_not_found after the seam resolves', async () => {
    c2_query.mockResolvedValueOnce([{ user_id: 42 }]);
    c2_query.mockResolvedValueOnce([]);

    const res = await signIn(payload());

    expect(res.headers.location).toBe('/?oauth_error=user_not_found');
  });

  it('keeps the state binding: a browser without the cookie never reaches the seam', async () => {
    const start = await request(app).get('/api/oauth/google');
    const state = new URL(start.headers.location).searchParams.get('state');

    const res = await request(app).get(`/api/oauth/google/callback?code=good-code&state=${state}`);

    expect(res.headers.location).toBe('/?oauth_error=invalid_state');
    expect(google.getToken).not.toHaveBeenCalled();
    expect(c2_query).not.toHaveBeenCalled();
  });

  it('maps a failed token exchange and a failed verification as before', async () => {
    google.getToken.mockRejectedValueOnce(new Error('bad code'));
    let start = await request(app).get('/api/oauth/google');
    let state = new URL(start.headers.location).searchParams.get('state');
    let res = await request(app)
      .get(`/api/oauth/google/callback?code=x&state=${state}`)
      .set('Cookie', `${GOOGLE_COOKIE}=${state}`);
    expect(res.headers.location).toBe('/?oauth_error=token_exchange_failed');

    google.getToken.mockResolvedValueOnce({ tokens: { id_token: 'id-token' } });
    google.verifyIdToken.mockRejectedValueOnce(new Error('bad signature'));
    start = await request(app).get('/api/oauth/google');
    state = new URL(start.headers.location).searchParams.get('state');
    res = await request(app)
      .get(`/api/oauth/google/callback?code=x&state=${state}`)
      .set('Cookie', `${GOOGLE_COOKIE}=${state}`);
    expect(res.headers.location).toBe('/?oauth_error=token_verification_failed');
    expect(c2_query).not.toHaveBeenCalled();
  });
});
