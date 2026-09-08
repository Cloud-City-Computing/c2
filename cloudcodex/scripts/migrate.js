/**
 * Cloud Codex - database migration runner
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

/*
 * Applies the plain SQL files in the repo-root `migrations/` directory in
 * lexicographic order, records each one in `schema_migrations`, and refuses to
 * run a file whose sha256 no longer matches what was recorded when it was
 * applied. Deliberately tiny and dependency-free: no ORM and no migration
 * framework, so the SQL stays literal and the runner is readable in one sitting.
 *
 * ── MySQL does not roll back DDL ────────────────────────────────────────────
 *
 * MySQL issues an implicit COMMIT before and after every DDL statement, so
 * "one transaction per file" cannot mean on MySQL what it means on Postgres.
 * A file that runs three ALTERs and fails on the third leaves the first two
 * committed, and no ROLLBACK can undo them. The runner still opens a
 * transaction per file, which covers the DML statements that do honour it
 * (the DELETE in a data migration, the bookkeeping INSERT), and on failure it
 * reports which file failed and that the database MAY BE PARTIALLY MIGRATED.
 * It does not claim a rollback it cannot deliver. Take a dump first; the
 * recovery path is restore-and-retry, not re-run.
 *
 * ── Baseline adoption ───────────────────────────────────────────────────────
 *
 * The shipped migration files are deltas against `init.sql`, not a schema of
 * their own: `drop_squad_permissions.sql` presumes a table only `init.sql`
 * creates, and lexicographic order puts it ahead of most `add_*.sql` files, so
 * replaying them against an empty database fails on the first ALTER. The
 * runner therefore never bootstraps a schema. It refuses when `users` is
 * missing, and it refuses on an existing install that has no
 * `schema_migrations` table, printing the one-time `--baseline` command
 * instead. Failing closed matters: with no bookkeeping there is no way to tell
 * a fully-migrated database from a partly-migrated one, and guessing would
 * either re-run DDL or silently skip a migration the install never got.
 *
 * `--baseline` adopts the CLOSED list in LEGACY_BASELINE, never the contents of
 * the directory. Anything else is pending. See that constant for why.
 *
 * A brand-new install is the opposite case and gets its own door,
 * `--adopt-fresh-install`, which records EVERY file on disk. That is correct
 * there and only there: `init.sql` is kept in sync with every migration file
 * (the dual-tracking rule), so a database it has just built already has all of
 * them, and applying any would be a duplicate-column error. The flag refuses
 * once schema_migrations holds a row, which is what keeps it away from a
 * tracked install where it would swallow genuinely-pending work.
 *
 * `schema_migrations` is runner-owned bookkeeping and is deliberately NOT in
 * `init.sql`. If a fresh install arrived with the table already present and
 * empty, the runner would read "nothing applied" and try to replay all the
 * deltas against the schema they were already folded into.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The repo-root `migrations/` directory: cloudcodex/scripts -> cloudcodex -> repo root. */
export const MIGRATIONS_DIR = path.resolve(HERE, '..', '..', 'migrations');

/**
 * The migration files that shipped BEFORE this runner existed, and which every
 * install created before it therefore already has applied by hand.
 *
 * DO NOT replace this with a scan of the migrations directory. The baseline set
 * is a historical fact about what shipped before bookkeeping existed; it is not
 * a property of the current checkout, and the two diverge the moment a new
 * migration lands. A directory sweep would let an operator upgrading across
 * that release run `--baseline`, mark a genuinely-unapplied file as applied,
 * and then run new code against a schema that never got the column: the runner
 * would report success the whole way while the app 500s on every insert. Any
 * file not named here is pending, `--baseline` or not.
 *
 * This list is closed. A migration added from here on is never appended to it.
 */
export const LEGACY_BASELINE = Object.freeze([
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

/** Default progress sink. Informational output goes to stdout, errors to stderr. */
const defaultLog = message => process.stdout.write(`${message}\n`);

/**
 * The sha256 of a migration file's contents, as lowercase hex.
 * @param { String } text
 * @returns { String }
 */
export function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Every `.sql` file in `dir`, sorted lexicographically. Lexicographic order IS
 * the migration order.
 * @param { String } dir
 * @returns { String[] }
 */
export function listMigrationFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    // Worth naming explicitly, because the one place this happens is inside
    // the published app image: the image is built from the cloudcodex/ context
    // (Dockerfile `COPY . .`), so scripts/ ships but the repo-root migrations/
    // does not. Compose mounts it back in; a bare ENOENT would send an operator
    // hunting for the wrong problem.
    throw new Error(
      `No migrations directory at ${dir}.\n` +
        'The runner reads the repo-root migrations/ directory. Inside the app container that\n' +
        'path exists only because compose mounts it: see the app service in\n' +
        'docker-compose-release.yml, and "Upgrades" in docs/deployment.md.'
    );
  }

  return entries
    .filter(entry => entry.endsWith('.sql'))
    .sort();
}

