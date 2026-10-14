/**
 * OIDC-only mode on a real server: the boot admin, invited sign-in, deactivation, and the session switch
 *
 * The unit tests pin the queries; this file proves what MySQL does with them. An OIDC-only boot creates a
 * passwordless admin and seeds its workspace from the admin's row, with the General squad. An invited
 * verified email lands in its squad, and a second sign-in is the identity, not a second user. A revoked
 * invitation links nothing. A deactivated user is refused everywhere and their sessions end. A session
 * minted before the switch to OIDC-only ends, and an oidc session holds.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { c2_query, generateSessionToken, validateAndAutoLogin } from '../../mysql_connect.js';
import { ensureAdminUser, bootstrapInstance } from '../../routes/admin.js';
import { resolveIdentity } from '../../services/identity.js';
import { runMigrations, MIGRATIONS_DIR } from '../../scripts/migrate.js';
import {
  buildSchemaFromInitSql,
  dropSchema,
  openAdminConnection,
  queryVia,
  throwawaySchemaName,
} from './mysql-admin.js';

const ISSUER = 'https://id.example.test';
const POLICY = { linkByVerifiedEmail: true, autoCreate: false };
const OIDC_ONLY_KEYS = ['AUTH_PROVIDERS', 'ADMIN_USERNAME', 'ADMIN_PASSWORD', 'ADMIN_EMAIL'];

const originalEnv = { ...process.env };
let errorSpy;
let tag;

beforeEach(() => {
  // users.name is VARCHAR(32), so a short hex tag keeps every row apart in the schema the file shares.
  tag = randomBytes(4).toString('hex');
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  process.env = { ...originalEnv };
});

/** OIDC-only (no local) for the rest of the test, with no admin password and no admin username. */
function goOidcOnly(adminEmail) {
  for (const k of OIDC_ONLY_KEYS) delete process.env[k];
  process.env.AUTH_PROVIDERS = 'oidc';
  process.env.ADMIN_EMAIL = adminEmail;
}

/** A user with a name and address of this test's own; returns its id. */
async function newUser(label = 'member') {
  const name = `${label}${tag}${Math.floor(Math.random() * 1000)}`;
  const created = await c2_query('INSERT INTO users (name, email) VALUES (?, ?)', [name, `${name}@example.com`]);
  return created.insertId;
}

/** The verified OIDC claims for a subject and address. */
const claims = (subject, email) => ({
  provider: 'oidc', issuer: ISSUER, subject, email, emailVerified: true, name: 'Test',
});

describe('an OIDC-only boot, on a real server', () => {
  it('creates a passwordless admin from ADMIN_EMAIL, and seeds its workspace and General squad', async () => {
    const email = `ops${tag}@example.com`;
    goOidcOnly(email);

    const adminId = await ensureAdminUser();
    expect(adminId).not.toBeNull();

    const [admin] = await c2_query('SELECT name, email, password_hash, is_admin FROM users WHERE id = ?', [adminId]);
    expect(admin.email).toBe(email);
    expect(admin.password_hash).toBeNull();
    expect(Boolean(admin.is_admin)).toBe(true);
    expect(admin.name).toBe(`ops${tag}`);

    expect(await bootstrapInstance(adminId)).toBe(true);

    const [workspace] = await c2_query('SELECT id, name FROM workspaces WHERE owner_id = ?', [adminId]);
    expect(workspace.name).toBe(`ops${tag}'s Workspace`);
    const [squad] = await c2_query('SELECT name FROM squads WHERE workspace_id = ?', [workspace.id]);
    expect(squad.name).toBe('General');
    const [owner] = await c2_query(
      'SELECT role FROM squad_members WHERE user_id = ? AND squad_id IN (SELECT id FROM squads WHERE workspace_id = ?)',
      [adminId, workspace.id]
    );
    expect(owner.role).toBe('owner');
  });

  it('does not promote a member who holds the admin name, and writes no password to the member', async () => {
    const memberName = `ADMIN_OLD_${tag}`.slice(0, 32);
    const memberEmail = `old${tag}@example.com`;
    const created = await c2_query(
      'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
      [memberName, memberEmail, 'member-hash-untouched']
    );
    process.env.AUTH_PROVIDERS = 'oidc';
    process.env.ADMIN_USERNAME = memberName;
    process.env.ADMIN_EMAIL = `new${tag}@example.com`;

    const adminId = await ensureAdminUser();

    expect(adminId).not.toBe(created.insertId);
    const [member] = await c2_query('SELECT is_admin, password_hash, email FROM users WHERE id = ?', [created.insertId]);
    expect(Boolean(member.is_admin)).toBe(false);
    expect(member.password_hash).toBe('member-hash-untouched');
    expect(member.email).toBe(memberEmail);
  });

  it('refuses a non-admin holding ADMIN_EMAIL, and returns null with nothing written', async () => {
    const email = `held${tag}@example.com`;
    const created = await c2_query('INSERT INTO users (name, email) VALUES (?, ?)', [`held${tag}`, email]);
    goOidcOnly(email);

    expect(await ensureAdminUser()).toBeNull();
    const [row] = await c2_query('SELECT is_admin FROM users WHERE id = ?', [created.insertId]);
    expect(Boolean(row.is_admin)).toBe(false);
  });
});

