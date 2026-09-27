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
const MIGRATIONS_CACHE_MS = 10_000;

/**
 * What /readyz reads, written by the rest of the process: server.js sets
 * `lock` once the instance lock is taken, and the shutdown sets
 * `shuttingDown`. `migrations` caches the last migrations answer.
 */
export const readiness = {
  shuttingDown: false,
  lock: null,
  migrations: null,   // { checkedAt: number, pending: boolean }
};

let reportedUnreadableDir = false;

/** Whether `SELECT 1` answers within the bound. Never throws. */
async function databaseAnswers() {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), DATABASE_TIMEOUT_MS);
  });
  const query = c2_query('SELECT 1', []).then(() => true, () => false);
  try {
    return await Promise.race([query, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Whether any migration file lacks a schema_migrations row. Unknown counts as pending. */
async function migrationsPending() {
  const cached = readiness.migrations;
  if (cached && Date.now() - cached.checkedAt < MIGRATIONS_CACHE_MS) return cached.pending;

  let pending;
  try {
    let files;
    try {
      files = listMigrationFiles(MIGRATIONS_DIR);
    } catch (err) {
      if (!reportedUnreadableDir) {
        reportedUnreadableDir = true;
        console.error(
          `[${new Date().toISOString()}] /readyz: cannot read the migrations directory, so readiness ` +
          `reports migrations until it can (the compose files mount ./migrations at /migrations): ${err.message}`
        );
      }
      throw err;
    }
    const applied = await readApplied((sql, params) => c2_query(sql, params ?? []));
    pending = files.some((file) => !applied.has(file));
  } catch {
    pending = true;
  }
  readiness.migrations = { checkedAt: Date.now(), pending };
  return pending;
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