/**
 * Whether a table exists in the connected database.
 * @param { (sql: string, params?: Array) => Promise<Array> } query
 * @param { String } tableName
 * @returns { Promise<Boolean> }
 */
export async function tableExists(query, tableName) {
  const rows = await query(
    `SELECT 1 AS present FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1`,
    [tableName]
  );
  return rows.length > 0;
}

/**
 * Create the bookkeeping table if it is not already there.
 *
 * Always outside a transaction, so a freshly baselined database and a
 * half-migrated one take the identical path.
 * @param { (sql: string, params?: Array) => Promise<Array> } query
 */
export async function ensureBookkeeping(query) {
  await query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename   VARCHAR(255) PRIMARY KEY,
       checksum   CHAR(64) NOT NULL,
       applied_ms INT NOT NULL,
       applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
     )`
  );
}

/**
 * The filename -> checksum map of everything already applied.
 * @param { (sql: string, params?: Array) => Promise<Array> } query
 * @returns { Promise<Map<String, String>> }
 */
export async function readApplied(query) {
  const rows = await query(`SELECT filename, checksum FROM schema_migrations`);
  return new Map(rows.map(row => [row.filename, row.checksum]));
}

/** MySQL advisory lock guarding the apply phase, and how long to wait for it. */
const LOCK_NAME = 'cloudcodex_migrate';
const LOCK_TIMEOUT_SECONDS = 10;

/**
 * Run `fn` holding a MySQL advisory lock, so two concurrent runs cannot both
 * decide the same file is pending.
 *
 * Without it MySQL still serialises the DDL, but the loser gets
 * ER_DUP_FIELDNAME and the runner tells it the database may be partially
 * migrated and to restore a dump. The database is fine; the misleading remedy
 * is the harm. `GET_LOCK` is connection-scoped, which is exactly right here:
 * the CLI holds one dedicated connection for the whole run.
 * @param { (sql: string, params?: Array) => Promise<Array> } query
 * @param { Function } fn
 */
export async function withMigrationLock(query, fn) {
  const [row] = await query('SELECT GET_LOCK(?, ?) AS locked', [LOCK_NAME, LOCK_TIMEOUT_SECONDS]);

  if (!row || row.locked !== 1) {
    throw new Error(
      `Could not acquire the migration lock '${LOCK_NAME}' within ${LOCK_TIMEOUT_SECONDS}s.\n` +
        'Another migration run is in progress against this database. Wait for it to finish\n' +
        'and check its output before running again.'
    );
  }

  try {
    return await fn();
  } finally {
    try {
      await query('SELECT RELEASE_LOCK(?) AS released', [LOCK_NAME]);
    } catch (err) {
      // Never let this replace the real error. The lock is connection-scoped,
      // so it dies with the connection anyway.
      console.error(`[${new Date().toISOString()}] migrate RELEASE_LOCK failed:`, err);
    }
  }
}

const USAGE = 'Usage: npm run migrate [-- --baseline | -- --adopt-fresh-install]';

/**
 * Parse the runner's CLI arguments.
 *
 * An unknown flag is refused rather than ignored: `--baselien` silently
 * applying every pending migration to a production database is the worst
 * available outcome of a typo. The two adoption modes are mutually exclusive
 * because they adopt different sets and only one can be right for a given
 * database.
 * @param { String[] } argv
 * @returns { { baseline: Boolean, adoptFreshInstall: Boolean } }
 */
export function parseArgs(argv) {
  let baseline = false;
  let adoptFreshInstall = false;

  for (const arg of argv) {
    if (arg === '--baseline') {
      baseline = true;
      continue;
    }
    if (arg === '--adopt-fresh-install') {
      adoptFreshInstall = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}. ${USAGE}`);
  }

  if (baseline && adoptFreshInstall) {
    throw new Error(
      `--baseline and --adopt-fresh-install adopt different sets and cannot be combined. ${USAGE}`
    );
  }

  return { baseline, adoptFreshInstall };
}

/**
 * Apply pending migrations, or adopt the legacy files as an applied baseline.
 *
 * The core takes an injected query executor (the `c2_query` shape,
 * `(sql, params) => Promise<rows>`) and an injected directory, so it is
 * testable without a live MySQL. Only `main()` opens a real connection.
 *
 * @param { Object }   options
 * @param { Function } options.query    - `(sql, params) => Promise<Array>`
 * @param { String }   options.dir      - directory holding the .sql files
 * @param { Boolean }  [options.baseline] - record the legacy files, apply none
 * @param { Boolean }  [options.adoptFreshInstall] - record every file, apply none
 * @param { Function } [options.log]    - progress sink
 * @returns { Promise<{ applied: String[], baselined: String[], pending: String[] }> }
 */
