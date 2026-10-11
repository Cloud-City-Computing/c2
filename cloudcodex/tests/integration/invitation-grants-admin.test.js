/**
 * user_invitations.grants_admin, against a live MySQL server
 *
 * The membership sync (W6-CDX-9) admits a workspace owner as a Codex admin before the owner has ever
 * signed in, so the invitation carries the grant. The column must exist with DEFAULT FALSE on a
 * fresh init.sql build, the runner must apply the migration file for real on a pre-runner schema
 * (and be a no-op the second time), and --adopt-fresh-install must still accept an init.sql build,
 * which already has the column.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  ensureBookkeeping,
  listMigrationFiles,
  MIGRATIONS_DIR,
  recordAdoptions,
  runMigrations,
  sha256,
} from '../../scripts/migrate.js';
import {
  buildSchemaFromInitSql,
  dropSchema,
  openAdminConnection,
  queryVia,
  throwawaySchemaName,
} from './mysql-admin.js';

const silent = () => {};
const FILE = '2026-10-15-invitation-grants-admin.sql';

/** The column's definition as information_schema reports it, for one schema. */
async function grantsAdminColumn(query, schema) {
  const [row] = await query(
    `SELECT COLUMN_DEFAULT, IS_NULLABLE, DATA_TYPE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'user_invitations' AND COLUMN_NAME = 'grants_admin'`,
    [schema]
  );
  return row ?? null;
}

describe('user_invitations.grants_admin, on a real server', () => {
  it('is in the init.sql build, NOT NULL with DEFAULT FALSE, and the migration file is on disk', async () => {
    const schema = throwawaySchemaName();
    const conn = await openAdminConnection();
    try {
      await buildSchemaFromInitSql(conn, schema);
      const row = await grantsAdminColumn(queryVia(conn), schema);
      expect(row).not.toBeNull();
      expect(row.IS_NULLABLE).toBe('NO');
      // MySQL reports a boolean default as the text '0'.
      expect(String(row.COLUMN_DEFAULT)).toBe('0');
    } finally {
      await dropSchema(conn, schema);
      await conn.end();
    }
    expect(readdirSync(MIGRATIONS_DIR)).toContain(FILE);
  });

  it('is adopted by --adopt-fresh-install on an init.sql build, and applies nothing', async () => {
    const schema = throwawaySchemaName();
    const conn = await openAdminConnection();
    try {
      await buildSchemaFromInitSql(conn, schema);
      const adopted = await runMigrations({
        query: queryVia(conn),
        dir: MIGRATIONS_DIR,
        adoptFreshInstall: true,
        log: silent,
      });
      expect(adopted.pending).toEqual([]);
      expect(adopted.baselined).toContain(FILE);
    } finally {
      await dropSchema(conn, schema);
      await conn.end();
    }
  });

  it('is applied by the runner on a pre-runner schema, default FALSE, and a second run is a no-op', async () => {
    const schema = throwawaySchemaName();
    const conn = await openAdminConnection();
    try {
      await buildSchemaFromInitSql(conn, schema);
      const query = queryVia(conn);
      // The pre-runner state for this one change: init.sql without the column. Every OTHER file is
      // recorded as already applied (its checksum, as the runner computes it), so only this file runs.
      await query('ALTER TABLE user_invitations DROP COLUMN grants_admin');
      expect(await grantsAdminColumn(query, schema)).toBeNull();
      await ensureBookkeeping(query);
      const others = listMigrationFiles(MIGRATIONS_DIR).filter(f => f !== FILE);
      await recordAdoptions(query, others.map(f => [f, sha256(readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))]));

      const applied = await runMigrations({ query, dir: MIGRATIONS_DIR, log: silent });
      expect(applied.applied).toEqual([FILE]);
      const row = await grantsAdminColumn(query, schema);
      expect(row).not.toBeNull();
      expect(String(row.COLUMN_DEFAULT)).toBe('0');

      const again = await runMigrations({ query, dir: MIGRATIONS_DIR, log: silent });
      expect(again.applied).toEqual([]);
    } finally {
      await dropSchema(conn, schema);
      await conn.end();
    }
  });
});
