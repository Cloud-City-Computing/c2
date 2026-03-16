/**
 * MySQL Database Connection Module
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const pool = mysql.createPool({
  host:             process.env.DB_HOST ?? 'localhost',
  user:             process.env.DB_USER ?? 'admin',
  password:         process.env.DB_PASS ?? 'admin',
  database:         process.env.DB_NAME ?? 'c2',
  waitForConnections: true,
  connectionLimit:  10,
  queueLimit:       0,
});

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
 * @returns { Promise<String> }
 */
export async function generateSessionToken(user) {
  const [session] = await c2_query(
    `SELECT id, expires_at FROM sessions WHERE user_id = ? LIMIT 1`,
    [user.id]
  );

  if (session) {
    if (session.expires_at > new Date()) return session.id; // still valid

    // Expired — refresh in place
    const newToken = createNewSessionToken();
    await c2_query(
      `UPDATE sessions SET id = ?, created_at = NOW(), expires_at = DATE_ADD(NOW(), INTERVAL 7 DAY)
       WHERE id = ? AND user_id = ?`,
      [newToken, session.id, user.id]
    );
    return newToken;
  }

  // No session — create one
  const token = createNewSessionToken();
  await c2_query(
    `INSERT INTO sessions (user_id, id, created_at, expires_at)
     VALUES (?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 7 DAY))`,
    [user.id, token]
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
    `SELECT id, name, email FROM users WHERE id = ? LIMIT 1`,
    [session.user_id]
  );

  return user ?? null;
}