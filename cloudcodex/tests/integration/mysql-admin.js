/**
 * Admin-connection helpers for the live-MySQL integration project
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Every throwaway schema this project creates starts with this. */
export const SCHEMA_PREFIX = 'c2_it_';

/** `SHOW DATABASES LIKE` pattern for SCHEMA_PREFIX, underscores escaped. */
export const SCHEMA_LIKE = 'c2\\_it\\_%';

/**
 * The admin credentials, from IT_DB_*. mysql_connect.js reads no DB_PORT, so
 * the server must answer on 3306 at IT_DB_HOST.
 * @returns { { host: String, user: String, password: String } }
 */
export function adminConfig() {
  const config = {
    host: process.env.IT_DB_HOST ?? '127.0.0.1',
    user: process.env.IT_DB_ROOT_USER ?? 'root',
    password: process.env.IT_DB_ROOT_PASSWORD,
  };
  if (!config.password) {
    throw new Error('IT_DB_ROOT_PASSWORD is required for npm run test:integration (see tests/README.md)');
  }
  return config;
}

/** A fresh `c2_it_<12 hex>` schema name. */
export function throwawaySchemaName() {
  return `${SCHEMA_PREFIX}${randomBytes(6).toString('hex')}`;
}

/**
 * An admin connection that can carry init.sql (multiple statements).
 * @returns { Promise<import('mysql2/promise').Connection> }
 */
export function openAdminConnection() {
  return mysql.createConnection({ ...adminConfig(), multipleStatements: true });
}

/**
 * The executor shape scripts/migrate.js takes, over one connection. One
 * connection, not a pool: the runner's advisory lock is per connection.
 * @param { import('mysql2/promise').Connection } conn
 * @returns { (sql: String, params?: Array) => Promise<Array> }
 */
export function queryVia(conn) {
  return async (sql, params) => {
    const [rows] = await conn.query(sql, params);
    return Array.isArray(rows) ? rows : [];
  };
}

/**
 * Create `schema`, make it `conn`'s current database, and build init.sql into
 * it. init.sql has no USE statement, so it builds into whichever schema is
 * current.
 * @param { import('mysql2/promise').Connection } conn
 * @param { String } schema
 */
export async function buildSchemaFromInitSql(conn, schema) {
  await conn.query(`CREATE DATABASE ${mysql.escapeId(schema)}`);
  await conn.changeUser({ database: schema });
  await conn.query(readFileSync(path.join(REPO_ROOT, 'init.sql'), 'utf8'));
}

/**
 * Drop `schema` if it exists.
 * @param { import('mysql2/promise').Connection } conn
 * @param { String } schema
 */
export async function dropSchema(conn, schema) {
  await conn.query(`DROP DATABASE IF EXISTS ${mysql.escapeId(schema)}`);
}
