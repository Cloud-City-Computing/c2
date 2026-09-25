/**
 * The one-link-per-provider key on oauth_accounts, against a live MySQL server
 *
 * `UNIQUE (user_id, provider)` makes "a user holds at most one account per
 * provider" a database fact rather than an application check (open-questions
 * C7). Its migration must refuse, changing nothing, on an install that
 * already breaks the rule, and say how to find the rows that do. Only a real
 * server can prove that: the refusal is a stored-procedure SIGNAL inside a
 * multi-statement batch, and the fake executor in tests/scripts/ runs no SQL.
 * The same goes for the race the key closes, which is held open here with a
 * real lock: two Google sign-ins through resolveIdentity, and two GitHub links
 * through the real routes, for one user at the same instant.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// routes/oauth.js reads the GitHub client settings when it is imported.
vi.hoisted(() => {
  process.env.GITHUB_CLIENT_ID = 'it-github-client-id';
  process.env.GITHUB_CLIENT_SECRET = 'it-github-client-secret-0123456789';
});

import { readFileSync } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import app from '../../app.js';
import { c2_query, generateSessionToken } from '../../mysql_connect.js';
import { resolveIdentity } from '../../services/identity.js';
import {
  runMigrations,
  listMigrationFiles,
  ensureBookkeeping,
  sha256,
  MIGRATIONS_DIR,
} from '../../scripts/migrate.js';
import {
  buildSchemaFromInitSql,
  dropSchema,
  openAdminConnection,
  queryVia,
  throwawaySchemaName,
} from './mysql-admin.js';

const MIGRATION = '2026-09-25-oauth-one-link-per-provider.sql';
const KEY = 'uq_oauth_user_provider';
const GUARD = 'migration_guard_oauth_one_link_per_provider';

/** The query the refusal names, verbatim. CHANGELOG.md quotes the same text. */
const DUPLICATE_QUERY =
  'SELECT user_id, provider FROM oauth_accounts GROUP BY user_id, provider HAVING COUNT(*) > 1';

const silent = () => {};

/** The key's columns in order, from information_schema, or [] when it is absent. */
async function keyShape(query, schema) {
  return query(
    `SELECT COLUMN_NAME AS col, NON_UNIQUE AS nonUnique
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'oauth_accounts' AND INDEX_NAME = ?
      ORDER BY SEQ_IN_INDEX`,
    [schema, KEY]
  );
}

/** Every stored routine in `schema`, by name. */
async function routines(query, schema) {
  const rows = await query(
    'SELECT ROUTINE_NAME AS name FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? ORDER BY ROUTINE_NAME',
    [schema]
  );
  return rows.map(row => row.name);
}

/** Whether schema_migrations records this migration. */
async function recorded(query) {
  const rows = await query('SELECT 1 AS present FROM schema_migrations WHERE filename = ?', [MIGRATION]);
  return rows.length > 0;
}

/**
 * A tracked install from the release before this migration: an init.sql build
 * with the key taken off, and every OTHER migration file recorded as applied,
 * so an ordinary `npm run migrate` has exactly this one file pending.
 * @returns { Promise<{ conn: import('mysql2/promise').Connection, query: Function, schema: String }> }
 */
async function installBeforeThisMigration() {
  const schema = throwawaySchemaName();
  const conn = await openAdminConnection();
  await buildSchemaFromInitSql(conn, schema);
  const query = queryVia(conn);

  if ((await keyShape(query, schema)).length > 0) {
    await query(`ALTER TABLE oauth_accounts DROP INDEX ${KEY}`);
  }

  await ensureBookkeeping(query);
  for (const filename of listMigrationFiles(MIGRATIONS_DIR).filter(f => f !== MIGRATION)) {
    const contents = readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
    await query('INSERT INTO schema_migrations (filename, checksum, applied_ms) VALUES (?, ?, 0)', [
      filename,
      sha256(contents),
    ]);
  }

  return { conn, query, schema };
}

/**
 * Two users; returns their ids. Inserts go through the connection itself,
 * because queryVia hands back rows only and an INSERT's insertId is not a row.
 * @param { import('mysql2/promise').Connection } conn
 */
async function seedUsers(conn) {
  const [ada] = await conn.query("INSERT INTO users (name, email) VALUES ('ada', 'ada@example.com')");
  const [bob] = await conn.query("INSERT INTO users (name, email) VALUES ('bob', 'bob@example.com')");
  return { ada: ada.insertId, bob: bob.insertId };
}

