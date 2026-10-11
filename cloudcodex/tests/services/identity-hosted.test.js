/**
 * The OIDC rungs that W6-CDX-8 adds: an invitation binds a verified email, and a deactivated user is refused
 *
 * Step 3 of the oidc ladder: an open invitation for the verified email creates the user, in one transaction,
 * with the invitation's squad and flags, and marks it accepted. Its conditional UPDATE is checked, so an
 * invitation revoked in the window answers no_account with nothing linked. A deactivated user is refused as
 * account_deactivated on the identity rung, the email rung, and the Google rungs, before any write. The
 * live-MySQL proof of the transaction is tests/integration/identities.test.js.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { c2_query } from '../../mysql_connect.js';
import { resolveIdentity } from '../../services/identity.js';
import { resetMocks } from '../helpers.js';

const ISSUER = 'https://id.example.test';
const SUBJECT = 'sub-0192f5a0';
const EMAIL = 'ada@example.com';
const POLICY = { linkByVerifiedEmail: true, autoCreate: false };
const DEACTIVATED = new Date('2026-10-01T00:00:00Z');

const oidcClaims = (overrides = {}) => ({
  provider: 'oidc', issuer: ISSUER, subject: SUBJECT, email: EMAIL, emailVerified: true, name: 'Ada', ...overrides,
});

const squash = (sql) => sql.replace(/\s+/g, ' ').trim();
const sqlCalls = () => c2_query.mock.calls.map(([sql, params]) => [squash(sql), params]);
const writes = () => sqlCalls().filter(([sql]) => /^(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql));

/** An invitation as the query returns it: squad, role and flags. */
const INVITATION = {
  id: 3,
  squad_id: 9,
  role: 'member',
  can_read: 1,
  can_write: 1,
  can_create_log: 0,
  can_create_archive: 0,
  can_manage_members: 0,
  can_delete_version: 0,
  can_publish: 0,
};

