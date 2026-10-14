/**
 * The sibling connection's schema removal, against a live MySQL server
 *
 * 2026-10-17-remove-sibling-connection.sql expires revoked invitations, deletes the env-declared webhook
 * subscriptions and drops user_invitations.grants_admin and revoked_at. This file proves four things on a
 * real server: the migration applies to the pre-migration schema and does exactly that; its undo returns
 * the columns; --adopt-fresh-install accepts a fresh build of this release (the two columns it drops are
 * absent, and the files that added them are still adopted); and it refuses a schema that still has them.
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
import { UNDO_ON_INIT_SQL } from './pre-runner-state.js';
import {
  buildSchemaFromInitSql,
  dropSchema,
  openAdminConnection,
  queryVia,
  throwawaySchemaName,
} from './mysql-admin.js';

const silent = () => {};
const FILE = '2026-10-17-remove-sibling-connection.sql';
const ADDS = ['2026-10-15-invitation-grants-admin.sql', '2026-10-16-invitation-revoked.sql'];
const SECRET = 'a'.repeat(40);

/** The user_invitations columns this migration removes, as information_schema sees them. */
async function removedColumns(query, schema) {
  const rows = await query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'user_invitations'
        AND COLUMN_NAME IN ('grants_admin', 'revoked_at')`,
    [schema]
  );
  return rows.map(r => r.COLUMN_NAME).sort();
}

/**
 * Bring an init.sql build to the state before this migration: put back the two columns with the file's
 * own undo, and record every other file as applied, so only this one is pending.
 */
async function toPreMigrationState(query) {
  await query(UNDO_ON_INIT_SQL[FILE]);
  await ensureBookkeeping(query);
  const others = listMigrationFiles(MIGRATIONS_DIR).filter(f => f !== FILE);
  await recordAdoptions(
    query,
    others.map(f => [f, sha256(readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))])
  );
}

describe('removing the sibling connection, on a real server', () => {
  it('ships the migration file this test applies', () => {
    expect(readdirSync(MIGRATIONS_DIR)).toContain(FILE);
  });

  it('applies to the pre-migration schema: expires revoked invitations, deletes env subscriptions, drops the columns', async () => {
    const schema = throwawaySchemaName();
    const conn = await openAdminConnection();
    try {
      await buildSchemaFromInitSql(conn, schema);
      const query = queryVia(conn);
      await toPreMigrationState(query);
      expect(await removedColumns(query, schema)).toEqual(['grants_admin', 'revoked_at']);

      await query("INSERT INTO users (name, email) VALUES ('seed_inv', 'seed_inv@example.test')");
      const [{ id: userId }] = await query("SELECT id FROM users WHERE name = 'seed_inv'");
      const future = 'DATE_ADD(NOW(), INTERVAL 1 YEAR)';
      await query(
        `INSERT INTO user_invitations (email, token, invited_by, expires_at, accepted, revoked_at)
         VALUES ('revoked@example.test', ?, ?, ${future}, FALSE, NOW())`,
        ['r'.repeat(64), userId]
      );
      await query(
        `INSERT INTO user_invitations (email, token, invited_by, expires_at, accepted, grants_admin)
         VALUES ('owner@example.test', ?, ?, ${future}, FALSE, TRUE)`,
        ['o'.repeat(64), userId]
      );
      await query(
        `INSERT INTO webhook_subscriptions (url, secret, source) VALUES ('https://env.example.test/hook', NULL, 'env')`
      );
      await query(
        `INSERT INTO webhook_subscriptions (url, secret, source) VALUES ('https://admin.example.test/hook', ?, 'admin')`,
        [SECRET]
      );
      const [{ id: envSub }] = await query(
        "SELECT id FROM webhook_subscriptions WHERE source = 'env'"
      );
      const [{ id: adminSub }] = await query(
        "SELECT id FROM webhook_subscriptions WHERE source = 'admin'"
      );
      await query(
        `INSERT INTO webhook_events (event_uuid, type, workspace_id, occurred_at, body)
         VALUES ('11111111-1111-4111-8111-111111111111', 'document.published', 1, NOW(3), '{}')`
      );
      const [{ id: eventId }] = await query('SELECT id FROM webhook_events');
      await query(
        'INSERT INTO webhook_deliveries (subscription_id, event_id) VALUES (?, ?), (?, ?)',
        [envSub, eventId, adminSub, eventId]
      );

      const applied = await runMigrations({ query, dir: MIGRATIONS_DIR, log: silent });
      expect(applied.applied).toEqual([FILE]);

      expect(await removedColumns(query, schema)).toEqual([]);

      const [revoked] = await query(
        "SELECT (expires_at <= NOW()) AS expired FROM user_invitations WHERE email = 'revoked@example.test'"
      );
      expect(Boolean(revoked.expired)).toBe(true);

      const subs = await query('SELECT source, url FROM webhook_subscriptions ORDER BY source');
      expect(subs).toEqual([{ source: 'admin', url: 'https://admin.example.test/hook' }]);

      const deliveries = await query('SELECT subscription_id FROM webhook_deliveries');
      expect(deliveries).toEqual([{ subscription_id: adminSub }]);

      // The undo returns the two columns, and the rows that survive keep their data.
      await query(UNDO_ON_INIT_SQL[FILE]);
      expect(await removedColumns(query, schema)).toEqual(['grants_admin', 'revoked_at']);
    } finally {
      await dropSchema(conn, schema);
      await conn.end();
    }
  });

  it('is adopted with the two files that added its columns on a fresh build of this release', async () => {
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
      expect(adopted.baselined).toEqual(expect.arrayContaining([FILE, ...ADDS]));
    } finally {
      await dropSchema(conn, schema);
      await conn.end();
    }
  });

  it('refuses --adopt-fresh-install on a schema that still has the columns, naming the file that removes them', async () => {
    const schema = throwawaySchemaName();
    const conn = await openAdminConnection();
    try {
      await buildSchemaFromInitSql(conn, schema);
      await toPreMigrationState(queryVia(conn));
      // toPreMigrationState recorded every other file as applied, so the adoption check is
      // bypassed by an empty bookkeeping table: clear it to exercise the schema check.
      await queryVia(conn)('DELETE FROM schema_migrations');

      await expect(
        runMigrations({ query: queryVia(conn), dir: MIGRATIONS_DIR, adoptFreshInstall: true, log: silent })
      ).rejects.toThrow(/user_invitations\.grants_admin[\s\S]*2026-10-17-remove-sibling-connection\.sql/);
    } finally {
      await dropSchema(conn, schema);
      await conn.end();
    }
  });
});
