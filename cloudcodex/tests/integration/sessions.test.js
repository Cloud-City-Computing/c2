/**
 * One hashed session per sign-in, against a live MySQL server
 *
 * The unit tests prove the statements mysql_connect.js issues; only a real
 * server proves what those statements leave behind: that two sign-ins are two
 * rows, that no row holds a token a browser could present, that the digest
 * JavaScript computes is the one MySQL's SHA2 computes (the migration hashes
 * existing rows with SHA2, and the app looks them up with hashSessionToken),
 * and that sessions.auth_provider refuses an insert that does not name its
 * flow. The last describe runs the migration file for real, on a row minted
 * before it, and proves that row still signs in afterwards.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { c2_query, generateSessionToken, validateAndAutoLogin } from '../../mysql_connect.js';
import { hashSessionToken } from '../../services/session-token.js';
import { runMigrations, MIGRATIONS_DIR } from '../../scripts/migrate.js';
import { openAdminConnection, queryVia } from './mysql-admin.js';

const MIGRATION = '2026-09-27-session-per-sign-in.sql';

const silent = () => {};

let seq = 0;

/** A fresh user; returns its id. */
async function newUser() {
  seq += 1;
  const name = `sess${seq}_${Date.now() % 100000}`;
  const created = await c2_query('INSERT INTO users (name, email) VALUES (?, ?)', [name, `${name}@example.com`]);
  return created.insertId;
}

/** Every session row the user holds. */
async function rowsOf(userId) {
  return c2_query('SELECT id, auth_provider FROM sessions WHERE user_id = ?', [userId]);
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

/**
 * A 64-character token from the same alphabet generateSessionToken draws
 * from, with upper case guaranteed, so it can never pass for a digest.
 */
function rawToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(63));
  return 'R' + Array.from(bytes, b => chars[b % chars.length]).join('');
}

describe('one session per sign-in, on a real server', () => {
  it('gives two sign-ins two rows, and signing one out leaves the other valid', async () => {
    const userId = await newUser();

    const first = await generateSessionToken({ id: userId }, '10.0.0.1', 'laptop');
    const second = await generateSessionToken({ id: userId }, '10.0.0.2', 'phone');

    expect(first).not.toBe(second);
    const rows = await rowsOf(userId);
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.auth_provider)).toEqual(['local', 'local']);

    // Logout's statement, by the digest.
    await c2_query('DELETE FROM sessions WHERE id = ?', [hashSessionToken(first)]);

    expect(await validateAndAutoLogin(first)).toBeNull();
    expect(await validateAndAutoLogin(second)).toMatchObject({ id: userId });
    expect(await rowsOf(userId)).toHaveLength(1);
  });

  it('stores no raw token: every id is the digest of the token handed out', async () => {
    const userId = await newUser();
    const tokens = [await generateSessionToken({ id: userId }), await generateSessionToken({ id: userId })];

    const ids = (await rowsOf(userId)).map(r => r.id);
    for (const token of tokens) {
      expect(ids).not.toContain(token);
      expect(ids).toContain(hashSessionToken(token));
    }
    // And a lookup by the raw value, which is what a leaked dump would offer,
    // finds nothing.
    for (const token of tokens) {
      expect(await c2_query('SELECT id FROM sessions WHERE id = ?', [token])).toEqual([]);
    }
  });

  it('records the Google flow as google', async () => {
    const userId = await newUser();
    await generateSessionToken({ id: userId }, null, null, { provider: 'google' });
    expect((await rowsOf(userId)).map(r => r.auth_provider)).toEqual(['google']);
  });

  it('computes the same digest as MySQL SHA2(?, 256), which the migration uses', async () => {
    for (const token of [rawToken(), rawToken(), 'abc']) {
      const [{ d }] = await c2_query('SELECT SHA2(?, 256) AS d', [token]);
      expect(d).toBe(hashSessionToken(token));
    }
  });
});

describe('sessions.auth_provider, on a real server', () => {
  it('refuses an insert that does not name its flow', async () => {
    const userId = await newUser();
    const err = await rejection(
      c2_query('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 DAY))', [
        hashSessionToken(rawToken()),
        userId,
      ])
    );
    expect(err?.code).toBe('ER_NO_DEFAULT_FOR_FIELD');
  });

  it('refuses a flow outside the set on the CHECK', async () => {
    const userId = await newUser();
    const err = await rejection(
      c2_query(
        "INSERT INTO sessions (id, user_id, auth_provider, expires_at) VALUES (?, ?, 'oidc', DATE_ADD(NOW(), INTERVAL 1 DAY))",
        [hashSessionToken(rawToken()), userId]
      )
    );
    expect(err?.errno).toBe(3819);
    expect(err.sqlMessage).toContain('chk_sessions_auth_provider');
  });
});

describe(`${MIGRATION} applied for real`, () => {
  // Run in this file's own schema, the one the app's pool is bound to, so the
  // row minted before the migration can be validated through the real
  // validateAndAutoLogin afterwards. The schema ends where it started: the
  // migration re-applied and recorded.
  it('hashes a session minted before it in place, so that session still signs in', async () => {
    const conn = await openAdminConnection();
    try {
      await conn.changeUser({ database: process.env.DB_NAME });
      const query = queryVia(conn);
      const userId = await newUser();

      // The install before this file: no column, no CHECK, not recorded.
      await query('ALTER TABLE sessions DROP CHECK chk_sessions_auth_provider, DROP COLUMN auth_provider');
      await query('DELETE FROM schema_migrations WHERE filename = ?', [MIGRATION]);

      // What the old image wrote: the raw token as the id.
      const token = rawToken();
      await query(
        'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))',
        [token, userId]
      );
      // A raw token whose letters all fall in A-F: only case separates it
      // from a digest, and the column's collation ignores case, which is what
      // the migration's 'c' flag is for.
      const upperHexToken = hashSessionToken(rawToken()).toUpperCase();
      await query(
        'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))',
        [upperHexToken, userId]
      );
      // A row that is already a digest (as the new image would write) must be
      // left alone, which is what makes the file safe to meet twice.
      const alreadyDigest = hashSessionToken(rawToken());
      await query(
        'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))',
        [alreadyDigest, userId]
      );

      const result = await runMigrations({ query, dir: MIGRATIONS_DIR, log: silent });
      expect(result.applied).toEqual([MIGRATION]);

      const [column] = await query(
        `SELECT IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'sessions' AND COLUMN_NAME = 'auth_provider'`,
        [process.env.DB_NAME]
      );
      expect(column).toEqual({ IS_NULLABLE: 'NO', COLUMN_DEFAULT: null });

      const ids = (await rowsOf(userId)).map(r => r.id).sort();
      expect(ids).toEqual([alreadyDigest, hashSessionToken(token), hashSessionToken(upperHexToken)].sort());
      expect((await rowsOf(userId)).map(r => r.auth_provider)).toEqual(['local', 'local', 'local']);
      expect(await validateAndAutoLogin(token)).toMatchObject({ id: userId });
      expect(await validateAndAutoLogin(upperHexToken)).toMatchObject({ id: userId });

      // The file's UPDATE, a second time: nothing left to hash.
      const update = readFileSync(path.join(MIGRATIONS_DIR, MIGRATION), 'utf8')
        .split('\n')
        .find(line => /^UPDATE sessions/.test(line));
      expect(update).toBeDefined();
      const [again] = await conn.query(update);
      expect(again.affectedRows).toBe(0);
    } finally {
      await conn.end();
    }
  });
});