export async function runMigrations({
  query,
  dir,
  baseline = false,
  adoptFreshInstall = false,
  log = defaultLog,
}) {
  // The runner never bootstraps a schema. Without `users` there is nothing for
  // the deltas in migrations/ to be deltas against. Checked before the lock:
  // it needs no serialising and it is the most common refusal.
  if (!(await tableExists(query, 'users'))) {
    throw new Error(
      'Refusing to run: this database has no `users` table, so it has never been initialised.\n' +
        'Run init.sql first (a fresh Docker volume does this automatically), then re-run this command.'
    );
  }

  return withMigrationLock(query, () =>
    runUnderLock({ query, dir, baseline, adoptFreshInstall, log })
  );
}

/**
 * The body of a run, holding the advisory lock.
 * @param { Object } options - as `runMigrations`, with every default resolved
 * @returns { Promise<{ applied: String[], baselined: String[], pending: String[] }> }
 */
async function runUnderLock({ query, dir, baseline, adoptFreshInstall, log }) {
  const files = listMigrationFiles(dir);

  if (adoptFreshInstall) {
    await ensureBookkeeping(query);
    const alreadyRecorded = await readApplied(query);

    // The one state in which adopting everything is correct is a database
    // `init.sql` has just built, and such a database has no bookkeeping yet.
    // Refusing once rows exist is what stops this flag being used on a tracked
    // install, where it would sweep genuinely-pending migrations into "applied"
    // without running them.
    if (alreadyRecorded.size > 0) {
      throw new Error(
        `Refusing to adopt a fresh install: schema_migrations already records ` +
          `${alreadyRecorded.size} migration(s), so this database is already tracked.\n` +
          '--adopt-fresh-install is only for a database init.sql has just created. On a tracked\n' +
          'install, run `npm run migrate` to apply whatever is pending.'
      );
    }

    const baselined = [];
    for (const filename of files) {
      const contents = readFileSync(path.join(dir, filename), 'utf8');
      await query(
        `INSERT INTO schema_migrations (filename, checksum, applied_ms) VALUES (?, ?, ?)`,
        [filename, sha256(contents), 0]
      );
      baselined.push(filename);
    }

    log(
      `adopted ${baselined.length} migration file(s) as already applied, because init.sql ` +
        'already contains every one of them. Applied none.'
    );
    return { applied: [], baselined, pending: [] };
  }

  if (baseline) {
    await ensureBookkeeping(query);
    const alreadyRecorded = await readApplied(query);
    const baselined = [];

    // Only the closed LEGACY_BASELINE list is adopted, never "whatever .sql
    // files happen to be in the directory". See the constant for why.
    for (const filename of files.filter(f => LEGACY_BASELINE.includes(f))) {
      // A file already recorded keeps the checksum it was recorded with:
      // overwriting it here would launder exactly the drift the guard exists
      // to catch.
      if (alreadyRecorded.has(filename)) continue;

      const contents = readFileSync(path.join(dir, filename), 'utf8');
      await query(
        `INSERT INTO schema_migrations (filename, checksum, applied_ms) VALUES (?, ?, ?)`,
        [filename, sha256(contents), 0]
      );
      baselined.push(filename);
    }

    const pending = files.filter(f => !LEGACY_BASELINE.includes(f) && !alreadyRecorded.has(f));

    log(
      baselined.length > 0
        ? `baselined ${baselined.length} legacy migration file(s) as already applied: ${baselined.join(', ')}`
        : 'nothing to baseline: every legacy migration file is already recorded'
    );
    if (pending.length > 0) {
      log(
        `${pending.length} migration(s) postdate the baseline and are still pending: ` +
          `${pending.join(', ')}. Run \`npm run migrate\` to apply them.`
      );
    }

    return { applied: [], baselined, pending };
  }

  if (!(await tableExists(query, 'schema_migrations'))) {
    throw new Error(
      'Refusing to run: this install has a schema but no `schema_migrations` table, so the\n' +
        'runner cannot tell which of the existing migrations it has already had.\n' +
        'Record a starting point first, from cloudcodex/. Which one depends on where the\n' +
        'schema came from:\n\n' +
        '  init.sql just built this database (a brand-new install):\n' +
        '      npm run migrate -- --adopt-fresh-install\n' +
        '    init.sql already contains every migration in migrations/, so all of them are\n' +
        '    recorded as applied and none is run.\n\n' +
        '  this install predates the runner and was migrated by hand:\n' +
        '      npm run migrate -- --baseline\n' +
        '    records only the migrations that shipped before the runner existed. Anything\n' +
        '    added since stays pending and is applied by the next ordinary run.'
    );
  }

  await ensureBookkeeping(query);
  const applied = await readApplied(query);

  // Drift guard over the WHOLE set before anything is applied. Per-file
  // checking would already have applied every pending file that sorts ahead of
  // the drifted one by the time it noticed.
  const contentsByFile = new Map();
  for (const filename of files) {
    const contents = readFileSync(path.join(dir, filename), 'utf8');
    contentsByFile.set(filename, contents);

    const recorded = applied.get(filename);
    if (recorded !== undefined && recorded !== sha256(contents)) {
      throw new Error(
        `Migration ${filename} has changed since it was applied (checksum mismatch).\n` +
          'Applied migrations are immutable: the recorded checksum is the only evidence of what\n' +
          'this database actually ran. Fix forward with a new migration file instead of editing\n' +
          'this one, or restore the file to the contents that were applied.'
      );
    }
  }

  const pending = files.filter(filename => !applied.has(filename));
  if (pending.length === 0) {
    log('no pending migrations');
    return { applied: [], baselined: [], pending: [] };
  }

  const appliedNow = [];
  for (const filename of pending) {
    const contents = contentsByFile.get(filename);
    const startedAt = Date.now();

    await query('START TRANSACTION');
    try {
      // The one place SQL is not parameterized, and it cannot be: the
      // migration file body IS the statement. It is repo-controlled, reviewed
      // content, never user input, and it is streamed verbatim rather than
      // split on ';' so a body containing a ';' inside a string or a routine
      // definition is not shredded.
      await query(contents);
      await query(
        `INSERT INTO schema_migrations (filename, checksum, applied_ms) VALUES (?, ?, ?)`,
        [filename, sha256(contents), Date.now() - startedAt]
      );
      await query('COMMIT');
    } catch (err) {
      try {
        await query('ROLLBACK');
      } catch (rollbackErr) {
        // A failing rollback must never replace the error that caused it: the
        // original names the statement that actually broke.
        console.error(`[${new Date().toISOString()}] migrate ROLLBACK failed:`, rollbackErr);
      }
      throw new Error(
        `Migration ${filename} failed. MySQL implicitly commits DDL, so any CREATE, ALTER or\n` +
          'DROP inside this file that ran before the failure is already committed and was NOT\n' +
          'rolled back: the database may be partially migrated. Inspect the schema, or restore\n' +
          'the dump you took before upgrading, before running this again.',
        { cause: err }
      );
    }

    log(`applied ${filename} (${Date.now() - startedAt}ms)`);
    appliedNow.push(filename);
  }

  return { applied: appliedNow, baselined: [], pending: [] };
}

