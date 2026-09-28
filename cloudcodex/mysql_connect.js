/**
 * MySQL Database Connection Module
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

import path from 'path';
import { fileURLToPath } from 'url';
import { hashSessionToken } from './services/session-token.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
// Load .env from the archive root (one level up from cloudcodex/)
dotenv.config({ path: path.resolve(dirname, '..', '.env') });

// Shared by the pool and by openConnection, so the instance lock's own
// connection can never point somewhere the pool does not.
const connectionOptions = {
  host:             process.env.DB_HOST ?? 'localhost',
  user:             process.env.DB_USER,
  password:         process.env.DB_PASS,
  database:         process.env.DB_NAME ?? 'c2',
};

const pool = mysql.createPool({
  ...connectionOptions,
  waitForConnections: true,
  connectionLimit:  10,
  queueLimit:       0,
});

if (!process.env.DB_USER || !process.env.DB_PASS) {
  console.error('Missing required environment variables: DB_USER, DB_PASS');
  console.error('Copy .env.example to .env and fill in your database credentials.');
  process.exit(1);
}

/**
 * Opens one connection of its own, outside the pool, to the same server, user
 * and schema. For state that belongs to a connection and must outlive any one
 * query: the instance lock's GET_LOCK (services/instance-lock.js). The caller
 * ends it.
 * @returns { Promise<import('mysql2/promise').Connection> }
 */
export function openConnection() {
  return mysql.createConnection({ ...connectionOptions });
}

/**
 * Ends the shared pool: every connection closes once its query finishes. The
 * last step of a graceful shutdown (services/shutdown.js); nothing may query
 * after it.
 */
export async function endPool() {
  await pool.end();
}

/**
 * Executes a parameterized SQL query.
 * @param { String } sql
 * @param { Array }  params
 * @returns { Promise<Array> }
 */
export async function c2_query(sql, params) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/**
 * Runs `fn` against a single dedicated pooled connection wrapped in a
 * transaction. `c2_query` cannot be used for multi-statement transactions:
 * each call may be handed a different pooled connection, so a BEGIN issued
 * through one call has no guaranteed relationship to a COMMIT issued
 * through another.
 *
 * `fn` receives a query executor, `(sql, params) => Promise<Array>`, with
 * the same shape as `c2_query`, bound to the dedicated connection so every
 * call `fn` makes through it participates in the same transaction. Commits
 * and returns fn's result on success; rolls back and rethrows on any
 * failure. A rollback that itself fails is logged and swallowed so the
 * ORIGINAL error still reaches the caller. The connection is always
 * released back to the pool.
 *
 * @param { (query: (sql: string, params?: Array) => Promise<Array>) => Promise<any> } fn
 * @returns { Promise<any> } whatever `fn` resolves to
 */
export async function withTransaction(fn) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const query = async (sql, params) => {
      const [rows] = await connection.execute(sql, params);
      return rows;
    };
    const result = await fn(query);
    await connection.commit();
    return result;
  } catch (err) {
    try {
      await connection.rollback();
    } catch (rollbackErr) {
      // A failing rollback must never replace the error that caused it: the
      // original names the statement that actually broke, and that is the only
      // thing an operator can act on. Surface the rollback failure in the log
      // and rethrow the original.
      console.error(`[${new Date().toISOString()}] transaction rollback failed:`, rollbackErr);
    }
    throw err;
  } finally {
    connection.release();
  }
}

/**
 * Generates a cryptographically random alphanumeric session token.
 * @param { Number } length
 * @returns { String }
 */
function createNewSessionToken(length = 64) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

/**
 * Whether `value` could be a session token at all: a non-empty string.
 * @param { unknown } value
 * @returns { boolean }
 */
function isTokenShaped(value) {
  return typeof value === 'string' && value !== '';
}

/**
 * Mints a new session for `user`: one row per sign-in, so signing out of one
 * device leaves the others alone. Returns the raw token; only its digest
 * (hashSessionToken) is stored, so a database dump yields nothing a browser
 * can present.
 * @param { Object } user - Must contain an `id` property
 * @param { string } [ip] - Client IP address
 * @param { string } [userAgent] - Client User-Agent header
 * @param { { provider?: 'local'|'google' } } [options] - the flow that minted it
 * @returns { Promise<String> }
 */
export async function generateSessionToken(user, ip = null, userAgent = null, { provider = 'local' } = {}) {
  const token = createNewSessionToken();
  await c2_query(
    `INSERT INTO sessions (user_id, id, auth_provider, created_at, expires_at, ip_address, user_agent)
     VALUES (?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 7 DAY), ?, ?)`,
    [user.id, hashSessionToken(token), provider, ip, userAgent]
  );
  return token;
}

/**
 * Validates a session token and returns the associated user, or null if
 * the token is missing, expired, or has no matching user.
 * @param { String } sessionToken
 * @returns { Promise<Object|null> }
 */
export async function validateAndAutoLogin(sessionToken) {
  // A JSON body can carry anything. Only a non-empty string can be a token,
  // and hashing anything else would throw a 500 over what is just "no session".
  if (!isTokenShaped(sessionToken)) return null;

  const [session] = await c2_query(
    `SELECT user_id, expires_at FROM sessions WHERE id = ? LIMIT 1`,
    [hashSessionToken(sessionToken)]
  );

  if (!session || session.expires_at <= new Date()) return null;

  const [user] = await c2_query(
    `SELECT id, name, email, avatar_url, is_admin FROM users WHERE id = ? LIMIT 1`,
    [session.user_id]
  );

  return user ?? null;
}

/**
 * The flow that minted a session (`sessions.auth_provider`), so a session
 * that is rotated (update-account, confirm-email) can be replaced by one
 * carrying the same tag. Read it before the rotation deletes the row: a
 * session that is gone, or a value that cannot be a token, answers 'local'.
 * @param { String } sessionToken
 * @returns { Promise<String> }
 */
export async function getSessionProvider(sessionToken) {
  if (!isTokenShaped(sessionToken)) return 'local';
  const [session] = await c2_query(
    `SELECT auth_provider FROM sessions WHERE id = ? LIMIT 1`,
    [hashSessionToken(sessionToken)]
  );
  return session?.auth_provider ?? 'local';
}

/**
 * Updates last_active_at for a session token to track user activity.
 * @param { String } sessionToken
 */
export async function touchSession(sessionToken) {
  if (!isTokenShaped(sessionToken)) return;
  await c2_query(
    `UPDATE sessions SET last_active_at = NOW() WHERE id = ?`,
    [hashSessionToken(sessionToken)]
  );
}
