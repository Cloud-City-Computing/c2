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
 * gone with it: `held` goes false, /readyz answers 503 `lock`, and every
 * keepalive tick tries to take it back on a new connection. If another
 * process took it in the meantime, this one stays not-ready and says who.
 */

const NAME_SQL = `CONCAT('cloudcodex-instance:', DATABASE())`;   // distinct from the runner's lock
const PING_MS = 60_000;

const refusal = (holder) => new Error(
  `Another Cloud Codex process (MySQL connection ${holder}) already serves this database.\n` +
  'Two processes would hold two different copies of every open document. Stop the other one,\n' +
  'or set C2_INSTANCE_LOCK=0 if you know exactly why you need both.'
);

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
 * @param {number} [deps.pingMs] - keepalive and retake interval
 * @returns {Promise<{ held: boolean, disabled: boolean, connectionId: ?number, release: () => Promise<void> }>}
 */
export async function acquireInstanceLock({ connect, log, pingMs = PING_MS }) {
  if (process.env.C2_INSTANCE_LOCK === '0') {
    log('instance lock disabled by C2_INSTANCE_LOCK=0; a second process on this schema will diverge');
    return { held: false, disabled: true, connectionId: null, release: async () => {} };
  }

  let conn = null;
  let released = false;
  let busy = false;
  let lastRefusal = null;
  const lock = { held: false, disabled: false, connectionId: null, release: null };

  const markLost = () => {
    if (!lock.held) return;
    lock.held = false;
    log('instance lock lost with its MySQL connection; /readyz reports not ready until it is taken back');
  };
  // Only the connection currently holding the lock can lose it.
  const onError = (errored) => { if (errored === conn) markLost(); };

  const adopt = (next) => {
    conn = next.conn;
    lock.held = true;
    lock.connectionId = next.connectionId;
  };
  adopt(await takeLock(connect, onError));

  const tick = async () => {
    if (busy || released) return;
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
          await next.conn.end().catch(() => next.conn.destroy());
          return;
        }
        adopt(next);
        lastRefusal = null;
        log(`instance lock taken back on MySQL connection ${lock.connectionId}`);
      } catch (err) {
        // Say it once per distinct reason, not once a minute.
        if (err.message !== lastRefusal) {
          lastRefusal = err.message;
          log(err.message);
        }
      }
    } finally {
      busy = false;
    }
  };

  const ping = setInterval(() => { tick(); }, pingMs);
  ping.unref?.();

  lock.release = async () => {
    released = true;
    clearInterval(ping);
    lock.held = false;
    await conn.end().catch(() => conn.destroy());
  };
  return lock;
}
