/**
 * Global teardown for the live-MySQL integration project: no schema or account is left behind
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import {
  dropSchema,
  dropUser,
  isThrowawaySchema,
  openAdminConnection,
  RECIPE_SCHEMA_LIKE,
  SCHEMA_LIKE,
  USER_LIKE,
} from './mysql-admin.js';

/**
 * Every test file drops its own schemas and accounts in afterAll. A file that
 * crashed before that hook ran would leak one onto the developer's server, so
 * drop whatever remains and then fail the run, naming it, rather than let the
 * leak pass.
 *
 * Every c2_it_ and c2it schema, and every c2_it_ account, on the server counts, so two integration runs sharing
 * one server at the same moment would see, drop and report each other's.
 * Give each concurrent run its own server.
 */
export async function teardown() {
  // Without a password no file could have created anything, and each file's
  // setup has already failed the run saying so.
  if (!process.env.IT_DB_ROOT_PASSWORD) return;

  const conn = await openAdminConnection();
  const leaked = [];
  try {
    for (const like of [SCHEMA_LIKE, RECIPE_SCHEMA_LIKE]) {
      const [rows] = await conn.query(`SHOW DATABASES LIKE '${like}'`);
      for (const row of rows) {
        const schema = Object.values(row)[0];
        if (!isThrowawaySchema(schema)) continue;
        await dropSchema(conn, schema);
        leaked.push(schema);
      }
    }
    // The shared-server tests create MySQL accounts too, and an account
    // outlives any schema.
    const [users] = await conn.query('SELECT DISTINCT User AS user FROM mysql.user WHERE User LIKE ?', [USER_LIKE]);
    for (const { user } of users) {
      await dropUser(conn, user);
      leaked.push(`account ${user}`);
    }
  } finally {
    await conn.end();
  }

  if (leaked.length > 0) {
    // Vitest 4 only logs a teardown error ("error during close") and still
    // exits 0, so the throw alone would leave the run green. The exit code is
    // what fails it; the throw is what names the schemas in the output.
    process.exitCode = 1;
    throw new Error(
      `Integration teardown found ${leaked.length} throwaway schema(s) or account(s) a test file did not drop ` +
        `(dropped now): ${leaked.join(', ')}`
    );
  }
}