describe('two boots and two sign-ins at once, on a real server', () => {
  it('two concurrent boot admin syncs make one admin, and both answer its id', async () => {
    const email = `race${tag}@example.com`;
    goOidcOnly(email);

    const [a, b] = await Promise.all([ensureAdminUser(), ensureAdminUser()]);

    expect(a).not.toBeNull();
    expect(b).toBe(a);
    const rows = await c2_query('SELECT id FROM users WHERE email = ?', [email]);
    expect(rows).toHaveLength(1);
  });

  it('two concurrent first sign-ins for one subject make one user, and both answer that user', async () => {
    const inviter = await newUser('racer');
    const address = `twice${tag}@example.com`;
    await c2_query(
      `INSERT INTO user_invitations (email, token, invited_by, role, expires_at)
       VALUES (?, ?, ?, 'member', NOW() + INTERVAL 1 DAY)`,
      [address, randomBytes(32).toString('hex'), inviter]
    );

    const [a, b] = await Promise.all([
      resolveIdentity(claims(`twice-${tag}`, address), POLICY),
      resolveIdentity(claims(`twice-${tag}`, address), POLICY),
    ]);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(b.userId).toBe(a.userId);
    const users = await c2_query('SELECT id FROM users WHERE email = ?', [address]);
    expect(users).toHaveLength(1);
  });
});

describe('an invited verified email, on a real server', () => {
  it('lands in its squad, once, and a second sign-in is the same identity', async () => {
    const inviter = await newUser('inviter');
    const squad = await c2_query(
      'INSERT INTO squads (workspace_id, name, created_by) VALUES (NULL, ?, ?)',
      [`Field${tag}`, inviter]
    );
    const invitedEmail = `Invited${tag}@Example.com`;
    await c2_query(
      `INSERT INTO user_invitations (email, token, invited_by, squad_id, role, can_read, can_write, expires_at)
       VALUES (?, ?, ?, ?, 'member', TRUE, TRUE, NOW() + INTERVAL 1 DAY)`,
      [invitedEmail, randomBytes(32).toString('hex'), inviter, squad.insertId]
    );

    const first = await resolveIdentity(claims(`sub-${tag}`, invitedEmail.toLowerCase()), POLICY);
    expect(first).toMatchObject({ ok: true, created: true });

    const [user] = await c2_query('SELECT id, password_hash FROM users WHERE id = ?', [first.userId]);
    expect(user.password_hash).toBeNull();
    const [member] = await c2_query(
      'SELECT role, can_read, can_write FROM squad_members WHERE squad_id = ? AND user_id = ?',
      [squad.insertId, first.userId]
    );
    expect(member).toMatchObject({ role: 'member', can_read: 1, can_write: 1 });
    const [accepted] = await c2_query('SELECT accepted FROM user_invitations WHERE email = ?', [invitedEmail]);
    expect(Boolean(accepted.accepted)).toBe(true);

    const again = await resolveIdentity(claims(`sub-${tag}`, invitedEmail.toLowerCase()), POLICY);
    expect(again).toMatchObject({ ok: true, created: false, userId: first.userId });
    const users = await c2_query('SELECT id FROM users WHERE email = ?', [invitedEmail.toLowerCase()]);
    expect(users).toHaveLength(1);
  });

  it('links nothing for a revoked invitation, and nothing for an uninvited address', async () => {
    const inviter = await newUser('inviter');
    const revokedEmail = `revoked${tag}@example.com`;
    await c2_query(
      `INSERT INTO user_invitations (email, token, invited_by, role, expires_at, accepted)
       VALUES (?, ?, ?, 'member', NOW() + INTERVAL 1 DAY, TRUE)`,
      [revokedEmail, randomBytes(32).toString('hex'), inviter]
    );

    expect(await resolveIdentity(claims(`rev-${tag}`, revokedEmail), POLICY)).toEqual({ ok: false, reason: 'no_account' });
    expect(await resolveIdentity(claims(`none-${tag}`, `nobody${tag}@example.com`), POLICY)).toEqual({ ok: false, reason: 'no_account' });
    const created = await c2_query('SELECT id FROM users WHERE email = ?', [revokedEmail]);
    expect(created).toEqual([]);
  });
});

