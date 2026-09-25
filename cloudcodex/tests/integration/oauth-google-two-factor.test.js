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
 * local challenge, even after its user turns two-factor on. And the refusal
 * holds when two-factor comes on between the seam's lookup and its link
 * INSERT: a transaction turns it on and holds the user row, the seam's plain
 * reads go past, and its INSERT, which copies the row only while two-factor
 * is off, waits and then inserts nothing. Google is the one thing stubbed;
 * the routes, the seam, the session and the database are real.
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
import { openAdminConnection, waitForLockWaits } from './mysql-admin.js';

/** The policies routes/oauth.js builds without and with GOOGLE_OAUTH_DOMAIN. */
const OPEN_POLICY = { requiredHostedDomain: undefined, linkByVerifiedEmail: true, autoCreate: false };
const DOMAIN_POLICY = { requiredHostedDomain: 'example.com', linkByVerifiedEmail: true, autoCreate: true };

const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

/**
 * A user with `method` as two_factor_method. The tests share this file's
 * schema, so every caller passes its own name.
 * @param { String } name
 * @param { 'none'|'email'|'totp'|null } method
 * @returns { Promise<{ id: Number, email: String }> }
 */
async function createUser(name, method) {
  const email = `${name}@example.com`;
  const created = await c2_query(
    'INSERT INTO users (name, email, two_factor_method, totp_secret) VALUES (?, ?, ?, ?)',
    [name, email, method, method === 'totp' ? TOTP_SECRET : null]
  );
  return { id: created.insertId, email };
}

/** How many rows `table` holds for `userId`, through the app's own pool. */
async function rowsFor(table, userId) {
  const [{ n }] = await c2_query(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`, [userId]);
  return Number(n);
}

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

/**
 * Run `sql` against the users table in a transaction left open, the way
 * POST /api/2fa/enable and /api/2fa/totp/confirm write the setting, so the
 * user row stays locked until `commit`. A plain SELECT of the row still reads
 * the committed value without waiting; anything that locks it waits.
 * @param { String } sql
 * @param { Array } params
 */
async function holdUserRow(sql, params) {
  const blocker = await openAdminConnection();
  await blocker.changeUser({ database: process.env.DB_NAME });
  await blocker.query('START TRANSACTION');
  await blocker.query(sql, params);
  return {
    waitForLockWaits: n => waitForLockWaits(blocker, process.env.DB_NAME, n),
    async commit() {
      try {
        await blocker.query('COMMIT');
      } finally {
        await blocker.end();
      }
    },
  };
}

/** A Google sign-in for `user` through the seam, settled rather than thrown. */
function linkAttempt(user, subject) {
  return resolveIdentity(
    { provider: 'google', subject, email: user.email, emailVerified: true },
    OPEN_POLICY
  ).then(
    value => value,
    err => ({ threw: err.code ?? err.message })
  );
}

describe('two-factor turned on between the lookup and the link INSERT', () => {
  it.each([
    ['totp', `UPDATE users SET two_factor_method = 'totp', totp_secret = ? WHERE id = ?`, true],
    ['email', `UPDATE users SET two_factor_method = 'email', totp_secret = NULL WHERE id = ?`, false],
  ])('refuses as two_factor_enabled and writes no row when %s comes on first', async (method, sql, withSecret) => {
    const user = await createUser(`race_${method}`, 'none');
    const hold = await holdUserRow(sql, withSecret ? [TOTP_SECRET, user.id] : [user.id]);

    const attempt = linkAttempt(user, `sub-race-${method}`);
    try {
      // Reaching a lock wait means the lookups already ran and saw two-factor
      // off (on, they refuse without locking anything): the only statement in
      // the ladder that locks the user row is the link INSERT.
      await hold.waitForLockWaits(1);
    } finally {
      await hold.commit();
    }

    expect(await attempt).toEqual({ ok: false, reason: 'two_factor_enabled' });
    expect(await rowsFor('oauth_accounts', user.id)).toBe(0);
    const [row] = await c2_query('SELECT two_factor_method FROM users WHERE id = ?', [user.id]);
    expect(row.two_factor_method).toBe(method);
  });

  // The anchor: the same hold, wait and release, with a change that leaves
  // two-factor off, links. So the refusal above comes from the value the
  // INSERT reads at insert time, not from the interleave itself.
  it('links after the same wait when the held change leaves two-factor off', async () => {
    const user = await createUser('race_off', 'none');
    const hold = await holdUserRow('UPDATE users SET onboarded_at = NOW() WHERE id = ?', [user.id]);

    const attempt = linkAttempt(user, 'sub-race-off');
    try {
      await hold.waitForLockWaits(1);
    } finally {
      await hold.commit();
    }

    expect(await attempt).toEqual({ ok: true, userId: user.id, created: false });
    expect(await rowsFor('oauth_accounts', user.id)).toBe(1);
  });
});
