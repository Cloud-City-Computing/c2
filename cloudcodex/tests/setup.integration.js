/**
 * Per-file setup for the live-MySQL integration project
 *
 * Runs once per test file, before the file is imported, which is what lets it
 * point DB_NAME at a throwaway schema before mysql_connect.js binds its pool.
 * It deliberately does NOT mock mysql_connect.js: the point of this project is
 * that c2_query reaches a real server.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { afterAll } from 'vitest';
import { runMigrations, MIGRATIONS_DIR } from '../scripts/migrate.js';
import {
  adminConfig,
  buildSchemaFromInitSql,
  dropSchema,
  openAdminConnection,
  queryVia,
  throwawaySchemaName,
} from './integration/mysql-admin.js';

const admin = adminConfig();

export const schema = throwawaySchemaName();

const conn = await openAdminConnection();
try {
  await buildSchemaFromInitSql(conn, schema);
  await runMigrations({ query: queryVia(conn), dir: MIGRATIONS_DIR, adoptFreshInstall: true, log: () => {} });
} catch (err) {
  // A throw here fails the file before its afterAll is registered, so clean
  // up now; the global teardown is for leaks nobody saw coming.
  await dropSchema(conn, schema);
  await conn.end();
  throw err;
}

// Bound before any test file imports an app module. dotenv (which
// mysql_connect.js calls) never overrides a variable already set, so a
// developer's .env cannot redirect these.
process.env.DB_HOST = admin.host;
process.env.DB_USER = admin.user;
process.env.DB_PASS = admin.password;
process.env.DB_NAME = schema;

afterAll(async () => {
  await dropSchema(conn, schema);
  await conn.end();
});
