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
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  runMigrations,
  listMigrationFiles,
  describeMigrationsDirError,
  schemaClaims,
  sha256,
  parseArgs,
  resolveDbConfig,
  LEGACY_BASELINE,
  isDirectRun,
  main,
  MIGRATIONS_DIR,
} from '../../scripts/migrate.js';

/**
 * A migration that postdates the pre-runner baseline, shaped like the real one
 * (`2026-09-08-token-purpose.sql`): a long `--` header that quotes the DDL for
 * reversing it, then the DDL itself. The quoted DROP in the header is the
 * reason the claim reader strips comments before it parses anything.
 */
const NEWER_MIGRATION = `-- Typed purpose for password_reset_tokens.
--
-- THERE IS NO ROLLBACK. Getting back means dropping the column by hand:
--   ALTER TABLE password_reset_tokens DROP COLUMN purpose;

ALTER TABLE password_reset_tokens
  ADD COLUMN purpose VARCHAR(32) NULL AFTER token;
`;

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
 * `tables` decides what `tableExists` sees and `columns` (as `table.column`)
 * what `columnExists` sees, `applied` seeds schema_migrations, and `failOnBody`
 * makes any migration body containing that substring throw, which is how the
 * partial-migration case is driven. `lockGranted` takes MySQL's three answers:
 * true (1, held), false (0, timed out) and null (the attempt errored).
 *
 * START TRANSACTION / ROLLBACK really do snapshot and restore `rows`, so a test
 * can assert on what bookkeeping SURVIVES a failure rather than only on the
 * statements that were issued.
 */