describe('a deactivated user, on a real server', () => {
  it('is refused at sign-in with nothing touched, and an existing session ends', async () => {
    const userId = await newUser('gone');
    const subject = `gone-${tag}`;
    const identity = await c2_query(
      'INSERT INTO user_identities (user_id, issuer, subject, email_at_link) VALUES (?, ?, ?, ?)',
      [userId, ISSUER, subject, `gone${tag}@example.com`]
    );
    const token = await generateSessionToken({ id: userId }, null, null, {
      provider: 'oidc', identityId: identity.insertId, providerSid: 'sid-1', ttlHours: 1,
    });
    expect(await validateAndAutoLogin(token)).not.toBeNull();

    await c2_query('UPDATE users SET deactivated_at = NOW() WHERE id = ?', [userId]);

    expect(await validateAndAutoLogin(token)).toBeNull();
    expect(await resolveIdentity(claims(subject, `gone${tag}@example.com`), POLICY))
      .toEqual({ ok: false, reason: 'account_deactivated' });
    const [row] = await c2_query('SELECT last_login_at FROM user_identities WHERE id = ?', [identity.insertId]);
    expect(row.last_login_at).toBeNull();
  });
});

describe('the switch to OIDC-only mode, on a real server', () => {
  it('ends a local session, keeps an oidc session, and restores a local one when local is back on', async () => {
    const userId = await newUser('switch');
    const local = await generateSessionToken({ id: userId });
    const identity = await c2_query(
      'INSERT INTO user_identities (user_id, issuer, subject, email_at_link) VALUES (?, ?, ?, ?)',
      [userId, ISSUER, `switch-${tag}`, `switch${tag}@example.com`]
    );
    const oidc = await generateSessionToken({ id: userId }, null, null, {
      provider: 'oidc', identityId: identity.insertId, providerSid: 'sid-2', ttlHours: 1,
    });

    expect(await validateAndAutoLogin(local)).not.toBeNull();

    process.env.AUTH_PROVIDERS = 'oidc';
    expect(await validateAndAutoLogin(local)).toBeNull();
    expect(await validateAndAutoLogin(oidc)).not.toBeNull();

    delete process.env.AUTH_PROVIDERS;
    expect(await validateAndAutoLogin(local)).not.toBeNull();
  });
});

describe('the oidc-only-mode migration, on a fresh init.sql build', () => {
  it('is adopted by --adopt-fresh-install, and the deactivated_at column exists', async () => {
    const schema = throwawaySchemaName();
    const conn = await openAdminConnection();
    try {
      await buildSchemaFromInitSql(conn, schema);
      const query = queryVia(conn);
      const adopted = await runMigrations({
        query,
        dir: MIGRATIONS_DIR,
        adoptFreshInstall: true,
        log: () => {},
      });
      expect(adopted.pending).toEqual([]);
      expect(adopted.baselined).toContain('2026-10-12-user-deactivation.sql');
      const [col] = await query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'deactivated_at'`,
        [schema]
      );
      expect(col).toBeDefined();
    } finally {
      await dropSchema(conn, schema);
      await conn.end();
    }
  });
});
