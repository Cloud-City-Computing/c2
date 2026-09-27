/**
 * The single-writer lock: one Cloud Codex process per database schema
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

/*
 * Collaborative state is an in-memory Y.Doc per open document
 * (services/collab.js), so a second process on the same schema would hold a
 * second, divergent copy of every document and each would overwrite the
 * other's ydoc_state. CLAUDE.md decision 1 says so; this makes it true.
 *
 * The lock is a MySQL GET_LOCK held on a connection of its own for the life of
 * the process. GET_LOCK belongs to a connection, so a process that dies for
 * any reason, SIGKILL included, releases it the moment MySQL sees the socket
 * close; nothing stale is left behind to clean up. The name is built server
 * side from DATABASE(), like the migration runner's (scripts/migrate.js), and
 * with a different prefix, so `npm run migrate` in a one-off container never
 * contends with the running app. GET_LOCK names are server-wide and a schema
 * name is unique on a server, so instances sharing one MySQL never contend
 * either.
 *
 * If the connection is lost (MySQL restarted, a network blip), the lock is
 * gone with it: `held` goes false, /readyz answers 503 `lock`, and the lock is
 * tried again on a new connection every second until it is back. If another
 * process took it in the meantime, two live processes now serve one schema,
 * so this one hands over to `onSuperseded` once and tries no more: server.js
 * stops through the graceful shutdown and exits 1, and its supervisor
 * restarts it into an ordinary refusal.
 *
 * MySQL caps a lock name at 64 characters and a schema name at 64 too, so a
 * schema name longer than 44 cannot follow the 20-character prefix. Such a
 * schema is named by the first 40 hex characters of its SHA-256 instead, after
 * a `#` so a digest can never equal a readable name.
 */

// Distinct from the runner's lock (scripts/migrate.js).
export const INSTANCE_LOCK_NAME_SQL =
  "IF(CHAR_LENGTH(DATABASE()) <= 44, CONCAT('cloudcodex-instance:', DATABASE()), " +
  "CONCAT('cloudcodex-instance#', LEFT(SHA2(DATABASE(), 256), 40)))";
const NAME_SQL = INSTANCE_LOCK_NAME_SQL;
const PING_MS = 60_000;
const RETAKE_MS = 1_000;

const refusal = (holder) => Object.assign(new Error(
  `Another Cloud Codex process (MySQL connection ${holder}) already serves this database.\n` +
  'Two processes would hold two different copies of every open document. Stop the other one,\n' +
  'or set C2_INSTANCE_LOCK=0 if you know exactly why you need both.'
), { heldElsewhere: true });

const errored = () => new Error(
  "GET_LOCK for the instance lock returned NULL, so the attempt errored rather than finding\n" +
  'another holder. Check the MySQL error log and the connection, then start again.'
);

/**
 * Open a connection and try the lock once, with a zero wait.
 * @param {() => Promise<Object>} connect
 * @param {(conn: Object) => void} onError - called with the connection that errored
 * @returns {Promise<{ conn: Object, connectionId: number }>} on success; throws otherwise
 */
async function takeLock(connect, onError) {
  let conn;
  try {
    conn = await connect();
  } catch (err) {
    throw new Error(`Could not open a MySQL connection for the instance lock: ${err.message}`, { cause: err });
  }
  // A connection error with no listener is thrown by the EventEmitter and
  // takes the whole process down, collab state included.
  conn.on('error', () => onError(conn));

  let row;
  try {
    [[row]] = await conn.query(`SELECT GET_LOCK(${NAME_SQL}, 0) AS got, IS_USED_LOCK(${NAME_SQL}) AS holder`);
  } catch (err) {
    conn.destroy();
    throw err;
  }
  if (row.got !== 1) {
    await conn.end().catch(() => conn.destroy());
    throw row.got === 0 ? refusal(row.holder) : errored();
  }
  return { conn, connectionId: row.holder };
}

/**
 * Take the instance lock for this process's schema, or refuse.
 *
 * `C2_INSTANCE_LOCK=0` is the one escape and takes no lock at all. Any other
 * value, or none, takes it.
 *
 * @param {Object} deps
 * @param {() => Promise<Object>} deps.connect - opens a mysql2 promise connection, never a pooled one
 * @param {(line: string) => void} deps.log
 * @param {(err: Error) => void} [deps.onSuperseded] - called once if another process took the lock this one lost
 * @param {number} [deps.pingMs] - keepalive interval while the lock is held
 * @param {number} [deps.retakeMs] - retry interval once it is lost
 * @returns {Promise<{ held: boolean, disabled: boolean, connectionId: ?number, release: () => Promise<void> }>}
 */
export async function acquireInstanceLock({ connect, log, onSuperseded = () => {},
                                            pingMs = PING_MS, retakeMs = RETAKE_MS }) {
  if (process.env.C2_INSTANCE_LOCK === '0') {
    log('instance lock disabled by C2_INSTANCE_LOCK=0; a second process on this schema will diverge');
    return { held: false, disabled: true, connectionId: null, release: async () => {} };
  }

  let conn = null;
  let released = false;
  let superseded = false;
  let busy = false;
  let retake = null;
  let lastFailure = null;
  const lock = { held: false, disabled: false, connectionId: null, release: null };

  const scheduleRetake = () => {
    if (retake || released || superseded) return;
    retake = setTimeout(() => { retake = null; tick(); }, retakeMs);
    retake.unref?.();
  };

  const markLost = () => {
    if (!lock.held) return;
    lock.held = false;
    log('instance lock lost with its MySQL connection; /readyz reports not ready until it is taken back');
    scheduleRetake();
  };
  // Only the connection currently holding the lock can lose it; a late error
  // from one already replaced says nothing about the lock.
  const onError = (errored) => { if (errored === conn) markLost(); };

  const adopt = (next) => {
    conn = next.conn;
    lock.held = true;
    lock.connectionId = next.connectionId;
  };
  adopt(await takeLock(connect, onError));

  // One attempt at a time: a connect can take seconds, and a second one
  // started meanwhile would open a connection nobody tracks.
  async function tick() {
    if (busy || released || superseded) return;
    busy = true;
    try {
      if (lock.held) {
        try {
          await conn.query('SELECT 1');
        } catch {
          markLost();
        }
      }
      if (lock.held) return;
      try { conn.destroy(); } catch { /* already gone */ }
      try {
        const next = await takeLock(connect, onError);
        if (released) {
          // Released while the attempt was in flight: nobody would ever end this one.
          await next.conn.end().catch(() => next.conn.destroy());
          return;
        }
        adopt(next);
        clearTimeout(retake);
        retake = null;
        lastFailure = null;
        log(`instance lock taken back on MySQL connection ${lock.connectionId}`);
      } catch (err) {
        if (err.heldElsewhere) {
          superseded = true;
          clearInterval(ping);
          log(err.message);
          onSuperseded(err);
          return;
        }
        // MySQL still down: say it once per distinct reason, not every second.
        if (err.message !== lastFailure) {
          lastFailure = err.message;
          log(err.message);
        }
        scheduleRetake();
      }
    } finally {
      busy = false;
    }
  }

  const ping = setInterval(() => { tick(); }, pingMs);
  ping.unref?.();

  lock.release = async () => {
    released = true;
    clearInterval(ping);
    clearTimeout(retake);
    lock.held = false;
    await conn.end().catch(() => conn.destroy());
  };
  return lock;
}