function fakeDb({
  tables = ['users', 'schema_migrations'],
  columns = [],
  applied = {},
  failOnBody = null,
  failCode = null,
  lockGranted = true,
  database = 'c2',
} = {}) {
  const calls = [];
  const rows = new Map(Object.entries(applied));
  // Mutable, so a CREATE TABLE really does make the table exist for the next
  // run: the baseline-then-migrate sequence an operator actually performs.
  const present = new Set(tables);
  const presentColumns = new Set(columns);
  let snapshot = null;

  const query = vi.fn(async (sql, params) => {
    calls.push({ sql, params });

    if (sql.startsWith('SELECT GET_LOCK')) {
      const locked = lockGranted === null ? null : lockGranted ? 1 : 0;
      return [{ locked, db: database }];
    }
    if (sql.startsWith('SELECT RELEASE_LOCK')) {
      return [{ released: 1 }];
    }
    if (sql.startsWith('CREATE TABLE IF NOT EXISTS schema_migrations')) {
      present.add('schema_migrations');
      return [];
    }
    if (sql.startsWith('SELECT 1 AS present FROM information_schema.columns')) {
      return presentColumns.has(`${params[0]}.${params[1]}`) ? [{ present: 1 }] : [];
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
    if (sql === 'START TRANSACTION') {
      snapshot = new Map(rows);
      return [];
    }
    if (sql === 'ROLLBACK') {
      if (snapshot !== null) {
        rows.clear();
        for (const [filename, checksum] of snapshot) rows.set(filename, checksum);
      }
      snapshot = null;
      return [];
    }
    if (sql === 'COMMIT') {
      snapshot = null;
      return [];
    }
    if (RUNNER_SQL.test(sql)) return [];

    if (failOnBody !== null && sql.includes(failOnBody)) {
      const err = new Error('You have an error in your SQL syntax');
      if (failCode !== null) err.code = failCode;
      throw err;
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

  describe('describeMigrationsDirError', () => {
    it('turns ENOENT into the compose-mount explanation', () => {
      const explained = describeMigrationsDirError({ code: 'ENOENT' }, '/migrations');
      expect(explained.message).toMatch(/No migrations directory at \/migrations/);
      expect(explained.message).toMatch(/compose mounts it/);
    });

    // Measured on Fedora with SELinux enforcing: a bind mount with no relabel
    // flag is unreadable inside the container, and the raw error is a bare
    // `scandir` EACCES that reads as a file-permission problem on a directory
    // whose permissions are fine.
    it('names SELinux labeling for EACCES', () => {
      const explained = describeMigrationsDirError({ code: 'EACCES' }, '/migrations');
      expect(explained.message).toMatch(/permission denied/);
      expect(explained.message).toMatch(/SELinux/);
      expect(explained.message).toContain(':ro,z');
    });

    it('treats EPERM the same way', () => {
      expect(describeMigrationsDirError({ code: 'EPERM' }, '/migrations').message).toMatch(
        /SELinux/
      );
    });

    it('has nothing to add for an errno it does not recognise', () => {
      expect(describeMigrationsDirError({ code: 'EMFILE' }, '/migrations')).toBeNull();
    });
  });

  describe('schemaClaims', () => {
    it('reads the table a file creates', () => {
      expect(schemaClaims('CREATE TABLE IF NOT EXISTS watches (id INT);')).toEqual([
        { kind: 'table', table: 'watches' },
      ]);
    });

    it('reads every column one ALTER adds, with or without the COLUMN keyword', () => {
      const claims = schemaClaims(
        'ALTER TABLE github_links ADD COLUMN base_sha CHAR(40), ADD last_pulled_at DATETIME;'
      );
      expect(claims).toEqual([
        { kind: 'column', table: 'github_links', column: 'base_sha' },
        { kind: 'column', table: 'github_links', column: 'last_pulled_at' },
      ]);
    });

    it('ignores indexes, keys and constraints, which are not columns', () => {
      const claims = schemaClaims(
        `ALTER TABLE t ADD COLUMN purpose VARCHAR(32),
           ADD INDEX idx_purpose (purpose),
           ADD UNIQUE KEY uq_purpose (purpose),
           ADD CONSTRAINT chk_purpose CHECK (purpose IN ('a'));`
      );
      expect(claims).toEqual([{ kind: 'column', table: 't', column: 'purpose' }]);
    });

    // The real migration headers quote the DDL that reverses them, so a reader
    // that did not strip comments would "find" a column the file never adds.
    it('ignores DDL quoted inside comments', () => {
      expect(schemaClaims(NEWER_MIGRATION)).toEqual([
        { kind: 'column', table: 'password_reset_tokens', column: 'purpose' },
      ]);
      expect(schemaClaims('-- CREATE TABLE ghost (id INT);\n/* ALTER TABLE t ADD c INT; */')).toEqual(
        []
      );
    });

    it('finds nothing in a file that only drops, modifies or deletes', () => {
      expect(schemaClaims('ALTER TABLE squad_members DROP COLUMN can_read;')).toEqual([]);
      expect(schemaClaims('ALTER TABLE logs MODIFY html_content MEDIUMTEXT;')).toEqual([]);
      expect(schemaClaims('DELETE FROM password_reset_tokens;')).toEqual([]);
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

    // An operator upgrading reads "a brand-new install" as "a new install of
    // the new version", and --adopt-fresh-install is the wrong door for them.
    // The far more common case goes first, and the text says which is which.
    it('leads with --baseline, the case an upgrading operator is actually in', async () => {
      const dir = makeDir({ 'a.sql': '-- a' });
      const db = fakeDb({ tables: ['users'] });

      const err = await runMigrations({ query: db.query, dir, log }).catch(e => e);

      expect(err.message.indexOf('--baseline')).toBeLessThan(
        err.message.indexOf('--adopt-fresh-install')
      );
      expect(err.message).toMatch(/UPGRADING a database that already existed/);
      expect(err.message).toMatch(/BUILT MINUTES AGO/);
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

    // The mutant the test above does NOT kill:
    //   LEGACY_BASELINE = Object.freeze(listMigrationFiles(MIGRATIONS_DIR))
    // While migrations/ holds exactly these thirteen names, a directory sweep
    // produces the identical array and every value assertion passes. It only
    // starts failing once a fourteenth file lands, which is precisely the
    // release where the closed list has to already be right. So assert the
    // property itself, against the source: the manifest is written down, not
    // swept up. This stays true, and stays a kill, whatever lands next.
    it('is written down in the source, not swept out of the migrations directory', () => {
      const source = readFileSync(
        fileURLToPath(new URL('../../scripts/migrate.js', import.meta.url)),
        'utf8'
      );
      const start = source.indexOf('export const LEGACY_BASELINE');
      expect(start).toBeGreaterThan(-1);

      const declaration = source.slice(start, source.indexOf(']);', start));
      expect(declaration).not.toMatch(/listMigrationFiles|readdir|MIGRATIONS_DIR|\.filter|\.map/);
      for (const filename of LEGACY_BASELINE) expect(declaration).toContain(`'${filename}'`);
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

    // Pure DML, so unlike the apply path a transaction here means what it says.
    // Without it, a run interrupted partway leaves some rows and both adoption
    // modes then refuse forever over bookkeeping nobody asked for.
    it('records the whole baseline in a single transaction', async () => {
      const dir = makeDir({ 'add_watches.sql': '-- watches', 'p0_github_sync.sql': '-- p0' });
      const db = fakeDb({ tables: ['users'] });

      await runMigrations({ query: db.query, dir, baseline: true, log });

      const shape = db.calls
        .map(c => c.sql)
        .filter(sql =>
          /^(START TRANSACTION|COMMIT|ROLLBACK|INSERT INTO schema_migrations)/.test(sql)
        )
        .map(sql => (sql.startsWith('INSERT') ? 'INSERT' : sql));
      expect(shape).toEqual(['START TRANSACTION', 'INSERT', 'INSERT', 'COMMIT']);
    });

    it('rolls the whole baseline back when one insert fails', async () => {
      const dir = makeDir({ 'add_watches.sql': '-- watches', 'p0_github_sync.sql': '-- p0' });
      const db = fakeDb({ tables: ['users'] });
      const underlying = db.query.getMockImplementation();
      let inserts = 0;
      db.query.mockImplementation(async (sql, params) => {
        if (sql.startsWith('INSERT INTO schema_migrations') && ++inserts === 2) {
          throw new Error('Lost connection to MySQL server during query');
        }
        return underlying(sql, params);
      });

      await expect(
        runMigrations({ query: db.query, dir, baseline: true, log })
      ).rejects.toThrow(/Lost connection/);

      expect(db.calls.some(c => c.sql === 'ROLLBACK')).toBe(true);
      expect(db.rows.size).toBe(0);
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
    const TOKEN_PURPOSE = '2026-09-08-token-purpose.sql';

    /** A database init.sql built: it already HAS the newer migration's column. */
    const freshInstall = () =>
      fakeDb({ tables: ['users'], columns: ['password_reset_tokens.purpose'] });

    /**
     * An install that predates the runner. Bookkeeping is empty here too, which
     * is exactly why emptiness cannot be the guard: what tells the two apart is
     * that this one is MISSING what the newer migration adds.
     */
    const legacyInstall = () => fakeDb({ tables: ['users'], columns: [] });

    const bothKinds = () =>
      makeDir({ 'add_watches.sql': '-- watches', [TOKEN_PURPOSE]: NEWER_MIGRATION });

    // The dual of the manifest regression test. init.sql is kept in sync with
    // every migration file, so a database it just built already has all of
    // them. Adopting only the legacy thirteen would leave the fourteenth
    // "pending", and applying it against the column init.sql already created
    // fails with a duplicate-column error, on a brand-new install, with no
    // dump to restore.
    it('adopts files that postdate the legacy baseline too', async () => {
      const dir = bothKinds();
      const db = freshInstall();

      const result = await runMigrations({ query: db.query, dir, adoptFreshInstall: true, log });

      expect(result.baselined).toEqual([TOKEN_PURPOSE, 'add_watches.sql']);
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

    // ── the positive check ────────────────────────────────

    // THE defect this guard exists for. An install that predates the runner has
    // zero bookkeeping rows by definition, so "schema_migrations is empty" is
    // not evidence of a fresh install, and it is the population that reaches
    // for an adoption flag in the first place. Without the schema check every
    // file here is recorded as applied, nothing is executed, the run exits 0,
    // and the column is never created: every later run then reports "no pending
    // migrations" while the app 500s on the missing column, forever.
    it('refuses when a file that postdates the baseline is not in the schema yet', async () => {
      const dir = bothKinds();
      const db = legacyInstall();

      await expect(
        runMigrations({ query: db.query, dir, adoptFreshInstall: true, log })
      ).rejects.toThrow(/does not contain what 2026-09-08-token-purpose\.sql/);
    });

    it('names the missing column and sends the operator to --baseline', async () => {
      const dir = bothKinds();
      const db = legacyInstall();

      await expect(
        runMigrations({ query: db.query, dir, adoptFreshInstall: true, log })
      ).rejects.toThrow(
        /missing: password_reset_tokens\.purpose[\s\S]*npm run migrate -- --baseline/
      );
    });

    it('records NOTHING when one newer file fails the check', async () => {
      const dir = bothKinds();
      const db = legacyInstall();

      await expect(
        runMigrations({ query: db.query, dir, adoptFreshInstall: true, log })
      ).rejects.toThrow();

      expect(db.rows.size).toBe(0);
      expect(db.calls.some(c => c.sql.startsWith('INSERT INTO schema_migrations'))).toBe(false);

      // ...and the migration is still pending, which is the point: an ordinary
      // run after --baseline applies it for real.
      const after = await runMigrations({ query: db.query, dir, baseline: true, log });
      expect(after.pending).toEqual([TOKEN_PURPOSE]);
    });

    it('refuses a newer file whose changes it cannot read out of the SQL', async () => {
      const dir = makeDir({ 'zz_data_only.sql': "DELETE FROM logs WHERE title = 'x';" });
      const db = freshInstall();

      await expect(
        runMigrations({ query: db.query, dir, adoptFreshInstall: true, log })
      ).rejects.toThrow(/declares no\s+CREATE TABLE or ADD COLUMN to check/);
    });

    it('gives the by-hand INSERT, with the real checksum, for a file it cannot check', async () => {
      const body = "DELETE FROM logs WHERE title = 'x';";
      const dir = makeDir({ 'zz_data_only.sql': body });
      const db = freshInstall();

      await expect(
        runMigrations({ query: db.query, dir, adoptFreshInstall: true, log })
      ).rejects.toThrow(new RegExp(`VALUES \\('zz_data_only\\.sql', '${sha256(body)}', 0\\)`));
    });

    // The pre-runner files are exempt on purpose: adopting exactly those is
    // what --baseline does anyway, and two of them (a DROP and a MODIFY) add
    // nothing an ADD-shaped check could look for.
    it('does not demand the check for the pre-runner files themselves', async () => {
      const dir = makeDir({
        'drop_squad_permissions.sql': 'ALTER TABLE squad_members DROP COLUMN can_read;',
        'widen_log_content.sql': 'ALTER TABLE logs MODIFY html_content MEDIUMTEXT;',
      });
      const db = fakeDb({ tables: ['users'], columns: [] });

      const lines = [];
      const result = await runMigrations({
        query: db.query,
        dir,
        adoptFreshInstall: true,
        log: message => lines.push(message),
      });

      expect(result.baselined).toEqual([
        'drop_squad_permissions.sql',
        'widen_log_content.sql',
      ]);
      expect(lines.join('\n')).toContain('Every one of them is a pre-runner file');
    });

    it('prints every file it is about to adopt, before adopting any of it', async () => {
      const dir = bothKinds();
      const db = freshInstall();
      const lines = [];
      const spy = message => lines.push({ message, callsSoFar: db.calls.length });

      await runMigrations({ query: db.query, dir, adoptFreshInstall: true, log: spy });

      const firstInsert = db.calls.findIndex(c =>
        c.sql.startsWith('INSERT INTO schema_migrations')
      );
      expect(firstInsert).toBeGreaterThan(0);

      for (const filename of [TOKEN_PURPOSE, 'add_watches.sql']) {
        const printed = lines.find(
          line => line.message.includes(filename) && line.callsSoFar <= firstInsert
        );
        expect(printed, `${filename} was not printed before the first INSERT`).toBeDefined();
      }
    });

    it('does not claim init.sql contains files it never checked', async () => {
      const dir = bothKinds();
      const db = freshInstall();
      const lines = [];

      await runMigrations({
        query: db.query,
        dir,
        adoptFreshInstall: true,
        log: message => lines.push(message),
      });

      const summary = lines.join('\n');
      expect(summary).toContain('1 of them postdate the pre-runner baseline');
      expect(summary).toMatch(/checked\s+against information_schema/);
    });

    // ── one transaction ───────────────────────────────────

    it('records the whole adoption in a single transaction', async () => {
      const dir = bothKinds();
      const db = freshInstall();

      await runMigrations({ query: db.query, dir, adoptFreshInstall: true, log });

      const shape = db.calls
        .map(c => c.sql)
        .filter(sql => /^(START TRANSACTION|COMMIT|ROLLBACK|INSERT INTO schema_migrations)/.test(sql))
        .map(sql => (sql.startsWith('INSERT') ? 'INSERT' : sql));
      expect(shape).toEqual(['START TRANSACTION', 'INSERT', 'INSERT', 'COMMIT']);
    });

    // Measured before the fix: killing the run partway left the rows it had
    // already inserted, and BOTH adoption modes then refused forever, over
    // bookkeeping the operator never asked for.
    it('leaves no rows behind when an insert dies partway', async () => {
      const dir = makeDir({
        'add_watches.sql': '-- watches',
        'p0_github_sync.sql': '-- p0',
        'p1_github_embeds.sql': '-- p1',
      });
      const db = fakeDb({ tables: ['users'] });
      const underlying = db.query.getMockImplementation();
      let inserts = 0;
      db.query.mockImplementation(async (sql, params) => {
        if (sql.startsWith('INSERT INTO schema_migrations') && ++inserts === 2) {
          throw new Error('Lost connection to MySQL server during query');
        }
        return underlying(sql, params);
      });

      await expect(
        runMigrations({ query: db.query, dir, adoptFreshInstall: true, log })
      ).rejects.toThrow(/Lost connection/);

      expect(db.calls.some(c => c.sql === 'ROLLBACK')).toBe(true);
      expect(db.calls.some(c => c.sql === 'COMMIT')).toBe(false);
      expect(db.rows.size).toBe(0);
    });

    // ── the guards that were already there ────────────────

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

    // GET_LOCK names are instance-wide in MySQL 8. A bare 'cloudcodex_migrate'
    // makes two Cloud Codex schemas on one server serialise against each other
    // while the loser is told the contention is against its own database.
    it('scopes the lock name to the database, not the whole MySQL server', async () => {
      const dir = makeDir({ 'a.sql': '-- a' });
      const db = fakeDb();

      await runMigrations({ query: db.query, dir, log });

      const get = db.calls.find(c => c.sql.startsWith('SELECT GET_LOCK'));
      const release = db.calls.find(c => c.sql.startsWith('SELECT RELEASE_LOCK'));
      expect(get.sql).toContain("CONCAT('cloudcodex_migrate:', DATABASE())");
      expect(release.sql).toContain("CONCAT('cloudcodex_migrate:', DATABASE())");
    });

    it('names the database it is contending for when the wait times out', async () => {
      const dir = makeDir({ 'a.sql': '-- a' });
      const db = fakeDb({ lockGranted: false, database: 'codex_two' });

      await expect(runMigrations({ query: db.query, dir, log })).rejects.toThrow(
        /lock 'cloudcodex_migrate:codex_two'[\s\S]*`codex_two` database/
      );
    });

    // MySQL answers 0 for "someone holds it" and NULL for "the attempt itself
    // errored". Reporting the second as the first sends the operator looking
    // for a second run that does not exist.
    it('tells NULL apart from a timeout', async () => {
      const dir = makeDir({ 'a.sql': '-- a' });
      const db = fakeDb({ lockGranted: null });

      const err = await runMigrations({ query: db.query, dir, log }).catch(e => e);

      expect(err.message).toMatch(/returned NULL/);
      expect(err.message).not.toMatch(/Another migration run is in progress/);
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

    // Measured: a fresh install baselined with the wrong command then dies here
    // on its first ALTER, and the old message told the operator the database
    // "may be partially migrated" and to restore a dump. Nothing had run, and a
    // five-minute-old install has no dump. It failed identically forever.
    it('explains a duplicate-object error instead of sending the operator to a dump', async () => {
      const body = 'ALTER TABLE password_reset_tokens ADD COLUMN purpose VARCHAR(32);';
      const dir = makeDir({ 'zz_newer.sql': body });
      const db = fakeDb({ failOnBody: 'purpose', failCode: 'ER_DUP_FIELDNAME' });

      const err = await runMigrations({ query: db.query, dir, log }).catch(e => e);

      expect(err.message).toContain('ER_DUP_FIELDNAME');
      expect(err.message).toMatch(/already there/);
      expect(err.message).toMatch(/needs `npm run migrate -- --adopt-fresh-install`, not/);
      expect(err.message).toContain("VALUES ('zz_newer.sql'");
      expect(err.message).toContain(sha256(body));
    });

    it('covers table-exists and duplicate-key the same way', async () => {
      for (const code of ['ER_TABLE_EXISTS_ERROR', 'ER_DUP_KEYNAME']) {
        const dir = makeDir({ 'zz_newer.sql': 'CREATE TABLE watches (id INT);' });
        const db = fakeDb({ failOnBody: 'watches', failCode: code });

        const err = await runMigrations({ query: db.query, dir, log }).catch(e => e);
        expect(err.message).toContain(code);
        expect(err.message).toMatch(/--adopt-fresh-install/);
      }
    });

    it('says none of that for an ordinary SQL error', async () => {
      const dir = makeDir({ 'a.sql': '-- boom' });
      const db = fakeDb({ failOnBody: 'boom' });

      const err = await runMigrations({ query: db.query, dir, log }).catch(e => e);

      expect(err.message).toMatch(/may be partially migrated/);
      expect(err.message).not.toMatch(/--adopt-fresh-install/);
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
