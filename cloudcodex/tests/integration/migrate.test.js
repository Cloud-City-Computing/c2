/**
 * The migration runner against a live MySQL server
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as db from '../../mysql_connect.js';
import { runMigrations, listMigrationFiles, MIGRATIONS_DIR } from '../../scripts/migrate.js';
import {
  buildSchemaFromInitSql,
  dropSchema,
  openAdminConnection,
  queryVia,
  throwawaySchemaName,
} from './mysql-admin.js';

describe('the live-MySQL project', () => {
  it('reaches a real server through c2_query, in this file\'s own schema', async () => {
    expect(vi.isMockFunction(db.c2_query)).toBe(false);
    const rows = await db.c2_query('SELECT DATABASE() AS d', []);
    expect(rows[0].d).toBe(process.env.DB_NAME);
  });
});

describe('scripts/migrate.js on a database init.sql built', () => {
  let conn;
  let query;

  beforeAll(async () => {
    conn = await openAdminConnection();
    await conn.changeUser({ database: process.env.DB_NAME });
    query = queryVia(conn);
  });

  afterAll(async () => {
    await conn.end();
  });

  it('--adopt-fresh-install recorded every migration file', async () => {
    const [{ n }] = await query('SELECT COUNT(*) AS n FROM schema_migrations');
    expect(Number(n)).toBe(listMigrationFiles(MIGRATIONS_DIR).length);
  });

  it('a second run applies nothing and leaves nothing pending', async () => {
    const result = await runMigrations({ query, dir: MIGRATIONS_DIR, log: () => {} });
    expect(result.applied).toEqual([]);
    expect(result.pending).toEqual([]);
  });

  it('adoption refuses a schema missing a post-baseline column', async () => {
    const other = throwawaySchemaName();
    const otherConn = await openAdminConnection();
    try {
      await buildSchemaFromInitSql(otherConn, other);
      await otherConn.query(
        'ALTER TABLE password_reset_tokens DROP CHECK chk_password_reset_tokens_purpose, DROP COLUMN purpose'
      );
      await expect(
        runMigrations({
          query: queryVia(otherConn),
          dir: MIGRATIONS_DIR,
          adoptFreshInstall: true,
          log: () => {},
        })
      ).rejects.toThrow('password_reset_tokens.purpose');
    } finally {
      await dropSchema(otherConn, other);
      await otherConn.end();
    }
  });
});
