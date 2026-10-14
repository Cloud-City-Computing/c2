/**
 * The columns this release reads, checked at boot (W6-CDX-9)
 *
 * `npm run migrate` is a separate step: nothing applies a migration when the app starts, so an app started
 * before its migration would read a column that is not there (the invitation sign-in SELECT, the membership
 * sync). server.js calls missingReleaseColumns() before it listens and exits with a sentence naming the
 * migration when one is missing. An information_schema read that returns nothing is not evidence of anything
 * (a test double, a dropped connection), so it answers null, and the boot goes on as it did before this check.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { c2_query } from '../mysql_connect.js';

/** [table, column, the migration file that adds it], for every column a route on this release reads. */
export const RELEASE_COLUMNS = Object.freeze([
  ['users', 'deactivated_at', '2026-10-12-user-deactivation.sql'],
  ['user_identities', 'email_at_last_signin', '2026-10-12-identity-last-signin-email.sql'],
]);

/**
 * The entries of RELEASE_COLUMNS the connected schema lacks, or null when the schema cannot be read.
 * @param {(sql: string, params?: Array) => Promise<Array>} [query]
 * @returns {Promise<Array<[string, string, string]> | null>}
 */
export async function missingReleaseColumns(query = c2_query) {
  const rows = await query(
    `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`
  );
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const present = new Set(rows.map((row) => `${row.TABLE_NAME}.${row.COLUMN_NAME}`));
  return RELEASE_COLUMNS.filter(([table, column]) => !present.has(`${table}.${column}`));
}
