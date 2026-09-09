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
 * them, and applying any would be a duplicate-column error.
 *
 * That flag is the most dangerous thing in this file, because the population
 * that reaches for it (an install with no bookkeeping) includes both the fresh
 * database it is for and the decade-old one it would wreck, and both look
 * identical from the bookkeeping side: zero rows. "No rows yet" is therefore
 * not evidence of anything, and emptiness of `logs`/`workspaces` is not either,
 * since `bootstrapInstance()` seeds a workspace, squad, archive and document on
 * the first admin boot. So the guard is a POSITIVE check instead: for every
 * file that postdates LEGACY_BASELINE, the runner asks information_schema
 * whether the table or column that file adds is ALREADY there, and refuses
 * unless it is. That is exactly the claim `--adopt-fresh-install` makes on the
 * operator's behalf, checked rather than assumed, and it is what separates the
 * safe case (the change is present, adopting it is bookkeeping) from the
 * catastrophic one (the change is absent, adopting it buries the migration
 * forever). The pre-runner files are exempt from the check because adopting
 * exactly those is what `--baseline` does anyway, and because they include a
 * DROP and a MODIFY that no ADD-shaped check could read.
 *
 * The flag also refuses once schema_migrations holds a row, which keeps it away
 * from a tracked install where it would swallow genuinely-pending work.
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
 * The readable error behind a failure to read the migrations directory, or
 * null when the errno has no story worth telling.
 *
 * Split out from `listMigrationFiles` so both branches are testable without
 * arranging a real unreadable directory, which depends on the uid the suite
 * happens to run as.
 * @param { Error & { code?: String } } err
 * @param { String } dir
 * @returns { Error | null }
 */
