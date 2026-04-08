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

const dirname = path.dirname(fileURLToPath(import.meta.url));
// Load .env from the project root (one level up from cloudcodex/)
dotenv.config({ path: path.resolve(dirname, '..', '.env') });

const pool = mysql.createPool({
  host:             process.env.DB_HOST ?? 'localhost',
  user:             process.env.DB_USER,
  password:         process.env.DB_PASS,
  database:         process.env.DB_NAME ?? 'c2',
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
 * Returns a valid session token for the given user, reusing an existing
 * non-expired session or creating/refreshing one as needed.
 * @param { Object } user - Must contain an `id` property
 * @param { string } [ip] - Client IP address
 * @param { string } [userAgent] - Client User-Agent header
 * @returns { Promise<String> }
 */
export async function generateSessionToken(user, ip = null, userAgent = null) {
  const [session] = await c2_query(
    `SELECT id, expires_at FROM sessions WHERE user_id = ? LIMIT 1`,
    [user.id]
  );

  if (session) {
    if (session.expires_at > new Date()) {
      // Update metadata on reuse
      await c2_query(
        `UPDATE sessions SET ip_address = ?, user_agent = ?, last_active_at = NOW() WHERE id = ?`,
        [ip, userAgent, session.id]
      );
      return session.id;
    }

    // Expired — refresh in place
    const newToken = createNewSessionToken();
    await c2_query(
      `UPDATE sessions SET id = ?, created_at = NOW(), expires_at = DATE_ADD(NOW(), INTERVAL 7 DAY),
       ip_address = ?, user_agent = ?, last_active_at = NOW()
       WHERE id = ? AND user_id = ?`,
      [newToken, ip, userAgent, session.id, user.id]
    );
    return newToken;
  }

  // No session — create one
  const token = createNewSessionToken();
  await c2_query(
    `INSERT INTO sessions (user_id, id, created_at, expires_at, ip_address, user_agent)
     VALUES (?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 7 DAY), ?, ?)`,
    [user.id, token, ip, userAgent]
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
  const [session] = await c2_query(
    `SELECT user_id, expires_at FROM sessions WHERE id = ? LIMIT 1`,
    [sessionToken]
  );

  if (!session || session.expires_at <= new Date()) return null;

  const [user] = await c2_query(
    `SELECT id, name, email, avatar_url, is_admin FROM users WHERE id = ? LIMIT 1`,
    [session.user_id]
  );

  return user ?? null;
}

/**
 * Updates last_active_at for a session token to track user activity.
 * @param { String } sessionToken
 */
export async function touchSession(sessionToken) {
  if (!sessionToken) return;
  await c2_query(
    `UPDATE sessions SET last_active_at = NOW() WHERE id = ?`,
    [sessionToken]
  );
}
