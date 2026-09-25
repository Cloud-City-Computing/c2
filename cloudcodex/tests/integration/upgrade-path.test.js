/**
 * The upgrade path: every post-baseline migration file's SQL runs for real
 *
 * The per-file setup adopts every migration without running any, which proves
 * init.sql and the adoption claims agree but never executes a migration file.
 * This file is the part that does. It starts from the pre-runner state (an
 * init.sql build with every post-baseline change removed), records the
 * pre-runner baseline the way an upgrading operator does, applies every newer
 * file through the runner, and requires the result to match a fresh init.sql
 * build column for column, index for index and constraint for constraint.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { runMigrations, listMigrationFiles, LEGACY_BASELINE, MIGRATIONS_DIR } from '../../scripts/migrate.js';
import { UNDO_ON_INIT_SQL } from './pre-runner-state.js';
import {
  buildSchemaFromInitSql,
  dropSchema,
  openAdminConnection,
  queryVia,
  throwawaySchemaName,
} from './mysql-admin.js';

const postBaseline = listMigrationFiles(MIGRATIONS_DIR).filter(f => !LEGACY_BASELINE.includes(f));

/**
 * Everything about a schema's shape that a migration can change, as sorted
 * rows. The schema name is a parameter, never part of a row, so two schemas
 * built the same way give equal fingerprints.
 * @param { (sql: String, params?: Array) => Promise<Array> } query
 * @param { String } schema
 */
async function fingerprint(query, schema) {
  const columns = await query(
    `SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE, IS_NULLABLE,
            COLUMN_DEFAULT, EXTRA, COLUMN_KEY
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [schema]
  );
  const indexes = await query(
    `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
    [schema]
  );
  const constraints = await query(
    `SELECT TABLE_NAME, CONSTRAINT_NAME, CONSTRAINT_TYPE
       FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = ?
      ORDER BY TABLE_NAME, CONSTRAINT_NAME`,
    [schema]
  );
  const checks = await query(
    `SELECT CONSTRAINT_NAME, CHECK_CLAUSE
       FROM information_schema.CHECK_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = ?
      ORDER BY CONSTRAINT_NAME`,
    [schema]
  );
  const foreignKeys = await query(
    `SELECT TABLE_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME, UPDATE_RULE, DELETE_RULE
       FROM information_schema.REFERENTIAL_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = ?
      ORDER BY TABLE_NAME, CONSTRAINT_NAME`,
    [schema]
  );
  return { columns, indexes, constraints, checks, foreignKeys };
}

describe('upgrading from the pre-runner state', () => {
  it('names an undo for every post-baseline migration file, and for nothing else', () => {
    // A new migration with no entry would leave the upgrade test below
    // replaying it onto a schema that already has it. Say what to do instead.
    const missing = postBaseline.filter(f => !(f in UNDO_ON_INIT_SQL));
    const stale = Object.keys(UNDO_ON_INIT_SQL).filter(f => !postBaseline.includes(f));
    expect(
      { missing, stale },
      'add the statement that undoes each missing file on an init.sql build to tests/integration/pre-runner-state.js'
    ).toEqual({ missing: [], stale: [] });
  });

  it('applies every post-baseline file for real and lands on the schema init.sql builds', async () => {
    const other = throwawaySchemaName();
    const conn = await openAdminConnection();
    try {
      await buildSchemaFromInitSql(conn, other);
      const query = queryVia(conn);

      for (const filename of [...postBaseline].reverse()) {
        await query(UNDO_ON_INIT_SQL[filename]);
      }

      const baselined = await runMigrations({ query, dir: MIGRATIONS_DIR, baseline: true, log: () => {} });
      expect(baselined.pending).toEqual(postBaseline);

      const upgraded = await runMigrations({ query, dir: MIGRATIONS_DIR, log: () => {} });
      expect(upgraded.applied).toEqual(postBaseline);

      // The per-file setup built this file's own schema from init.sql and
      // adopted it, so it is the fresh-install reference.
      expect(await fingerprint(query, other)).toEqual(await fingerprint(query, process.env.DB_NAME));
    } finally {
      await dropSchema(conn, other);
      await conn.end();
    }
  });
});