export function describeMigrationsDirError(err, dir) {
  // Both of these happen inside the published app image, and neither is what
  // the raw errno suggests. The image is built from the cloudcodex/ context
  // (Dockerfile `COPY . .`), so scripts/ ships but the repo-root migrations/
  // does not; compose mounts it back in.
  if (err.code === 'ENOENT') {
    return new Error(
      `No migrations directory at ${dir}.\n` +
        'The runner reads the repo-root migrations/ directory. Inside the app container that\n' +
        'path exists only because compose mounts it: see the app service in\n' +
        'docker-compose-release.yml, and "Upgrades" in docs/deployment.md.'
    );
  }

  // The mount exists and is unreadable, which on an SELinux host is the default
  // outcome for a bind mount with no relabel flag: the directory keeps its host
  // label and the container process cannot read it. A bare EACCES out of
  // scandir sends an operator hunting file permissions that are already fine.
  if (err.code === 'EACCES' || err.code === 'EPERM') {
    return new Error(
      `Cannot read the migrations directory at ${dir}: ${err.code}, permission denied.\n` +
        'On a host running SELinux (Fedora, RHEL, CentOS, Rocky) a bind mount is unreadable\n' +
        'inside the container unless the mount carries a relabel flag. The compose files ship\n' +
        '`./migrations:/migrations:ro,z` for exactly this. A container created before that\n' +
        'line was added keeps its old mount, and `docker compose pull` does not recreate it,\n' +
        'so run the migration through `docker compose ... run --rm app npm run migrate`,\n' +
        'which builds a one-off container from the current compose file.\n' +
        'If SELinux is not in play, check the ownership and mode of the directory itself.'
    );
  }

  return null;
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
    throw describeMigrationsDirError(err, dir) ?? err;
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
 * Whether a column exists on a table in the connected database.
 * @param { (sql: string, params?: Array) => Promise<Array> } query
 * @param { String } tableName
 * @param { String } columnName
 * @returns { Promise<Boolean> }
 */
export async function columnExists(query, tableName, columnName) {
  const rows = await query(
    `SELECT 1 AS present FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1`,
    [tableName, columnName]
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

/**
 * MySQL advisory lock guarding the apply phase, and how long to wait for it.
 *
 * `GET_LOCK` names live in one namespace per SERVER, not per database, so the
 * name has to carry the database or two Cloud Codex schemas on the same MySQL
 * instance serialise against each other for no reason, and the loser is told a
 * run is in progress against a database nothing is touching. `DATABASE()` is
 * evaluated server-side rather than interpolated from config, so the name
 * matches whatever schema this connection is actually pointed at. The prefix is
 * a source constant, never user input.
 */
const LOCK_PREFIX = 'cloudcodex_migrate';
const LOCK_NAME_SQL = `CONCAT('${LOCK_PREFIX}:', DATABASE())`;
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
 *
 * NULL and 0 are different answers and get different messages: MySQL returns 0
 * when the wait timed out (someone else holds it) and NULL when the attempt
 * errored, for example because this connection was killed while it waited.
 * Reporting an errored attempt as contention sends the operator to look for a
 * second run that does not exist.
 * @param { (sql: string, params?: Array) => Promise<Array> } query
 * @param { Function } fn
 */
export async function withMigrationLock(query, fn) {
  const [row] = await query(`SELECT GET_LOCK(${LOCK_NAME_SQL}, ?) AS locked, DATABASE() AS db`, [
    LOCK_TIMEOUT_SECONDS,
  ]);

  const database = row && row.db ? row.db : '<unknown>';
  const lockName = `${LOCK_PREFIX}:${database}`;

  if (!row || row.locked === null || row.locked === undefined) {
    throw new Error(
      `GET_LOCK('${lockName}') returned NULL, so the lock request errored rather than timing\n` +
        'out. MySQL answers NULL when the attempt itself fails, for example when this\n' +
        'connection is killed while it waits. Nothing has been migrated. Check the MySQL\n' +
        'error log and the connection, then run again.'
    );
  }

  if (row.locked !== 1) {
    throw new Error(
      `Could not acquire the migration lock '${lockName}' within ${LOCK_TIMEOUT_SECONDS}s.\n` +
        `Another migration run is in progress against the \`${database}\` database. Wait for it\n` +
        'to finish and check its output before running again.\n' +
        'The lock name carries the database, so runs against a DIFFERENT Cloud Codex schema on\n' +
        'the same MySQL server do not contend with this one.'
    );
  }

  try {
    return await fn();
  } finally {
    try {
      await query(`SELECT RELEASE_LOCK(${LOCK_NAME_SQL}) AS released`);
    } catch (err) {
      // Never let this replace the real error. The lock is connection-scoped,
      // so it dies with the connection anyway.
      console.error(`[${new Date().toISOString()}] migrate RELEASE_LOCK failed:`, err);
    }
  }
}

/**
 * SQL comments, stripped before anything is parsed out of a migration body.
 * Every file here opens with a long `--` header, and those headers quote the
 * DDL they are describing (`2026-09-08-token-purpose.sql` spells out the
 * ALTER that reverses it), so parsing an uncommented body is not optional.
 */
const SQL_COMMENTS = /\/\*[\s\S]*?\*\/|--[^\n]*|#[^\n]*/g;

/** ADD clauses that name something other than a column. */
const NOT_A_COLUMN = /^(COLUMN|INDEX|KEY|UNIQUE|PRIMARY|FOREIGN|FULLTEXT|SPATIAL|CONSTRAINT|CHECK|PARTITION)$/i;

/**
 * The tables and columns a migration file claims to create, read straight out
 * of its SQL.
 *
 * Deliberately narrow: `CREATE TABLE x` and `ALTER TABLE x ADD [COLUMN] y`, and
 * nothing else. This is not a SQL parser and must never grow into one. It backs
 * exactly one question, asked only of files that postdate LEGACY_BASELINE
 * before `--adopt-fresh-install` records them: does this database ALREADY have
 * what this file adds? A file it cannot read anything out of yields an empty
 * list, and the caller refuses rather than adopting on faith.
 * @param { String } sql - a migration file body
 * @returns { Array<{ kind: 'table'|'column', table: String, column?: String }> }
 */
export function schemaClaims(sql) {
  const claims = [];

  for (const statement of sql.replace(SQL_COMMENTS, ' ').split(';')) {
    const created = /^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z0-9_$]+)`?/i.exec(
      statement
    );
    if (created) {
      claims.push({ kind: 'table', table: created[1] });
      continue;
    }

    const altered = /^\s*ALTER\s+TABLE\s+`?([A-Za-z0-9_$]+)`?/i.exec(statement);
    if (!altered) continue;

    const adds = statement.matchAll(/\bADD\s+(?:COLUMN\s+)?`?([A-Za-z0-9_$]+)`?/gi);
    for (const add of adds) {
      if (NOT_A_COLUMN.test(add[1])) continue;
      claims.push({ kind: 'column', table: altered[1], column: add[1] });
    }
  }

  return claims;
}

/**
 * Prove, against information_schema, that this database already contains what
 * `filename` adds, and return a human list of the evidence.
 *
 * Throws with the operator's next command when it cannot. This is the positive
 * signal `--adopt-fresh-install` rests on: the flag asserts "init.sql already
 * built all of this", and an install that predates the change cannot produce
 * the column to back the assertion.
 * @param { (sql: string, params?: Array) => Promise<Array> } query
 * @param { String } filename
 * @param { String } contents
 * @returns { Promise<String> } the objects found, for the adoption log
 */
export async function assertSchemaAlreadyHas(query, filename, contents) {
  const claims = schemaClaims(contents);

  if (claims.length === 0) {
    throw new Error(
      `Refusing to adopt a fresh install: ${filename} postdates the pre-runner baseline and\n` +
        'the runner cannot tell from it whether this database already has its changes. It\n' +
        'checks every such file against information_schema first, and this one declares no\n' +
        'CREATE TABLE or ADD COLUMN to check.\n\n' +
        'Look at the file and at the schema. If the change is already there, record it by hand:\n\n' +
        '    INSERT INTO schema_migrations (filename, checksum, applied_ms)\n' +
        `    VALUES ('${filename}', '${sha256(contents)}', 0);\n\n` +
        'If it is not there, this is not a fresh install. Run `npm run migrate -- --baseline`\n' +
        'and then `npm run migrate`, which applies this file for real.'
    );
  }

  const present = [];
  const missing = [];

  for (const claim of claims) {
    const label = claim.kind === 'table' ? claim.table : `${claim.table}.${claim.column}`;
    const found =
      claim.kind === 'table'
        ? await tableExists(query, claim.table)
        : await columnExists(query, claim.table, claim.column);
    (found ? present : missing).push(label);
  }

  if (missing.length > 0) {
    throw new Error(
      `Refusing to adopt a fresh install: this database does not contain what ${filename}\n` +
        `adds (missing: ${missing.join(', ')}), so init.sql did not build it. It is an\n` +
        'existing install that never got this migration.\n\n' +
        '--adopt-fresh-install records every file in migrations/ as applied WITHOUT running\n' +
        'any of it. Doing that here would bury this migration permanently: every later run\n' +
        'would report "no pending migrations" while the column stayed missing and the app\n' +
        'kept failing on it.\n\n' +
        'Record the pre-runner baseline instead, then apply what is genuinely pending, from\n' +
        'cloudcodex/:\n\n' +
        '    npm run migrate -- --baseline\n' +
        '    npm run migrate'
    );
  }

  return present.join(', ');
}

/**
 * Record adoption rows in ONE transaction.
 *
 * Adoption is pure DML, so unlike the apply path a transaction here means what
 * it says: MySQL has no DDL to implicitly commit. Without it, a run that dies
 * partway leaves some rows behind, and both adoption modes then refuse forever
 * ("already records N migration(s)") over bookkeeping the operator never asked
 * for and is not told how to remove.
 * @param { (sql: string, params?: Array) => Promise<Array> } query
 * @param { Array<[String, String]> } rows - [filename, checksum] pairs
 */
export async function recordAdoptions(query, rows) {
  if (rows.length === 0) return;

  await query('START TRANSACTION');
  try {
    for (const [filename, checksum] of rows) {
      await query(
        `INSERT INTO schema_migrations (filename, checksum, applied_ms) VALUES (?, ?, ?)`,
        [filename, checksum, 0]
      );
    }
    await query('COMMIT');
  } catch (err) {
    try {
      await query('ROLLBACK');
    } catch (rollbackErr) {
      // As in the apply path: never let a failing rollback replace the error
      // that caused it.
      console.error(`[${new Date().toISOString()}] migrate ROLLBACK failed:`, rollbackErr);
    }
    throw err;
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
 * MySQL errors that mean "the schema already has this", rather than "the
 * migration broke": duplicate column (1060), table already exists (1050),
 * duplicate index name (1061).
 */
const SCHEMA_ALREADY_HAS_CODES = new Set([
  'ER_DUP_FIELDNAME',
  'ER_TABLE_EXISTS_ERROR',
  'ER_DUP_KEYNAME',
]);

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

    // The positive check. Zero bookkeeping rows is not evidence of a fresh
    // install: an install that predates the runner has zero rows BY
    // DEFINITION, which is the whole reason it is reaching for an adoption
    // flag. So every file that postdates the pre-runner baseline has to be
    // shown to be in the schema ALREADY before it is recorded as applied.
    const checksums = new Map();
    const evidence = new Map();
    for (const filename of files) {
      const contents = readFileSync(path.join(dir, filename), 'utf8');
      checksums.set(filename, sha256(contents));
      if (LEGACY_BASELINE.includes(filename)) continue;
      evidence.set(filename, await assertSchemaAlreadyHas(query, filename, contents));
    }

    // Print what is about to be recorded, before recording it. An operator who
    // reaches for this flag by mistake sees the names of the migrations it is
    // about to declare applied.
    log(`adopting ${files.length} migration file(s) as already applied, and applying none:`);
    for (const filename of files) {
      log(
        evidence.has(filename)
          ? `  ${filename}  (postdates the baseline; already in the schema: ${evidence.get(filename)})`
          : `  ${filename}`
      );
    }

    await recordAdoptions(
      query,
      files.map(filename => [filename, checksums.get(filename)])
    );

    const baselined = [...files];
    log(
      `adopted ${baselined.length} migration file(s) as already applied, and applied none. ` +
        (evidence.size === 0
          ? 'Every one of them is a pre-runner file that --baseline records too.'
          : `${evidence.size} of them postdate the pre-runner baseline, and each was checked ` +
            'against information_schema before it was recorded; the rest are the pre-runner ' +
            'set that --baseline records too.')
    );
    return { applied: [], baselined, pending: [] };
  }

  if (baseline) {
    await ensureBookkeeping(query);
    const alreadyRecorded = await readApplied(query);
    const rows = [];

    // Only the closed LEGACY_BASELINE list is adopted, never "whatever .sql
    // files happen to be in the directory". See the constant for why.
    for (const filename of files.filter(f => LEGACY_BASELINE.includes(f))) {
      // A file already recorded keeps the checksum it was recorded with:
      // overwriting it here would launder exactly the drift the guard exists
      // to catch.
      if (alreadyRecorded.has(filename)) continue;

      const contents = readFileSync(path.join(dir, filename), 'utf8');
      rows.push([filename, sha256(contents)]);
    }

    // One transaction, so an interrupted baseline leaves nothing behind rather
    // than a partial set that makes every later run refuse.
    await recordAdoptions(query, rows);
    const baselined = rows.map(([filename]) => filename);

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
        'Record a starting point once, from cloudcodex/. Which command depends on where this\n' +
        'schema came from, and they are NOT interchangeable:\n\n' +
        '  UPGRADING a database that already existed before this release. This is the usual\n' +
        '  case, and it includes every install that predates the runner:\n' +
        '      npm run migrate -- --baseline\n' +
        '    Records only the migrations that shipped before the runner existed. Anything\n' +
        '    added since stays pending and is applied, for real, by the next ordinary run.\n\n' +
        '  A database init.sql BUILT MINUTES AGO and that has never been upgraded:\n' +
        '      npm run migrate -- --adopt-fresh-install\n' +
        '    Records EVERY file in migrations/ without running any of them, which is correct\n' +
        '    only because init.sql already contains all of them.\n\n' +
        'If you are not sure, it is not a fresh install. --baseline never marks a migration\n' +
        'applied that this database might not have; --adopt-fresh-install does exactly that,\n' +
        'which is why it checks the schema for each newer migration and refuses when the\n' +
        'change it would adopt is missing.'
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
      let message =
        `Migration ${filename} failed. MySQL implicitly commits DDL, so any CREATE, ALTER or\n` +
        'DROP inside this file that ran before the failure is already committed and was NOT\n' +
        'rolled back: the database may be partially migrated. Inspect the schema, or restore\n' +
        'the dump you took before upgrading, before running this again.';

      // The one failure that usually means the opposite of partial migration:
      // the change is already there in full. A database init.sql built has
      // every migration folded in already, so recording its starting point with
      // --baseline instead of --adopt-fresh-install leaves the newer files
      // "pending" and the next run dies on their first ALTER, on an install
      // minutes old with no dump to restore.
      if (SCHEMA_ALREADY_HAS_CODES.has(err.code)) {
        message +=
          `\n\nMySQL reported ${err.code}, so the object this file adds is already there and\n` +
          'this run may have changed nothing at all. That usually means the starting point was\n' +
          'recorded with the wrong command: a database built by init.sql already contains every\n' +
          'migration and needs `npm run migrate -- --adopt-fresh-install`, not `--baseline`,\n' +
          'which records only the pre-runner files and leaves anything newer pending.\n' +
          'Confirm the schema really has this change, then record the file as applied by hand:\n\n' +
          '    INSERT INTO schema_migrations (filename, checksum, applied_ms)\n' +
          `    VALUES ('${filename}', '${sha256(contents)}', 0);`;
      }

      throw new Error(message, { cause: err });
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
