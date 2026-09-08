/**
 * Cloud Codex - Tests for scripts/migrate.js
 *
 * The runner's core takes an injected query executor and an injected
 * migrations directory, so every case below runs against a fake executor and
 * a temp directory. Nothing here connects to MySQL.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  runMigrations,
  listMigrationFiles,
  sha256,
  parseArgs,
  resolveDbConfig,
  LEGACY_BASELINE,
  isDirectRun,
  main,
  MIGRATIONS_DIR,
} from '../../scripts/migrate.js';

// Statements the runner issues itself. Everything else a call carries is a
// migration file body streamed verbatim, which is how the assertions below
// tell "the runner did bookkeeping" from "the runner applied a migration".
const RUNNER_SQL =
  /^(CREATE TABLE IF NOT EXISTS schema_migrations|SELECT 1 AS present FROM information_schema|SELECT filename, checksum|INSERT INTO schema_migrations|SELECT GET_LOCK|SELECT RELEASE_LOCK|START TRANSACTION|COMMIT|ROLLBACK)/;

const tempDirs = [];

/** A temp migrations directory holding `files` as name -> SQL body. */
function makeDir(files) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'c2-migrate-'));
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), body, 'utf8');
  }
  tempDirs.push(dir);
  return dir;
}

/**
 * A fake query executor with the `c2_query` shape.
 *
 * `tables` decides what `tableExists` sees, `applied` seeds schema_migrations,
 * and `failOnBody` makes any migration body containing that substring throw,
 * which is how the partial-migration case is driven.
 */
function fakeDb({
  tables = ['users', 'schema_migrations'],
  applied = {},
  failOnBody = null,
  lockGranted = true,
} = {}) {
  const calls = [];
  const rows = new Map(Object.entries(applied));
  // Mutable, so a CREATE TABLE really does make the table exist for the next
  // run: the baseline-then-migrate sequence an operator actually performs.
  const present = new Set(tables);

  const query = vi.fn(async (sql, params) => {
    calls.push({ sql, params });

    if (sql.startsWith('SELECT GET_LOCK')) {
      return [{ locked: lockGranted ? 1 : 0 }];
    }
    if (sql.startsWith('SELECT RELEASE_LOCK')) {
      return [{ released: 1 }];
    }
    if (sql.startsWith('CREATE TABLE IF NOT EXISTS schema_migrations')) {
      present.add('schema_migrations');
      return [];
    }
    if (sql.startsWith('SELECT 1 AS present FROM information_schema')) {
      return present.has(params[0]) ? [{ present: 1 }] : [];
    }
    if (sql.startsWith('SELECT filename, checksum')) {
      return [...rows].map(([filename, checksum]) => ({ filename, checksum }));
    }
    if (sql.startsWith('INSERT INTO schema_migrations')) {
      rows.set(params[0], params[1]);
      return [];
    }
    if (RUNNER_SQL.test(sql)) return [];

    if (failOnBody !== null && sql.includes(failOnBody)) {
      throw new Error('You have an error in your SQL syntax');
    }
    return [];
  });

  return { query, calls, rows };
}

/** The migration file bodies the runner actually streamed, in order. */
function appliedBodies(calls) {
  return calls.filter(c => !RUNNER_SQL.test(c.sql)).map(c => c.sql);
}

