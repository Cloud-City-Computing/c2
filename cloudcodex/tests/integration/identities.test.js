/**
 * user_identities and session provenance, against a live MySQL server
 *
 * The unit tests cannot see what MySQL enforces: that a subject differing only
 * in case is a different identity (utf8mb4_bin), that one user holds one
 * identity per issuer, that deleting a user takes their identities and the
 * sessions they signed in with, and that a CHECK pairing identity_id with
 * auth_provider is refused by MySQL itself (which is why that rule lives in
 * generateSessionToken and not in the schema). The last describe runs the
 * migration file for real, on a fresh init.sql build with adoption on.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { c2_query } from '../../mysql_connect.js';
import { runMigrations, MIGRATIONS_DIR } from '../../scripts/migrate.js';
import {
  buildSchemaFromInitSql,
  dropSchema,
  openAdminConnection,
  queryVia,
  throwawaySchemaName,
} from './mysql-admin.js';

const silent = () => {};

let seq = 0;

/** A fresh user; returns its id. */
async function newUser() {
  seq += 1;
  const name = `ident${seq}_${Date.now() % 100000}`;
  const created = await c2_query('INSERT INTO users (name, email) VALUES (?, ?)', [name, `${name}@example.com`]);
  return created.insertId;
}

/** The mysql2 error a rejected promise carries, or null when it resolved. */
async function rejection(promise) {
  try {
    await promise;
    return null;
  } catch (err) {
    return err;
  }
}

/** One identity row; returns its id. */
async function newIdentity(userId, issuer, subject) {
  const row = await c2_query(
    'INSERT INTO user_identities (user_id, issuer, subject, email_at_link) VALUES (?, ?, ?, ?)',
    [userId, issuer, subject, `${subject}@example.com`]
  );
  return row.insertId;
}

const ISSUER = 'https://id.example.test';