describe('resolveIdentity (oidc) binds an invitation on a verified email', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('creates the user with the derived name, no password, the squad and flags, and the identity, in one transaction', async () => {
    c2_query
      .mockResolvedValueOnce([])            // identity lookup: none
      .mockResolvedValueOnce([])            // email lookup: none
      .mockResolvedValueOnce([INVITATION])  // open invitation for the verified email
      .mockResolvedValueOnce([])            // deriveUniqueUsername: 'ada' is free
      .mockResolvedValueOnce({ insertId: 77 })            // INSERT users
      .mockResolvedValueOnce({ insertId: 1 })             // INSERT permissions
      .mockResolvedValueOnce({ affectedRows: 1 })         // UPDATE user_invitations accepted
      .mockResolvedValueOnce({ insertId: 5 })             // INSERT squad_members
      .mockResolvedValueOnce({ insertId: 88 });           // INSERT user_identities

    expect(await resolveIdentity(oidcClaims(), POLICY)).toEqual({
      ok: true, userId: 77, created: true, identityId: 88,
    });

    const sql = sqlCalls();
    const invitationLookup = sql.find(([s]) => /FROM user_invitations/.test(s));
    expect(invitationLookup[0]).toMatch(/LOWER\(email\) COLLATE utf8mb4_bin = LOWER\(\?\) COLLATE utf8mb4_bin AND accepted = FALSE AND expires_at > NOW\(\)/);
    expect(invitationLookup[1]).toEqual([EMAIL]);

    const insertUser = sql.find(([s]) => /^INSERT INTO users/.test(s));
    expect(insertUser[0]).not.toMatch(/password_hash\s*,/);
    expect(insertUser[1]).toEqual(['ada', EMAIL]);

    expect(sql.some(([s, p]) => /INSERT INTO permissions/.test(s) && p[0] === 77)).toBe(true);
    const accepted = sql.find(([s]) => /UPDATE user_invitations/.test(s));
    expect(accepted[1]).toEqual([3]);
    const member = sql.find(([s]) => /INSERT INTO squad_members/.test(s));
    expect(member[1][0]).toBe(9);
    expect(member[1][1]).toBe(77);
    const identity = sql.find(([s]) => /INSERT INTO user_identities/.test(s));
    expect(identity[1]).toEqual([77, ISSUER, SUBJECT, EMAIL, EMAIL]);
  });

  it('answers no_account, linking nothing, when the invitation was revoked before its conditional UPDATE', async () => {
    c2_query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([INVITATION])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ insertId: 77 })
      .mockResolvedValueOnce({ insertId: 1 })
      .mockResolvedValueOnce({ affectedRows: 0 }); // revoked or accepted in the window

    expect(await resolveIdentity(oidcClaims(), POLICY)).toEqual({ ok: false, reason: 'no_account' });
    expect(writes().some(([s]) => /INSERT INTO squad_members|INSERT INTO user_identities/.test(s))).toBe(false);
  });

  it('adds no squad membership for an invitation that carries no squad', async () => {
    c2_query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...INVITATION, squad_id: null }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ insertId: 77 })
      .mockResolvedValueOnce({ insertId: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ insertId: 88 });

    expect(await resolveIdentity(oidcClaims(), POLICY)).toMatchObject({ ok: true, userId: 77 });
    expect(writes().some(([s]) => /INSERT INTO squad_members/.test(s))).toBe(false);
  });

  it('answers no_account without looking for an invitation when the address is unverified', async () => {
    expect(await resolveIdentity(oidcClaims({ emailVerified: false }), POLICY)).toEqual({ ok: false, reason: 'email_not_verified' });
    expect(c2_query).not.toHaveBeenCalled();
  });

  it('does not let an invitation for an accented address admit its unaccented twin', async () => {
    // users.email and user_invitations.email use the default, accent-insensitive collation, so a plain
    // LOWER(email) = LOWER(?) would match josé@ against jose@. The binary comparison sees two mailboxes,
    // and the verified jose@ finds no invitation: no_account, with nothing written.
    c2_query
      .mockResolvedValueOnce([])   // identity lookup: none
      .mockResolvedValueOnce([])   // email lookup: none
      .mockResolvedValueOnce([]);  // invitation lookup: the josé@ invitation does not match jose@

    expect(await resolveIdentity(oidcClaims({ email: 'jose@example.com' }), POLICY)).toEqual({ ok: false, reason: 'no_account' });
    const invitationLookup = sqlCalls().find(([s]) => /FROM user_invitations/.test(s));
    expect(invitationLookup[1]).toEqual(['jose@example.com']);
    expect(writes()).toEqual([]);
  });

  it('refuses email_conflict before looking for an invitation, when linking by email is off', async () => {
    c2_query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 4, email: EMAIL, two_factor_method: 'none', deactivated_at: null }]);

    expect(await resolveIdentity(oidcClaims(), { linkByVerifiedEmail: false, autoCreate: false })).toEqual({ ok: false, reason: 'email_conflict' });
    expect(sqlCalls().some(([s]) => /FROM user_invitations/.test(s))).toBe(false);
  });
});

describe('resolveIdentity refuses a deactivated user as account_deactivated, before any write', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('on the oidc identity rung', async () => {
    c2_query.mockResolvedValueOnce([{ id: 6, user_id: 12, deactivated_at: DEACTIVATED }]);

    expect(await resolveIdentity(oidcClaims(), POLICY)).toEqual({ ok: false, reason: 'account_deactivated' });
    expect(writes()).toEqual([]);
  });

  it('on the oidc email rung, when the matched account is deactivated', async () => {
    c2_query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 12, email: EMAIL, two_factor_method: 'none', deactivated_at: DEACTIVATED }]);

    expect(await resolveIdentity(oidcClaims(), POLICY)).toEqual({ ok: false, reason: 'account_deactivated' });
    expect(writes()).toEqual([]);
  });

  it('on the Google linked-account rung', async () => {
    c2_query.mockResolvedValueOnce([{ user_id: 12, deactivated_at: DEACTIVATED }]);

    expect(await resolveIdentity({
      provider: 'google', subject: 'google-sub-123', email: EMAIL, emailVerified: true,
    }, { requiredHostedDomain: undefined, linkByVerifiedEmail: true, autoCreate: false })).toEqual({ ok: false, reason: 'account_deactivated' });
    expect(writes()).toEqual([]);
  });

  it('on the Google email rung, when the matched account is deactivated', async () => {
    c2_query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 12, two_factor_method: 'none', deactivated_at: DEACTIVATED }]);

    expect(await resolveIdentity({
      provider: 'google', subject: 'google-sub-123', email: EMAIL, emailVerified: true,
    }, { linkByVerifiedEmail: true, autoCreate: false })).toEqual({ ok: false, reason: 'account_deactivated' });
    expect(writes()).toEqual([]);
  });
});
