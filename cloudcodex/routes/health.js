/**
 * Liveness and readiness probes for Cloud Codex: GET /healthz and GET /readyz
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

/*
 * Mounted in app.js ahead of the /api stack, so no CORS rule, rate limiter or
 * session check stands in front of a probe. Anyone who can reach the port can
 * call both, so neither body carries a version, a count, a filename or a
 * table name: /healthz says `{ ok: true }` and nothing else, and /readyz says
 * `{ ready: true }` or `{ ready: false, reason }` with the reason one of four
 * fixed words.
 *
 *   /healthz  the process is up and serving HTTP. Touches nothing, so a
 *             supervisor never restarts the app over a database outage.
 *   /readyz   this process should receive traffic. Checked in order:
 *               shutting_down  a stop signal arrived (services/shutdown.js)
 *               lock           the instance lock is not held (and not disabled)
 *               database       SELECT 1 failed or took longer than two seconds
 *               migrations     a file in migrations/ has no schema_migrations row,
 *                              the table is missing (nobody adopted this
 *                              database), or the directory cannot be read
 */

import express from 'express';
import { c2_query } from '../mysql_connect.js';
import { listMigrationFiles, readApplied, MIGRATIONS_DIR } from '../scripts/migrate.js';
import { asyncHandler, errorHandler } from './helpers/shared.js';

const router = express.Router();

const DATABASE_TIMEOUT_MS = 2000;
const DATABASE_REUSE_MS = 1_000;
const PROBE_ABANDON_MS = 10_000;
const MIGRATIONS_CACHE_MS = 10_000;

/**
 * What /readyz reads, written by the rest of the process: server.js sets
 * `lock` once the instance lock is taken, and the shutdown sets
 * `shuttingDown`. The rest is the probe's own state: `database` and
 * `migrations` hold the last answers, reused for one and ten seconds; `probe`
 * is the SELECT 1 still out, if any; `reported` holds the log lines already
 * said once.
 */
export const readiness = {
  shuttingDown: false,
  lock: null,
  database: null,     // { checkedAt: number, ok: boolean }
  migrations: null,   // { checkedAt: number, pending: boolean }
  probe: null,        // { startedAt: number, answer: Promise<boolean> }
  reported: new Set(),
};

// Probes are unauthenticated and sit ahead of every limiter, so a burst of
// them must not become a burst of queries on the shared pool: concurrent
// callers share one check. A SELECT 1 that outlives the two-second bound
// still holds a pooled connection until MySQL answers, so the next probe
// waits on that same query rather than queueing another behind it, for up
// to ten seconds; after that a query that may never answer is left behind.
let databaseCheck = null;
let migrationsCheck = null;

/** Say `line` in the log once per process, keyed by `key`. */
function reportOnce(key, line) {
  if (readiness.reported.has(key)) return;
  readiness.reported.add(key);
  console.error(`[${new Date().toISOString()}] /readyz: ${line}`);
}

/** Whether `SELECT 1` answers within the bound. Never throws. */
async function selectOneAnswers() {
  const out = readiness.probe;
  let answer = out && Date.now() - out.startedAt < PROBE_ABANDON_MS ? out.answer : null;
  if (!answer) {
    const probe = { startedAt: Date.now(), answer: null };
    probe.answer = c2_query('SELECT 1', []).then(() => true, () => false)
      .finally(() => { if (readiness.probe === probe) readiness.probe = null; });
    readiness.probe = probe;
    answer = probe.answer;
  }
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), DATABASE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([answer, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Whether the database answers, reusing an answer under a second old. Never throws. */
function databaseAnswers() {
  const cached = readiness.database;
  if (cached && Date.now() - cached.checkedAt < DATABASE_REUSE_MS) return Promise.resolve(cached.ok);
  databaseCheck ??= selectOneAnswers()
    .then((ok) => { readiness.database = { checkedAt: Date.now(), ok }; return ok; })
    .finally(() => { databaseCheck = null; });
  return databaseCheck;
}

/** Read the migrations answer fresh. Unknown counts as pending. Never throws. */
async function readMigrationsPending() {
  let files;
  try {
    files = listMigrationFiles(MIGRATIONS_DIR);
  } catch (err) {
    reportOnce('unreadable-dir',
      'cannot read the migrations directory, so readiness reports migrations until it can ' +
      `(the compose files mount ./migrations at /migrations): ${err.message}`);
    return true;
  }
  try {
    const applied = await readApplied((sql, params) => c2_query(sql, params ?? []));
    return files.some((file) => !applied.has(file));
  } catch (err) {
    if (err?.code === 'ER_NO_SUCH_TABLE') {
      reportOnce('unadopted',
        'this database has no schema_migrations table, so readiness reports migrations. On a new ' +
        'install, run `npm run migrate -- --adopt-fresh-install` once (docs/deployment.md, Upgrades).');
    }
    return true;
  }
}

/** Whether any migration file lacks a schema_migrations row, cached ten seconds. */
function migrationsPending() {
  const cached = readiness.migrations;
  if (cached && Date.now() - cached.checkedAt < MIGRATIONS_CACHE_MS) return Promise.resolve(cached.pending);
  migrationsCheck ??= readMigrationsPending()
    .then((pending) => { readiness.migrations = { checkedAt: Date.now(), pending }; return pending; })
    .finally(() => { migrationsCheck = null; });
  return migrationsCheck;
}

/**
 * Why this process should not receive traffic yet, or null when it should.
 * @returns {Promise<null | 'shutting_down' | 'lock' | 'database' | 'migrations'>}
 */
export async function notReadyReason() {
  if (readiness.shuttingDown) return 'shutting_down';
  const lock = readiness.lock;
  if (!lock || !(lock.held || lock.disabled)) return 'lock';
  if (!(await databaseAnswers())) return 'database';
  if (await migrationsPending()) return 'migrations';
  return null;
}

// A probe answer is about this instant; a cache in between must not replay it.
// Set per route, not with router.use: this router is mounted at the root.
router.get('/healthz', (_req, res) => {
  res.set('Cache-Control', 'no-store').json({ ok: true });
});

router.get('/readyz', asyncHandler(async (_req, res) => {
  const reason = await notReadyReason();       // null, or one of the four words above
  res.set('Cache-Control', 'no-store')
    .status(reason ? 503 : 200)
    .json(reason ? { ready: false, reason } : { ready: true });
}));

router.use(errorHandler);

export default router;
