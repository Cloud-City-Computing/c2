/**
 * Global teardown for the live-MySQL integration project: no schema is left behind
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { dropSchema, openAdminConnection, SCHEMA_LIKE } from './mysql-admin.js';

/**
 * Every test file drops its own schema in afterAll. A file that crashed before
 * that hook ran would leak one onto the developer's server, so drop whatever
 * remains and then fail the run, naming it, rather than let the leak pass.
 *
 * Every c2_it_ schema on the server counts, so two integration runs sharing
 * one server at the same moment would see, drop and report each other's.
 * Give each concurrent run its own server.
 */
export async function teardown() {
  // Without a password no file could have created anything, and each file's
  // setup has already failed the run saying so.
  if (!process.env.IT_DB_ROOT_PASSWORD) return;

  const conn = await openAdminConnection();
  let leaked;
  try {
    const [rows] = await conn.query(`SHOW DATABASES LIKE '${SCHEMA_LIKE}'`);
    leaked = rows.map((row) => Object.values(row)[0]);
    for (const schema of leaked) await dropSchema(conn, schema);
  } finally {
    await conn.end();
  }

  if (leaked.length > 0) {
    // Vitest 4 only logs a teardown error ("error during close") and still
    // exits 0, so the throw alone would leave the run green. The exit code is
    // what fails it; the throw is what names the schemas in the output.
    process.exitCode = 1;
    throw new Error(
      `Integration teardown found ${leaked.length} throwaway schema(s) a test file did not drop ` +
        `(dropped now): ${leaked.join(', ')}`
    );
  }
}