/**
 * Insert one oauth_accounts row and return its id.
 * @param { import('mysql2/promise').Connection } conn
 */
async function link(conn, userId, provider, subject) {
  const [result] = await conn.query(
    `INSERT INTO oauth_accounts (user_id, provider, provider_user_id, provider_email) VALUES (?, ?, ?, 'x@example.com')`,
    [userId, provider, subject]
  );
  return result.insertId;
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

describe(`${MIGRATION} on an install that already holds a double link`, () => {
  it('refuses, names the query that finds the double link, and changes nothing', async () => {
    const { conn, query, schema } = await installBeforeThisMigration();
    try {
      const { ada, bob } = await seedUsers(conn);
      // ada is the C7 case: two Google subjects on one user. bob holds one
      // account per provider, which is exactly what the key allows.
      await link(conn, ada, 'google', 'ada-old-subject');
      const second = await link(conn, ada, 'google', 'ada-new-subject');
      await link(conn, bob, 'google', 'bob-subject');
      await link(conn, bob, 'github', 'bob-github');
      const before = await query('SELECT * FROM oauth_accounts ORDER BY id');

      const err = await rejection(runMigrations({ query, dir: MIGRATIONS_DIR, log: silent }));

      expect(err, 'the migration applied over a double link').not.toBeNull();
      expect(err.message).toContain(`${MIGRATION} refused to run`);
      expect(err.message).toContain(DUPLICATE_QUERY);
      expect(err.message).toContain(`dropped ${GUARD}`);
      // The query it names really finds the double link, and only that one.
      expect(await query(DUPLICATE_QUERY)).toEqual([{ user_id: ada, provider: 'google' }]);

      // Nothing deleted, nothing keyed, nothing recorded, and the throwaway
      // guard gone: the database is exactly as the refused run found it.
      expect(await query('SELECT * FROM oauth_accounts ORDER BY id')).toEqual(before);
      expect(await keyShape(query, schema)).toEqual([]);
      expect(await recorded(query)).toBe(false);
      expect(await routines(query, schema)).toEqual([]);

      // Retry-safe: a second run refuses the same way rather than tripping
      // over anything the first one left.
      const again = await rejection(runMigrations({ query, dir: MIGRATIONS_DIR, log: silent }));
      expect(again, 'a second run applied over the double link').not.toBeNull();
      expect(again.message).toContain(DUPLICATE_QUERY);
      expect(await routines(query, schema)).toEqual([]);

      // Resolved the way the CHANGELOG says, the same file applies.
      await query('DELETE FROM oauth_accounts WHERE id = ?', [second]);
      const retried = await runMigrations({ query, dir: MIGRATIONS_DIR, log: silent });
      expect(retried.applied).toEqual([MIGRATION]);
      expect(await keyShape(query, schema)).toEqual([
        { col: 'user_id', nonUnique: 0 },
        { col: 'provider', nonUnique: 0 },
      ]);
      expect(await routines(query, schema)).toEqual([]);
    } finally {
      await dropSchema(conn, schema);
      await conn.end();
    }
  });
});

describe(`${MIGRATION} on a clean install`, () => {
  it('applies, leaves no routine behind, and the key then refuses a second link per provider', async () => {
    const { conn, query, schema } = await installBeforeThisMigration();
    try {
      const { ada, bob } = await seedUsers(conn);
      await link(conn, ada, 'google', 'ada-subject');
      await link(conn, ada, 'github', 'ada-github');

      const result = await runMigrations({ query, dir: MIGRATIONS_DIR, log: silent });

      expect(result.applied).toEqual([MIGRATION]);
      expect(await recorded(query)).toBe(true);
      expect(await routines(query, schema)).toEqual([]);
      expect(await keyShape(query, schema)).toEqual([
        { col: 'user_id', nonUnique: 0 },
        { col: 'provider', nonUnique: 0 },
      ]);
      const [{ n }] = await query('SELECT COUNT(*) AS n FROM oauth_accounts');
      expect(Number(n)).toBe(2);

      for (const provider of ['google', 'github']) {
        const err = await rejection(link(conn, ada, provider, `ada-second-${provider}`));
        expect(err, `a second ${provider} link for one user was accepted`).not.toBeNull();
        expect(err.code).toBe('ER_DUP_ENTRY');
        expect(err.sqlMessage).toContain(`oauth_accounts.${KEY}`);
      }

      // One account per provider per user, not one per provider overall.
      await link(conn, bob, 'google', 'bob-subject');
    } finally {
      await dropSchema(conn, schema);
      await conn.end();
    }
  });
});

describe('--adopt-fresh-install and the key', () => {
  it('refuses a schema that is missing it, naming it', async () => {
    const schema = throwawaySchemaName();
    const conn = await openAdminConnection();
    try {
      await buildSchemaFromInitSql(conn, schema);
      const query = queryVia(conn);
      if ((await keyShape(query, schema)).length > 0) {
        await query(`ALTER TABLE oauth_accounts DROP INDEX ${KEY}`);
      }

      const err = await rejection(
        runMigrations({ query, dir: MIGRATIONS_DIR, adoptFreshInstall: true, log: silent })
      );

      expect(err, 'adoption recorded every file over a schema without the key').not.toBeNull();
      expect(err.message).toContain(`missing: oauth_accounts.${KEY}`);
      const [{ n }] = await query('SELECT COUNT(*) AS n FROM schema_migrations');
      expect(Number(n)).toBe(0);
    } finally {
      await dropSchema(conn, schema);
      await conn.end();
    }
  });
});

/**
 * Hold open the race the application checks cannot close: a transaction takes
 * a locking read of this user's (empty) oauth_accounts range, which holds the
 * gap every link INSERT for the user has to enter. Two sign-ins then pass
 * their SELECTs, find no row, and wait at the INSERT until `release`.
 * @param { Number } userId
 */
async function holdLinkGap(userId) {
  const blocker = await openAdminConnection();
  await blocker.changeUser({ database: process.env.DB_NAME });
  await blocker.query('START TRANSACTION');
  await blocker.query('SELECT id FROM oauth_accounts WHERE user_id = ? FOR UPDATE', [userId]);

  return {
    /** Wait until `n` transactions in this file's schema are waiting on a lock. */
    async waitForLockWaits(n) {
      const deadline = Date.now() + 10000;
      for (;;) {
        const [rows] = await blocker.query(
          `SELECT COUNT(*) AS waiting
             FROM information_schema.INNODB_TRX t
             JOIN performance_schema.processlist p ON p.ID = t.trx_mysql_thread_id
            WHERE t.trx_state = 'LOCK WAIT' AND p.DB = ?`,
          [process.env.DB_NAME]
        );
        if (Number(rows[0].waiting) >= n) return;
        if (Date.now() > deadline) {
          throw new Error(`only ${rows[0].waiting} of ${n} links reached their INSERT`);
        }
        // Slower than InnoDB's 100 ms: it refreshes INNODB_TRX only once the
        // table has gone that long unread, so a tighter loop never sees a change.
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    },
    async release() {
      try {
        await blocker.query('COMMIT');
      } finally {
        await blocker.end();
      }
    },
  };
}

/** How many `provider` rows `userId` holds, through the app's own pool. */
async function linkCount(userId, provider) {
  const [{ n }] = await c2_query(
    'SELECT COUNT(*) AS n FROM oauth_accounts WHERE user_id = ? AND provider = ?',
    [userId, provider]
  );
  return Number(n);
}

describe('two Google subjects linking one user at the same instant (C7)', () => {
  it('links one, and the other gets identity_conflict rather than a thrown duplicate', async () => {
    const email = 'race@example.com';
    const policy = { requiredHostedDomain: undefined, linkByVerifiedEmail: true, autoCreate: false };
    const created = await c2_query(`INSERT INTO users (name, email) VALUES ('race', ?)`, [email]);
    const userId = created.insertId;

    const gap = await holdLinkGap(userId);
    const attempts = ['race-subject-a', 'race-subject-b'].map(subject =>
      resolveIdentity({ provider: 'google', subject, email, emailVerified: true }, policy).then(
        value => value,
        err => ({ threw: err.code ?? err.message })
      )
    );
    try {
      await gap.waitForLockWaits(2);
    } finally {
      await gap.release();
    }
    const results = await Promise.all(attempts);

    expect(results).toContainEqual({ ok: true, userId, created: false });
    expect(results).toContainEqual({ ok: false, reason: 'identity_conflict' });
    expect(await linkCount(userId, 'google')).toBe(1);
  });
});

describe('two GitHub accounts linking one user at the same instant (C7)', () => {
  // GitHub is reached only through fetch, so it is the one thing stubbed; the
  // routes, the session, the state and the database are all real.
  // Distinct per test: the tests in this file share one schema, and the race
  // leaves one of 7001 and 7002 linked.
  const githubAccountFor = { 'code-a': 7001, 'code-b': 7002, 'code-c': 7102 };

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, init) => {
        const u = String(url);
        if (u.startsWith('https://github.com/login/oauth/access_token')) {
          const { code } = JSON.parse(init.body);
          return { ok: true, json: async () => ({ access_token: `token-for-${code}` }) };
        }
        if (u === 'https://api.github.com/user') {
          const code = init.headers.Authorization.replace('Bearer token-for-', '');
          const id = githubAccountFor[code];
          return { ok: true, json: async () => ({ id, login: `gh${id}`, avatar_url: null, email: `gh${id}@example.com` }) };
        }
        return { ok: true, json: async () => [] };
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('links one, and redirects the other to github_error=link_conflict rather than a 500', async () => {
    const created = await c2_query(`INSERT INTO users (name, email) VALUES ('ghrace', 'ghrace@example.com')`, []);
    const userId = created.insertId;
    const session = await generateSessionToken({ id: userId });

    // Two link flows for one user, as two tabs would start them.
    const flows = [];
    for (let i = 0; i < 2; i++) {
      const started = await request(app).get('/api/oauth/github').set('Authorization', `Bearer ${session}`);
      expect(started.status).toBe(302);
      const state = new URL(started.headers.location).searchParams.get('state');
      flows.push({ state, cookie: `oauth_state_github=${state}` });
    }

    const gap = await holdLinkGap(userId);
    const callbacks = ['code-a', 'code-b'].map((code, i) =>
      request(app)
        .get(`/api/oauth/github/callback?code=${code}&state=${flows[i].state}`)
        .set('Cookie', flows[i].cookie)
        .then(res => res.headers.location ?? `status ${res.status}`)
    );
    try {
      await gap.waitForLockWaits(2);
    } finally {
      await gap.release();
    }
    const outcomes = await Promise.all(callbacks);

    expect(outcomes).toContain('/account?github_linked=1');
    expect(outcomes).toContain('/account?github_error=link_conflict');
    expect(await linkCount(userId, 'github')).toBe(1);
  });

  // The relink path, which UPDATEs the caller's row onto whatever account came
  // back from GitHub, used to run straight into uq_provider_user when another
  // user held that account.
  it('refuses a relink to an account another user holds as already_linked_other, not a 500', async () => {
    const holder = await c2_query(`INSERT INTO users (name, email) VALUES ('ghholder', 'ghholder@example.com')`, []);
    await c2_query(
      `INSERT INTO oauth_accounts (user_id, provider, provider_user_id, provider_email) VALUES (?, 'github', '7102', 'h@example.com')`,
      [holder.insertId]
    );
    const relinker = await c2_query(`INSERT INTO users (name, email) VALUES ('ghrelink', 'ghrelink@example.com')`, []);
    await c2_query(
      `INSERT INTO oauth_accounts (user_id, provider, provider_user_id, provider_email) VALUES (?, 'github', '7103', 'r@example.com')`,
      [relinker.insertId]
    );
    const before = await c2_query(`SELECT * FROM oauth_accounts WHERE provider = 'github' ORDER BY id`, []);
    const session = await generateSessionToken({ id: relinker.insertId });

    const started = await request(app).get('/api/oauth/github').set('Authorization', `Bearer ${session}`);
    const state = new URL(started.headers.location).searchParams.get('state');
    // code-c comes back from GitHub as account 7102, which the holder has.
    const res = await request(app)
      .get(`/api/oauth/github/callback?code=code-c&state=${state}`)
      .set('Cookie', `oauth_state_github=${state}`);

    expect(res.headers.location ?? `status ${res.status}`).toBe('/account?github_error=already_linked_other');
    expect(await c2_query(`SELECT * FROM oauth_accounts WHERE provider = 'github' ORDER BY id`, [])).toEqual(before);
  });
});