/**
 * Whether this module is the process entry point.
 * @param { String } moduleUrl
 * @returns { Boolean }
 */
export function isDirectRun(moduleUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  return pathToFileURL(entry).href === moduleUrl;
}

/**
 * The connection settings the runner uses, from an environment.
 *
 * `multipleStatements` is the reason this is a separate connection rather than
 * the shared pool in mysql_connect.js: that pool deliberately does NOT set it,
 * and every route in the app uses that pool. A migration file is many
 * statements; a route's query never is, and widening the pool the whole app
 * runs on to suit the runner would be the wrong trade.
 * @param { Object } env - a `process.env` shape
 * @returns { Object } mysql2 connection options
 */
export function resolveDbConfig(env) {
  if (!env.DB_USER || !env.DB_PASS) {
    throw new Error(
      'Missing required environment variables: DB_USER, DB_PASS.\n' +
        'Copy .env.example to .env and fill in your database credentials.'
    );
  }

  return {
    host: env.DB_HOST ?? 'localhost',
    user: env.DB_USER,
    password: env.DB_PASS,
    database: env.DB_NAME ?? 'c2',
    multipleStatements: true,
  };
}

/**
 * The CLI. The only place a real connection is opened, so importing this
 * module (as the tests do) connects to nothing.
 * @param { String[] } argv
 */
export async function main(argv) {
  const { baseline, adoptFreshInstall } = parseArgs(argv);

  dotenv.config({ path: path.resolve(HERE, '..', '..', '.env'), quiet: true });

  const connection = await mysql.createConnection(resolveDbConfig(process.env));

  try {
    // `query`, not `execute`: prepared statements cannot carry a multi-statement
    // migration body, and mysql2 escapes the bound params here just the same.
    const query = async (sql, params) => {
      const [rows] = await connection.query(sql, params);
      return Array.isArray(rows) ? rows : [];
    };
    await runMigrations({ query, dir: MIGRATIONS_DIR, baseline, adoptFreshInstall });
  } finally {
    await connection.end();
  }
}

if (isDirectRun(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch (err) {
    console.error(`[${new Date().toISOString()}] migrate failed:\n${err.message}`);
    if (err.cause) console.error(err.cause);
    process.exit(1);
  }
}
