/**
 * Google sign-in and local two-factor authentication, against a live MySQL server
 *
 * Linking by verified email must never reach an account that has two-factor
 * authentication on: resolveIdentity refuses it as two_factor_enabled and
 * writes nothing, and the callback redirects without a session. The mocked
 * tests pin that call by call, but only a real schema proves the refusal reads
 * the real column (an ENUM with a default) and that no oauth_accounts or
 * sessions row appears. The other half of the rule is proved here too: an
 * identity already linked keeps signing in on Google's own sign-in, with no
 * local challenge, even after its user turns two-factor on. The interleaves
 * that change the user row between the seam's lookup and its link INSERT live
 * in google-link-races.js and run here at the server's default isolation (and
 * under READ COMMITTED in oauth-google-two-factor-read-committed.test.js).
 * Google is the one thing stubbed; the routes, the seam, the session and the
 * database are real.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// routes/oauth.js reads the Google client settings when it is imported.
const google = vi.hoisted(() => {
  process.env.GOOGLE_CLIENT_ID = 'it-google-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'it-google-client-secret';
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
import { c2_query } from '../../mysql_connect.js';
import { resolveIdentity } from '../../services/identity.js';
import { OPEN_POLICY, TOTP_SECRET, createUser, describeLinkRaces, rowsFor } from './google-link-races.js';

/** The policy routes/oauth.js builds when GOOGLE_OAUTH_DOMAIN is 'example.com'. */
const DOMAIN_POLICY = { requiredHostedDomain: 'example.com', linkByVerifiedEmail: true, autoCreate: true };

/** Starts a Google sign-in and completes it in the same browser, as `sub` / `email`. */
async function signIn(sub, email) {
  google.getToken.mockResolvedValueOnce({ tokens: { id_token: 'id-token' } });
  google.verifyIdToken.mockResolvedValueOnce({
    getPayload: () => ({ sub, email, email_verified: true, hd: 'example.com' }),
  });
  const start = await request(app).get('/api/oauth/google');
  const state = new URL(start.headers.location).searchParams.get('state');
  return request(app)
    .get(`/api/oauth/google/callback?code=good-code&state=${state}`)
    .set('Cookie', `oauth_state_google=${state}`);
}

function sessionCookie(res) {
  return (res.headers['set-cookie'] || []).find(c => c.startsWith('sessionToken='));
}

describe('an account with two-factor on and no Google link yet', () => {
  beforeEach(() => {
    google.getToken.mockReset();
    google.verifyIdToken.mockReset();
  });

  it.each(['totp', 'email'])(
    'resolveIdentity refuses it as two_factor_enabled under both policies, writing no link (%s)',
    async (method) => {
      const user = await createUser(`seam_${method}`, method);
      const claims = { provider: 'google', subject: `sub-seam-${method}`, email: user.email, emailVerified: true, hostedDomain: 'example.com' };

      expect(await resolveIdentity(claims, OPEN_POLICY)).toEqual({ ok: false, reason: 'two_factor_enabled' });
      expect(await resolveIdentity(claims, DOMAIN_POLICY)).toEqual({ ok: false, reason: 'two_factor_enabled' });
      expect(await rowsFor('oauth_accounts', user.id)).toBe(0);
    }
  );

  it.each(['totp', 'email'])(
    'the callback redirects to /?oauth_error=two_factor_enabled with no link and no session (%s)',
    async (method) => {
      const user = await createUser(`route_${method}`, method);

      const res = await signIn(`sub-route-${method}`, user.email);

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/?oauth_error=two_factor_enabled');
      expect(sessionCookie(res)).toBeUndefined();
      expect(await rowsFor('oauth_accounts', user.id)).toBe(0);
      expect(await rowsFor('sessions', user.id)).toBe(0);
      const [row] = await c2_query('SELECT two_factor_method FROM users WHERE id = ?', [user.id]);
      expect(row.two_factor_method).toBe(method);
    }
  );

  // The anchor that keeps the two refusals above honest: the same schema, flow
  // and stub do link and sign in an account whose two-factor is off, so the
  // refusal comes from the column and not from a harness that cannot link.
  it('links and signs in an account whose two-factor is off, through the same callback', async () => {
    const user = await createUser('route_none', 'none');

    const res = await signIn('sub-route-none', user.email);

    expect(res.headers.location).toBe('/');
    expect(sessionCookie(res)).toMatch(/^sessionToken=/);
    expect(await rowsFor('oauth_accounts', user.id)).toBe(1);
    expect(await rowsFor('sessions', user.id)).toBe(1);
  });

  it('treats an explicit NULL two_factor_method as off, as POST /api/login does', async () => {
    const user = await createUser('seam_null', null);

    const result = await resolveIdentity(
      { provider: 'google', subject: 'sub-seam-null', email: user.email, emailVerified: true },
      OPEN_POLICY
    );

    expect(result).toEqual({ ok: true, userId: user.id, created: false });
    expect(await rowsFor('oauth_accounts', user.id)).toBe(1);
  });
});

// Kept on purpose, not an oversight: once an identity is linked, Google's own
// sign-in, its MFA included, governs the account.
describe('an identity already linked, whose user turns two-factor on afterwards', () => {
  beforeEach(() => {
    google.getToken.mockReset();
    google.verifyIdToken.mockReset();
  });

  it('still signs in with Google, gets a session, and is never challenged', async () => {
    const user = await createUser('linked_then_totp', 'none');
    await c2_query(
      `INSERT INTO oauth_accounts (user_id, provider, provider_user_id, provider_email) VALUES (?, 'google', ?, ?)`,
      [user.id, 'sub-linked-then-totp', user.email]
    );
    await c2_query(`UPDATE users SET two_factor_method = 'totp', totp_secret = ? WHERE id = ?`, [TOTP_SECRET, user.id]);

    const res = await signIn('sub-linked-then-totp', user.email);

    expect(res.headers.location).toBe('/');
    expect(sessionCookie(res)).toMatch(/^sessionToken=/);
    expect(await rowsFor('sessions', user.id)).toBe(1);
    // No second-factor challenge was minted: no login handoff token, no code.
    expect(await rowsFor('password_reset_tokens', user.id)).toBe(0);
    expect(await rowsFor('two_factor_codes', user.id)).toBe(0);
    expect(await rowsFor('oauth_accounts', user.id)).toBe(1);
  });
});

describeLinkRaces('the server default isolation');