/** Silence the runner's progress output inside the suite. */
const log = () => {};

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('scripts/migrate', () => {
  // ── pure helpers ────────────────────────────────────────

  describe('sha256', () => {
    it('returns a stable 64-character hex digest', () => {
      const digest = sha256('ALTER TABLE logs ADD COLUMN x INT;\n');
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
      expect(sha256('ALTER TABLE logs ADD COLUMN x INT;\n')).toBe(digest);
      expect(sha256('ALTER TABLE logs ADD COLUMN y INT;\n')).not.toBe(digest);
    });
  });

  describe('listMigrationFiles', () => {
    it('returns only .sql files, sorted lexicographically', () => {
      const dir = makeDir({
        'b_second.sql': '-- b',
        'a_first.sql': '-- a',
        'README.md': 'not sql',
        'c_third.sql': '-- c',
      });
      expect(listMigrationFiles(dir)).toEqual(['a_first.sql', 'b_second.sql', 'c_third.sql']);
    });
  });

  describe('parseArgs', () => {
    it('defaults to a normal apply', () => {
      expect(parseArgs([])).toEqual({ baseline: false, adoptFreshInstall: false });
    });

    it('recognises --baseline', () => {
      expect(parseArgs(['--baseline'])).toEqual({ baseline: true, adoptFreshInstall: false });
    });

    it('refuses an unknown flag rather than silently applying', () => {
      expect(() => parseArgs(['--baselien'])).toThrow(/Unknown argument/);
    });

    it('recognises --adopt-fresh-install', () => {
      expect(parseArgs(['--adopt-fresh-install'])).toEqual({
        baseline: false,
        adoptFreshInstall: true,
      });
    });

    it('refuses the two adoption modes together', () => {
      expect(() => parseArgs(['--baseline', '--adopt-fresh-install'])).toThrow(
        /cannot be combined/
      );
    });
  });

  describe('resolveDbConfig', () => {
    it('refuses to build a config without credentials', () => {
      expect(() => resolveDbConfig({})).toThrow(/DB_USER, DB_PASS/);
      expect(() => resolveDbConfig({ DB_USER: 'admin' })).toThrow(/DB_USER, DB_PASS/);
    });

    it('defaults host and database, and always enables multipleStatements', () => {
      const config = resolveDbConfig({ DB_USER: 'admin', DB_PASS: 'secret' });
      expect(config).toEqual({
        host: 'localhost',
        user: 'admin',
        password: 'secret',
        database: 'c2',
        multipleStatements: true,
      });
    });

    it('honours DB_HOST and DB_NAME when set', () => {
      const config = resolveDbConfig({
        DB_USER: 'admin',
        DB_PASS: 'secret',
        DB_HOST: 'database',
        DB_NAME: 'codex',
      });
      expect(config.host).toBe('database');
      expect(config.database).toBe('codex');
    });
  });

  describe('isDirectRun', () => {
    it('is false when another entry point is running the process', () => {
      expect(isDirectRun('file:///somewhere/scripts/migrate.js')).toBe(false);
    });

    it('is true when the entry point is the module itself', () => {
      const original = process.argv[1];
      process.argv[1] = '/somewhere/scripts/migrate.js';
      try {
        expect(isDirectRun('file:///somewhere/scripts/migrate.js')).toBe(true);
      } finally {
        process.argv[1] = original;
      }
    });

    it('is false when there is no entry point at all', () => {
      const original = process.argv[1];
      process.argv[1] = undefined;
      try {
        expect(isDirectRun('file:///somewhere/scripts/migrate.js')).toBe(false);
      } finally {
        process.argv[1] = original;
      }
    });
  });

  describe('main', () => {
    it('refuses an unknown flag before opening any connection', async () => {
      await expect(main(['--nope'])).rejects.toThrow(/Unknown argument/);
    });
  });

  describe('MIGRATIONS_DIR', () => {
    it('points at the repo-root migrations directory, not one under cloudcodex/', () => {
      expect(MIGRATIONS_DIR.endsWith(`${path.sep}migrations`)).toBe(true);
      expect(MIGRATIONS_DIR).not.toContain(`${path.sep}cloudcodex${path.sep}migrations`);
      // The 13 shipped files must be visible through it.
      expect(listMigrationFiles(MIGRATIONS_DIR)).toContain('add_markdown_content.sql');
    });
  });

  // ── the three baseline cases ────────────────────────────

  describe('baseline adoption', () => {
    it('refuses when users is missing and points at init.sql', async () => {
      const dir = makeDir({ 'a.sql': '-- a' });
      const db = fakeDb({ tables: [] });

      await expect(runMigrations({ query: db.query, dir, log })).rejects.toThrow(/init\.sql/);
      expect(appliedBodies(db.calls)).toEqual([]);
    });

    it('never bootstraps a schema: no CREATE TABLE when users is missing', async () => {
      const dir = makeDir({ 'a.sql': '-- a' });
      const db = fakeDb({ tables: [] });

      await expect(runMigrations({ query: db.query, dir, log })).rejects.toThrow();
      expect(db.calls.some(c => c.sql.startsWith('CREATE TABLE IF NOT EXISTS'))).toBe(false);
    });

    it('refuses an existing install with no bookkeeping and prints the baseline command', async () => {
      const dir = makeDir({ 'a.sql': '-- a' });
      const db = fakeDb({ tables: ['users'] });

      await expect(runMigrations({ query: db.query, dir, log })).rejects.toThrow(
        /npm run migrate -- --baseline/
      );
      expect(appliedBodies(db.calls)).toEqual([]);
    });

    it('applies normally once bookkeeping exists', async () => {
      const dir = makeDir({ 'a.sql': '-- a' });
      const db = fakeDb();

      const result = await runMigrations({ query: db.query, dir, log });

      expect(result.applied).toEqual(['a.sql']);
      expect(appliedBodies(db.calls)).toEqual(['-- a']);
    });
  });

  // ── --baseline ──────────────────────────────────────────

  describe('--baseline', () => {
    it('records every legacy file with its checksum and applies none', async () => {
      const dir = makeDir({ 'add_watches.sql': '-- watches', 'p0_github_sync.sql': '-- p0' });
      const db = fakeDb({ tables: ['users'] });

      const result = await runMigrations({ query: db.query, dir, baseline: true, log });

      expect(result.baselined).toEqual(['add_watches.sql', 'p0_github_sync.sql']);
      expect(result.applied).toEqual([]);
      expect(appliedBodies(db.calls)).toEqual([]);
      expect(db.rows.get('add_watches.sql')).toBe(sha256('-- watches'));
      expect(db.rows.get('p0_github_sync.sql')).toBe(sha256('-- p0'));
    });

    // The regression test for the whole point of a hardcoded manifest. A
    // sweep-the-directory baseline would record this file as applied without
    // ever running it, and the next release's code would then hit a column
    // that does not exist, with the runner reporting success throughout.
    it('leaves a file that postdates the baseline PENDING, not adopted', async () => {
      const dir = makeDir({
        'add_watches.sql': '-- watches',
        '2026-09-08-add-token-purpose.sql': '-- ALTER TABLE password_reset_tokens ...',
      });
      const db = fakeDb({ tables: ['users'] });

      const result = await runMigrations({ query: db.query, dir, baseline: true, log });

      expect(result.baselined).toEqual(['add_watches.sql']);
      expect(result.pending).toEqual(['2026-09-08-add-token-purpose.sql']);
      expect(db.rows.has('2026-09-08-add-token-purpose.sql')).toBe(false);

      // ...and the very next ordinary run applies it, rather than skipping it
      // forever because --baseline swallowed it.
      const second = await runMigrations({ query: db.query, dir, log });
      expect(second.applied).toEqual(['2026-09-08-add-token-purpose.sql']);
    });

    it('adopts only names in the manifest even when nothing else is present', async () => {
      const dir = makeDir({ 'zz_someone_elses.sql': '-- not ours' });
      const db = fakeDb({ tables: ['users'] });

      const result = await runMigrations({ query: db.query, dir, baseline: true, log });

      expect(result.baselined).toEqual([]);
      expect(result.pending).toEqual(['zz_someone_elses.sql']);
      expect(db.calls.some(c => c.sql.startsWith('INSERT INTO schema_migrations'))).toBe(false);
    });

    it('names exactly the thirteen files that shipped before the runner', () => {
      expect([...LEGACY_BASELINE]).toEqual([
        'add_activity_log.sql',
        'add_first_run.sql',
        'add_github_links.sql',
        'add_markdown_content.sql',
        'add_notifications.sql',
        'add_watches.sql',
        'add_workspace_owner_id.sql',
        'drop_squad_permissions.sql',
        'p0_github_sync.sql',
        'p1_github_embeds.sql',
        'p2_github_collab.sql',
        'p3_github_polish.sql',
        'widen_log_content.sql',
      ]);
      // Every name in the manifest is a file that actually exists today.
      const onDisk = listMigrationFiles(MIGRATIONS_DIR);
      for (const filename of LEGACY_BASELINE) expect(onDisk).toContain(filename);
    });

    it('creates the bookkeeping table it is adopting into', async () => {
      const dir = makeDir({ 'add_watches.sql': '-- watches' });
      const db = fakeDb({ tables: ['users'] });

      await runMigrations({ query: db.query, dir, baseline: true, log });

      expect(db.calls.some(c => c.sql.startsWith('CREATE TABLE IF NOT EXISTS schema_migrations'))).toBe(true);
    });

    it('still refuses when users is missing', async () => {
      const dir = makeDir({ 'add_watches.sql': '-- watches' });
      const db = fakeDb({ tables: [] });

      await expect(
        runMigrations({ query: db.query, dir, baseline: true, log })
      ).rejects.toThrow(/init\.sql/);
    });

    it('leaves an already-recorded checksum alone rather than rewriting it', async () => {
      const dir = makeDir({ 'add_watches.sql': '-- watches', 'p0_github_sync.sql': '-- p0' });
      const db = fakeDb({ applied: { 'add_watches.sql': sha256('-- watches') } });

      const result = await runMigrations({ query: db.query, dir, baseline: true, log });

      expect(result.baselined).toEqual(['p0_github_sync.sql']);
      const inserts = db.calls.filter(c => c.sql.startsWith('INSERT INTO schema_migrations'));
      expect(inserts).toHaveLength(1);
      expect(inserts[0].params[0]).toBe('p0_github_sync.sql');
    });
  });

  // ── the normal apply path ───────────────────────────────

  describe('applying pending migrations', () => {
    it('applies every pending file in lexicographic order', async () => {
      const dir = makeDir({
        'c_third.sql': '-- c',
        'a_first.sql': '-- a',
        'b_second.sql': '-- b',
      });
      const db = fakeDb();

      const result = await runMigrations({ query: db.query, dir, log });

      expect(result.applied).toEqual(['a_first.sql', 'b_second.sql', 'c_third.sql']);
      expect(appliedBodies(db.calls)).toEqual(['-- a', '-- b', '-- c']);
    });

    it('skips files already recorded and applies only the new one', async () => {
      const dir = makeDir({ 'a.sql': '-- a', 'b.sql': '-- b' });
      const db = fakeDb({ applied: { 'a.sql': sha256('-- a') } });

      const result = await runMigrations({ query: db.query, dir, log });

      expect(result.applied).toEqual(['b.sql']);
      expect(appliedBodies(db.calls)).toEqual(['-- b']);
    });

    it('records filename, checksum and elapsed ms for each applied file', async () => {
      const dir = makeDir({ 'a.sql': '-- a' });
      const db = fakeDb();

      await runMigrations({ query: db.query, dir, log });

      const insert = db.calls.find(c => c.sql.startsWith('INSERT INTO schema_migrations'));
      expect(insert.sql).toContain('(filename, checksum, applied_ms)');
      expect(insert.params[0]).toBe('a.sql');
      expect(insert.params[1]).toBe(sha256('-- a'));
      expect(typeof insert.params[2]).toBe('number');
      expect(insert.params[2]).toBeGreaterThanOrEqual(0);
    });

    it('wraps each file in its own transaction and commits it', async () => {
      const dir = makeDir({ 'a.sql': '-- a', 'b.sql': '-- b' });
      const db = fakeDb();

      await runMigrations({ query: db.query, dir, log });

      const shape = db.calls.map(c => c.sql).filter(sql => /^(START TRANSACTION|COMMIT|ROLLBACK)$/.test(sql));
      expect(shape).toEqual(['START TRANSACTION', 'COMMIT', 'START TRANSACTION', 'COMMIT']);
    });

    it('creates bookkeeping outside any transaction', async () => {
      const dir = makeDir({ 'a.sql': '-- a' });
      const db = fakeDb();

      await runMigrations({ query: db.query, dir, log });

      const createAt = db.calls.findIndex(c => c.sql.startsWith('CREATE TABLE IF NOT EXISTS schema_migrations'));
      const beginAt = db.calls.findIndex(c => c.sql === 'START TRANSACTION');
      expect(createAt).toBeGreaterThanOrEqual(0);
      expect(beginAt).toBeGreaterThan(createAt);
    });

    it('is a no-op on a second run', async () => {
      const dir = makeDir({ 'a.sql': '-- a', 'b.sql': '-- b' });
      const db = fakeDb();

      await runMigrations({ query: db.query, dir, log });
      const firstRunCalls = db.calls.length;

      const second = await runMigrations({ query: db.query, dir, log });

      expect(second.applied).toEqual([]);
      expect(appliedBodies(db.calls.slice(firstRunCalls))).toEqual([]);
      expect(
        db.calls.slice(firstRunCalls).some(c => c.sql === 'START TRANSACTION')
      ).toBe(false);
    });
  });

  // ── the drift guard ─────────────────────────────────────

  describe('drift guard', () => {
    it('hard stops when an applied file has been edited', async () => {
      const dir = makeDir({ 'a.sql': '-- a edited' });
      const db = fakeDb({ applied: { 'a.sql': sha256('-- a') } });

      await expect(runMigrations({ query: db.query, dir, log })).rejects.toThrow(
        /a\.sql has changed since it was applied/
      );
    });

    it('says applied migrations are immutable and to fix forward', async () => {
      const dir = makeDir({ 'a.sql': '-- a edited' });
      const db = fakeDb({ applied: { 'a.sql': sha256('-- a') } });

      await expect(runMigrations({ query: db.query, dir, log })).rejects.toThrow(
        /immutable[\s\S]*Fix forward/
      );
    });

    it('stops before applying anything, including pending files that sort first', async () => {
      // 'a_pending.sql' sorts ahead of the drifted 'b_applied.sql', so a guard
      // that ran per-file instead of over the whole set would already have
      // applied it by the time it noticed the drift.
      const dir = makeDir({ 'a_pending.sql': '-- pending', 'b_applied.sql': '-- b edited' });
      const db = fakeDb({ applied: { 'b_applied.sql': sha256('-- b') } });

      await expect(runMigrations({ query: db.query, dir, log })).rejects.toThrow(/checksum/);

      expect(appliedBodies(db.calls)).toEqual([]);
      expect(db.calls.some(c => c.sql === 'START TRANSACTION')).toBe(false);
      expect(db.calls.some(c => c.sql.startsWith('INSERT INTO schema_migrations'))).toBe(false);
    });
  });

  // ── --adopt-fresh-install ───────────────────────────────

  describe('--adopt-fresh-install', () => {
    const freshInstall = () => fakeDb({ tables: ['users'] });

    // The dual of the manifest regression test. init.sql is kept in sync with
    // every migration file, so a database it just built already has all of
    // them. Adopting only the legacy thirteen would leave the fourteenth
    // "pending", and applying it against the column init.sql already created
    // fails with a duplicate-column error, on a brand-new install, with no
    // dump to restore.
    it('adopts files that postdate the legacy baseline too', async () => {
      const dir = makeDir({
        'add_watches.sql': '-- watches',
        '2026-09-08-add-token-purpose.sql': '-- ALTER TABLE password_reset_tokens ...',
      });
      const db = freshInstall();

      const result = await runMigrations({ query: db.query, dir, adoptFreshInstall: true, log });

      expect(result.baselined).toEqual([
        '2026-09-08-add-token-purpose.sql',
        'add_watches.sql',
      ]);
      expect(result.applied).toEqual([]);
      expect(result.pending).toEqual([]);
      expect(appliedBodies(db.calls)).toEqual([]);

      // ...and the next ordinary run has nothing to do.
      const second = await runMigrations({ query: db.query, dir, log });
      expect(second.applied).toEqual([]);
      expect(appliedBodies(db.calls)).toEqual([]);
    });

    it('records each adopted file with its real checksum', async () => {
      const dir = makeDir({ 'add_watches.sql': '-- watches' });
      const db = freshInstall();

      await runMigrations({ query: db.query, dir, adoptFreshInstall: true, log });

      expect(db.rows.get('add_watches.sql')).toBe(sha256('-- watches'));
    });

    // The guard that keeps this flag away from the install it would wreck.
    it('refuses once schema_migrations already records anything', async () => {
      const dir = makeDir({ 'add_watches.sql': '-- watches', 'p0_github_sync.sql': '-- p0' });
      const db = fakeDb({ applied: { 'add_watches.sql': sha256('-- watches') } });

      await expect(
        runMigrations({ query: db.query, dir, adoptFreshInstall: true, log })
      ).rejects.toThrow(/already tracked/);

      // p0 was NOT swallowed: an ordinary run still applies it.
      const result = await runMigrations({ query: db.query, dir, log });
      expect(result.applied).toEqual(['p0_github_sync.sql']);
    });

    it('still refuses when users is missing', async () => {
      const dir = makeDir({ 'add_watches.sql': '-- watches' });
      const db = fakeDb({ tables: [] });

      await expect(
        runMigrations({ query: db.query, dir, adoptFreshInstall: true, log })
      ).rejects.toThrow(/init\.sql/);
    });
  });

  // ── the advisory lock ───────────────────────────────────

  describe('the migration lock', () => {
    it('is taken before any apply and released afterwards', async () => {
      const dir = makeDir({ 'a.sql': '-- a' });
      const db = fakeDb();

      await runMigrations({ query: db.query, dir, log });

      const lockAt = db.calls.findIndex(c => c.sql.startsWith('SELECT GET_LOCK'));
      const applyAt = db.calls.findIndex(c => c.sql === '-- a');
      const releaseAt = db.calls.findIndex(c => c.sql.startsWith('SELECT RELEASE_LOCK'));

      expect(lockAt).toBeGreaterThanOrEqual(0);
      expect(applyAt).toBeGreaterThan(lockAt);
      expect(releaseAt).toBeGreaterThan(applyAt);
    });

    it('refuses to run at all when the lock is held by another run', async () => {
      const dir = makeDir({ 'a.sql': '-- a' });
      const db = fakeDb({ lockGranted: false });

      await expect(runMigrations({ query: db.query, dir, log })).rejects.toThrow(
        /Another migration run is in progress/
      );
      expect(appliedBodies(db.calls)).toEqual([]);
    });

    it('releases the lock even when a migration fails', async () => {
      const dir = makeDir({ 'a.sql': '-- boom' });
      const db = fakeDb({ failOnBody: 'boom' });

      await expect(runMigrations({ query: db.query, dir, log })).rejects.toThrow(/a\.sql failed/);

      expect(db.calls.some(c => c.sql.startsWith('SELECT RELEASE_LOCK'))).toBe(true);
    });
  });

  // ── the migrations directory ────────────────────────────

  describe('a missing migrations directory', () => {
    it('names the path and points at the container mount', async () => {
      const db = fakeDb();

      await expect(
        runMigrations({ query: db.query, dir: '/nonexistent-migrations', log })
      ).rejects.toThrow(/No migrations directory at \/nonexistent-migrations/);
    });
  });

  // ── failure mid-run ─────────────────────────────────────

  describe('a failing migration', () => {
    it('stops the run rather than continuing to the next file', async () => {
      const dir = makeDir({ 'a.sql': '-- a', 'b.sql': '-- boom', 'c.sql': '-- c' });
      const db = fakeDb({ failOnBody: 'boom' });

      await expect(runMigrations({ query: db.query, dir, log })).rejects.toThrow(/b\.sql/);

      expect(appliedBodies(db.calls)).toEqual(['-- a', '-- boom']);
      expect(db.rows.has('c.sql')).toBe(false);
    });

    it('rolls back what the transaction covers and warns the database may be partially migrated', async () => {
      const dir = makeDir({ 'a.sql': '-- boom' });
      const db = fakeDb({ failOnBody: 'boom' });

      await expect(runMigrations({ query: db.query, dir, log })).rejects.toThrow(
        /may be partially migrated/
      );

      expect(db.calls.some(c => c.sql === 'ROLLBACK')).toBe(true);
      expect(db.calls.some(c => c.sql === 'COMMIT')).toBe(false);
      expect(db.rows.has('a.sql')).toBe(false);
    });

    it('keeps the original error as the cause', async () => {
      const dir = makeDir({ 'a.sql': '-- boom' });
      const db = fakeDb({ failOnBody: 'boom' });

      const err = await runMigrations({ query: db.query, dir, log }).catch(e => e);
      expect(err.cause).toBeInstanceOf(Error);
      expect(err.cause.message).toMatch(/SQL syntax/);
    });

    it('does not let a failing rollback replace the migration error', async () => {
      const dir = makeDir({ 'a.sql': '-- boom' });
      const db = fakeDb({ failOnBody: 'boom' });
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      db.query.mockImplementation(async sql => {
        if (sql.startsWith('SELECT 1 AS present FROM information_schema')) return [{ present: 1 }];
        if (sql.startsWith('SELECT GET_LOCK')) return [{ locked: 1 }];
        if (sql.startsWith('SELECT filename, checksum')) return [];
        if (sql === 'ROLLBACK') throw new Error('connection lost');
        if (RUNNER_SQL.test(sql)) return [];
        throw new Error('You have an error in your SQL syntax');
      });

      await expect(runMigrations({ query: db.query, dir, log })).rejects.toThrow(
        /a\.sql failed/
      );
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });
});
