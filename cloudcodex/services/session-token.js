/**
 * The one definition of how a session token is stored
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { createHash } from 'node:crypto';

/**
 * SHA-256 of the token, lowercase hex. sessions.id holds this, never the token:
 * a database dump then yields nothing a browser can present. 64 characters, so
 * the CHAR(64) column is unchanged.
 *
 * It lives outside mysql_connect.js so the global mock of that module in
 * tests/setup.js does not have to reproduce it. MySQL's SHA2(token, 256)
 * computes the same value, which is how the migration that introduced it
 * hashed the rows already stored.
 * @param {string} token
 * @returns {string}
 */
export function hashSessionToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
