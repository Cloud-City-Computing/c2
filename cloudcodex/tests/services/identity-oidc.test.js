/**
 * Tests for the oidc branch of services/identity.js, the ladder for a verified (issuer, subject)
 *
 * Every step issues its SQL in a fixed order, and the assertions pin the statements and their
 * parameters call by call. A refusal is checked to have written nothing. Two-factor is read by the
 * link-by-email rung only: an identity already linked signs in with no local second factor, whatever
 * its user's two_factor_method holds. The live-MySQL proof of the conditional INSERT and the
 * unique-key race is tests/integration/identities.test.js.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { c2_query } from '../../mysql_connect.js';
import { resolveIdentity, parseAuthProviders } from '../../services/identity.js';
import { resetMocks } from '../helpers.js';

const ISSUER = 'https://id.example.test';
const SUBJECT = 'sub-0192f5a0';

const HIT_SQL = 'SELECT id, user_id FROM user_identities WHERE issuer = ? AND subject = ? LIMIT 1';
const USER_EMAIL_SQL = 'SELECT email FROM users WHERE id = ? LIMIT 1';
const EMAIL_HOLDER_SQL = 'SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id <> ? LIMIT 1';
const UPDATE_EMAIL_SQL = 'UPDATE users SET email = ? WHERE id = ?';
const TOUCH_SQL = 'UPDATE user_identities SET last_login_at = NOW() WHERE id = ?';
const EMAIL_LOOKUP_SQL = 'SELECT id, email, two_factor_method FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1';
const SAME_ISSUER_SQL = 'SELECT id FROM user_identities WHERE user_id = ? AND issuer = ? LIMIT 1';
const LINK_SQL =
  'INSERT INTO user_identities (user_id, issuer, subject, email_at_link) ' +
  'SELECT id, ?, ?, ? FROM users WHERE id = ? AND LOWER(email) = LOWER(?) ' +
  "AND (two_factor_method IS NULL OR two_factor_method = 'none') FOR SHARE";

const POLICY = { linkByVerifiedEmail: true, autoCreate: false };

function oidcClaims(overrides = {}) {
  return {
    provider: 'oidc',
    issuer: ISSUER,
    subject: SUBJECT,
    email: 'ada@example.com',
    emailVerified: true,
    name: 'Ada',
    ...overrides,
  };
}

function squash(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

function sqlCalls() {
  return c2_query.mock.calls.map(([sql, params]) => [squash(sql), params]);
}

function writes() {
  return sqlCalls().filter(([sql]) => /^(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql));
}

function duplicateKeyError(key) {
  const message = `Duplicate entry 'x' for key '${key}'`;
  return Object.assign(new Error(message), {
    code: 'ER_DUP_ENTRY',
    errno: 1062,
    sqlState: '23000',
    sqlMessage: message,
  });
}

describe('resolveIdentity (oidc)', () => {
  beforeEach(() => {
    resetMocks();
  });

  describe('before any query', () => {
    it('refuses an unverified email and reads nothing', async () => {
      const result = await resolveIdentity(oidcClaims({ emailVerified: false }), POLICY);
      expect(result).toEqual({ ok: false, reason: 'email_not_verified' });
      expect(c2_query).not.toHaveBeenCalled();
    });
  });

  describe('step 1: an identity already linked', () => {
    it('signs in the user, touching last_login_at, when the email matches', async () => {
      c2_query
        .mockResolvedValueOnce([{ id: 7, user_id: 42 }]) // HIT
        .mockResolvedValueOnce([{ email: 'ada@example.com' }]) // USER_EMAIL
        .mockResolvedValueOnce({ affectedRows: 1 }); // TOUCH

      const result = await resolveIdentity(oidcClaims(), POLICY);

      expect(result).toEqual({ ok: true, userId: 42, created: false, identityId: 7 });
      expect(sqlCalls().map(([sql]) => sql)).toEqual([HIT_SQL, USER_EMAIL_SQL, TOUCH_SQL]);
      expect(sqlCalls()[0][1]).toEqual([ISSUER, SUBJECT]);
      expect(sqlCalls()[2][1]).toEqual([7]);
    });

    it('follows an issuer-side email change when no other row holds the address', async () => {
      c2_query
        .mockResolvedValueOnce([{ id: 7, user_id: 42 }])
        .mockResolvedValueOnce([{ email: 'old@example.com' }])
        .mockResolvedValueOnce([]) // EMAIL_HOLDER: nobody
        .mockResolvedValueOnce({ affectedRows: 1 }) // UPDATE_EMAIL
        .mockResolvedValueOnce({ affectedRows: 1 }); // TOUCH

      const result = await resolveIdentity(oidcClaims({ email: 'new@example.com' }), POLICY);

      expect(result).toEqual({ ok: true, userId: 42, created: false, identityId: 7 });
      expect(sqlCalls().map(([sql]) => sql)).toEqual([
        HIT_SQL,
        USER_EMAIL_SQL,
        EMAIL_HOLDER_SQL,
        UPDATE_EMAIL_SQL,
        TOUCH_SQL,
      ]);
      expect(sqlCalls()[2][1]).toEqual(['new@example.com', 42]);
      expect(sqlCalls()[3][1]).toEqual(['new@example.com', 42]);
    });

    it('refuses email_conflict, and writes nothing, when another row holds the new address', async () => {
      c2_query
        .mockResolvedValueOnce([{ id: 7, user_id: 42 }])
        .mockResolvedValueOnce([{ email: 'old@example.com' }])
        .mockResolvedValueOnce([{ id: 99 }]); // EMAIL_HOLDER: someone else

      const result = await resolveIdentity(oidcClaims({ email: 'taken@example.com' }), POLICY);

      expect(result).toEqual({ ok: false, reason: 'email_conflict' });
      expect(writes()).toEqual([]);
    });

    it('signs in a linked user whose two-factor is on, with no local challenge', async () => {
      c2_query
        .mockResolvedValueOnce([{ id: 7, user_id: 42 }])
        .mockResolvedValueOnce([{ email: 'ada@example.com' }])
        .mockResolvedValueOnce({ affectedRows: 1 });

      const result = await resolveIdentity(oidcClaims(), { ...POLICY, linkByVerifiedEmail: false });

      expect(result).toEqual({ ok: true, userId: 42, created: false, identityId: 7 });
      expect(sqlCalls().map(([sql]) => sql)).not.toContain(EMAIL_LOOKUP_SQL);
    });
  });

  describe('step 2: link by verified email', () => {
    it('refuses two_factor_enabled for an email match with totp, and inserts nothing', async () => {
      c2_query
        .mockResolvedValueOnce([]) // HIT: none
        .mockResolvedValueOnce([{ id: 42, email: 'ada@example.com', two_factor_method: 'totp' }]);

      const result = await resolveIdentity(oidcClaims(), POLICY);

      expect(result).toEqual({ ok: false, reason: 'two_factor_enabled' });
      expect(sqlCalls().map(([sql]) => sql)).toEqual([HIT_SQL, EMAIL_LOOKUP_SQL]);
      expect(writes()).toEqual([]);
    });

    it('refuses two_factor_enabled for an email match with email two-factor', async () => {
      c2_query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 42, email: 'ada@example.com', two_factor_method: 'email' }]);

      expect(await resolveIdentity(oidcClaims(), POLICY)).toEqual({ ok: false, reason: 'two_factor_enabled' });
      expect(writes()).toEqual([]);
    });

    it("links an email match with two-factor 'none', through the conditional INSERT", async () => {
      c2_query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 42, email: 'ada@example.com', two_factor_method: 'none' }])
        .mockResolvedValueOnce([]) // SAME_ISSUER: none
        .mockResolvedValueOnce({ affectedRows: 1, insertId: 55 }); // LINK

      const result = await resolveIdentity(oidcClaims(), POLICY);

      expect(result).toEqual({ ok: true, userId: 42, created: false, identityId: 55 });
      expect(sqlCalls().map(([sql]) => sql)).toEqual([HIT_SQL, EMAIL_LOOKUP_SQL, SAME_ISSUER_SQL, LINK_SQL]);
      expect(sqlCalls()[3][1]).toEqual([ISSUER, SUBJECT, 'ada@example.com', 42, 'ada@example.com']);
    });

    it('links an email match with two-factor NULL', async () => {
      c2_query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 42, email: 'ada@example.com', two_factor_method: null }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce({ affectedRows: 1, insertId: 56 });

      expect(await resolveIdentity(oidcClaims(), POLICY)).toEqual({ ok: true, userId: 42, created: false, identityId: 56 });
    });

    it('refuses two_factor_enabled, and nothing else, when the conditional INSERT affects no row', async () => {
      c2_query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 42, email: 'ada@example.com', two_factor_method: 'none' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce({ affectedRows: 0 });

      expect(await resolveIdentity(oidcClaims(), POLICY)).toEqual({ ok: false, reason: 'two_factor_enabled' });
    });

    it('refuses identity_conflict when this user already holds another subject at this issuer', async () => {
      c2_query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 42, email: 'ada@example.com', two_factor_method: 'none' }])
        .mockResolvedValueOnce([{ id: 3 }]); // SAME_ISSUER: a different subject

      const result = await resolveIdentity(oidcClaims(), POLICY);

      expect(result).toEqual({ ok: false, reason: 'identity_conflict' });
      expect(writes()).toEqual([]);
    });

    it('answers identity_conflict when the unique key refuses a second link at the issuer', async () => {
      c2_query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 42, email: 'ada@example.com', two_factor_method: 'none' }])
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(duplicateKeyError('user_identities.uq_user_identities_user_issuer'));

      expect(await resolveIdentity(oidcClaims(), POLICY)).toEqual({ ok: false, reason: 'identity_conflict' });
    });

    it('checks two-factor before identity_conflict, so a conflicting row cannot hide it', async () => {
      c2_query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 42, email: 'ada@example.com', two_factor_method: 'totp' }]);

      expect(await resolveIdentity(oidcClaims(), POLICY)).toEqual({ ok: false, reason: 'two_factor_enabled' });
      expect(sqlCalls().map(([sql]) => sql)).not.toContain(SAME_ISSUER_SQL);
    });

    it('refuses email_conflict when linking by email is off and an account holds the address', async () => {
      c2_query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 42, email: 'ada@example.com', two_factor_method: 'none' }]);

      expect(await resolveIdentity(oidcClaims(), { ...POLICY, linkByVerifiedEmail: false })).toEqual({
        ok: false,
        reason: 'email_conflict',
      });
      expect(writes()).toEqual([]);
    });
  });

  describe('step 4: nothing matches', () => {
    it('refuses no_account when no identity and no email match exist, and autoCreate is off', async () => {
      c2_query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      expect(await resolveIdentity(oidcClaims(), POLICY)).toEqual({ ok: false, reason: 'no_account' });
      expect(writes()).toEqual([]);
    });
  });
});

describe('parseAuthProviders with oidc', () => {
  const KEYS = ['AUTH_PROVIDERS', 'OIDC_ISSUER_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
  let saved;

  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('offers oidc by default when an issuer is set, and local alone when not', () => {
    expect([...parseAuthProviders()]).toEqual(['local']);
    process.env.OIDC_ISSUER_URL = 'https://id.example.test';
    expect([...parseAuthProviders()]).toEqual(['local', 'oidc']);
  });

  it('accepts an explicit list that includes a configured oidc', () => {
    process.env.OIDC_ISSUER_URL = 'https://id.example.test';
    process.env.AUTH_PROVIDERS = 'local,oidc';
    expect([...parseAuthProviders()]).toEqual(['local', 'oidc']);
  });

  it('refuses a list that leaves out a configured issuer, which would still be offered', () => {
    process.env.OIDC_ISSUER_URL = 'https://id.example.test';
    process.env.AUTH_PROVIDERS = 'local';
    expect(() => parseAuthProviders()).toThrow(/does not list oidc/);
  });
});