describe('user_identities, on a real server', () => {
  it('treats a subject that differs only in case as a different identity', async () => {
    const userId = await newUser();
    const upper = await newIdentity(userId, ISSUER, 'Ab');
    const lower = await newIdentity(userId, `${ISSUER}/other`, 'ab');
    expect(upper).not.toBe(lower);

    const rows = await c2_query('SELECT subject FROM user_identities WHERE subject IN (?, ?) ORDER BY subject', [
      'Ab',
      'ab',
    ]);
    expect(rows.map(r => r.subject)).toEqual(['Ab', 'ab']);
  });

  it('refuses a second identity at the same issuer for one user, by name', async () => {
    const userId = await newUser();
    await newIdentity(userId, ISSUER, 'first-subject');

    const err = await rejection(newIdentity(userId, ISSUER, 'second-subject'));
    expect(err?.code).toBe('ER_DUP_ENTRY');
    expect(err.sqlMessage).toContain('uq_user_identities_user_issuer');
  });

  it('refuses the same (issuer, subject) for two users', async () => {
    const first = await newUser();
    const second = await newUser();
    await newIdentity(first, ISSUER, 'shared-subject');

    const err = await rejection(newIdentity(second, ISSUER, 'shared-subject'));
    expect(err?.code).toBe('ER_DUP_ENTRY');
    expect(err.sqlMessage).toContain('uq_user_identities_issuer_subject');
  });

  it('accepts auth_provider = oidc, and an OIDC session names its identity', async () => {
    const userId = await newUser();
    const identityId = await newIdentity(userId, ISSUER, 'oidc-session-subject');
    const digest = 'a'.repeat(64);

    await c2_query(
      `INSERT INTO sessions (user_id, id, auth_provider, identity_id, provider_sid, created_at, expires_at)
       VALUES (?, ?, 'oidc', ?, 'sid-1', NOW(), DATE_ADD(NOW(), INTERVAL 1 DAY))`,
      [userId, digest, identityId]
    );

    const [row] = await c2_query('SELECT auth_provider, identity_id, provider_sid FROM sessions WHERE id = ?', [digest]);
    expect(row).toEqual({ auth_provider: 'oidc', identity_id: identityId, provider_sid: 'sid-1' });
  });

  it('still refuses an auth_provider outside the three flows', async () => {
    const userId = await newUser();
    const err = await rejection(
      c2_query(
        `INSERT INTO sessions (user_id, id, auth_provider, created_at, expires_at)
         VALUES (?, ?, 'saml', NOW(), DATE_ADD(NOW(), INTERVAL 1 DAY))`,
        [userId, 'b'.repeat(64)]
      )
    );
    expect(err?.code).toBe('ER_CHECK_CONSTRAINT_VIOLATED');
  });

  it('deletes a user\'s identities and the sessions signed in through them', async () => {
    const userId = await newUser();
    const identityId = await newIdentity(userId, ISSUER, 'cascade-subject');
    const digest = 'c'.repeat(64);
    await c2_query(
      `INSERT INTO sessions (user_id, id, auth_provider, identity_id, created_at, expires_at)
       VALUES (?, ?, 'oidc', ?, NOW(), DATE_ADD(NOW(), INTERVAL 1 DAY))`,
      [userId, digest, identityId]
    );

    await c2_query('DELETE FROM users WHERE id = ?', [userId]);

    const identities = await c2_query('SELECT id FROM user_identities WHERE id = ?', [identityId]);
    const sessions = await c2_query('SELECT id FROM sessions WHERE id = ?', [digest]);
    expect(identities).toEqual([]);
    expect(sessions).toEqual([]);
  });

  it('deletes a session when its identity is deleted', async () => {
    const userId = await newUser();
    const identityId = await newIdentity(userId, ISSUER, 'identity-delete-subject');
    const digest = 'd'.repeat(64);
    await c2_query(
      `INSERT INTO sessions (user_id, id, auth_provider, identity_id, created_at, expires_at)
       VALUES (?, ?, 'oidc', ?, NOW(), DATE_ADD(NOW(), INTERVAL 1 DAY))`,
      [userId, digest, identityId]
    );

    await c2_query('DELETE FROM user_identities WHERE id = ?', [identityId]);

    expect(await c2_query('SELECT id FROM sessions WHERE id = ?', [digest])).toEqual([]);
  });

  it('refuses an oidc session without an identity, and an identity on a local session', async () => {
    const userId = await newUser();
    const identityId = await newIdentity(userId, ISSUER, 'pairing-subject');

    const oidcWithout = await rejection(
      c2_query(
        `INSERT INTO sessions (user_id, id, auth_provider, created_at, expires_at)
         VALUES (?, ?, 'oidc', NOW(), DATE_ADD(NOW(), INTERVAL 1 DAY))`,
        [userId, 'e'.repeat(64)]
      )
    );
    expect(oidcWithout?.code).toBe('ER_CHECK_CONSTRAINT_VIOLATED');

    const localWith = await rejection(
      c2_query(
        `INSERT INTO sessions (user_id, id, auth_provider, identity_id, created_at, expires_at)
         VALUES (?, ?, 'local', ?, NOW(), DATE_ADD(NOW(), INTERVAL 1 DAY))`,
        [userId, 'f'.repeat(64), identityId]
      )
    );
    expect(localWith?.code).toBe('ER_CHECK_CONSTRAINT_VIOLATED');
  });

  it('records the referential actions MySQL refuses in a CHECK (error 3823)', async () => {
    // The CHECK on identity_id is allowed under ON DELETE CASCADE. MySQL 8.4
    // refuses it only under ON UPDATE CASCADE or ON DELETE SET NULL, which is
    // measured here so a future reader knows where the line is.
    const err = await rejection(
      c2_query(
        `CREATE TABLE scratch_pairing_check (
           id INT PRIMARY KEY,
           auth_provider VARCHAR(16) NOT NULL,
           identity_id INT NULL,
           FOREIGN KEY (identity_id) REFERENCES user_identities(id) ON DELETE CASCADE ON UPDATE CASCADE,
           CONSTRAINT chk_scratch_pairing CHECK ((auth_provider = 'oidc') = (identity_id IS NOT NULL))
         )`
      )
    );
    expect(err?.code).toBe('ER_CHECK_CONSTRAINT_CLAUSE_USING_FK_REFER_ACTION_COLUMN');
    expect(err.errno).toBe(3823);
  });
});

describe('the user-identities migration, on a fresh init.sql build', () => {
  it('is adopted by --adopt-fresh-install, and applies cleanly once', async () => {
    const schema = throwawaySchemaName();
    const conn = await openAdminConnection();
    try {
      await buildSchemaFromInitSql(conn, schema);
      const query = queryVia(conn);
      const adopted = await runMigrations({
        query,
        dir: MIGRATIONS_DIR,
        adoptFreshInstall: true,
        log: silent,
      });
      expect(adopted.pending).toEqual([]);
      expect(adopted.baselined).toContain('2026-10-11-user-identities.sql');
    } finally {
      await dropSchema(conn, schema);
      await conn.end();
    }
  });
});
