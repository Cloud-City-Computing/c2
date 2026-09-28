/**
 * The outbound-webhook tables, proved against a live MySQL server
 *
 * The constraints are the part a mocked test cannot see: the source and
 * status CHECKs, the rule that only an env subscription goes without a stored
 * secret, the two unique keys, and the cascade from a subscription to its
 * deliveries. Every row here is written directly, with no application code.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { c2_query } from '../../mysql_connect.js';
import { schemaClaims, MIGRATIONS_DIR } from '../../scripts/migrate.js';

const MIGRATION = '2026-09-28-webhooks.sql';

/** An admin subscription row, returned as its id. */
async function insertSubscription(url = 'https://receiver.example/hook') {
  const created = await c2_query(
    `INSERT INTO webhook_subscriptions (url, secret, source) VALUES (?, ?, 'admin')`,
    [url, 'a'.repeat(64)]
  );
  return created.insertId;
}

/** An outbox event row, returned as its id. */
async function insertEvent(uuid) {
  const created = await c2_query(
    `INSERT INTO webhook_events (event_uuid, type, workspace_id, occurred_at, body)
     VALUES (?, 'log.rename', 1, '2026-09-28 00:00:00.000', ?)`,
    [uuid, Buffer.from('{}', 'utf8')]
  );
  return created.insertId;
}

/** Runs `write` and returns the MySQL error code it failed with, or null. */
async function errorCode(write) {
  try {
    await write();
    return null;
  } catch (err) {
    return err.code;
  }
}

let subscriptionId;
let eventId;

beforeAll(async () => {
  subscriptionId = await insertSubscription();
  eventId = await insertEvent('00000000-0000-4000-8000-000000000001');
});

describe('the webhook tables, on a real server', () => {
  it('the migration claims the three tables, so --adopt-fresh-install checks each one', () => {
    const contents = readFileSync(path.join(MIGRATIONS_DIR, MIGRATION), 'utf8');
    expect(schemaClaims(contents)).toEqual([
      { kind: 'table', table: 'webhook_subscriptions' },
      { kind: 'table', table: 'webhook_events' },
      { kind: 'table', table: 'webhook_deliveries' },
    ]);
  });

  it('refuses a subscription source other than env or admin', async () => {
    expect(await errorCode(() => c2_query(
      `INSERT INTO webhook_subscriptions (url, secret, source) VALUES ('https://x.example/', 's', 'other')`, []
    ))).toBe('ER_CHECK_CONSTRAINT_VIOLATED');
  });

  it('stores a secret for an admin subscription and never for the env one', async () => {
    // An admin row with no secret could never be signed; an env row with one
    // would put the environment's secret in the database.
    expect(await errorCode(() => c2_query(
      `INSERT INTO webhook_subscriptions (url, secret, source) VALUES ('https://x.example/', NULL, 'admin')`, []
    ))).toBe('ER_CHECK_CONSTRAINT_VIOLATED');
    expect(await errorCode(() => c2_query(
      `INSERT INTO webhook_subscriptions (url, secret, source) VALUES ('https://x.example/', 's', 'env')`, []
    ))).toBe('ER_CHECK_CONSTRAINT_VIOLATED');

    const env = await c2_query(
      `INSERT INTO webhook_subscriptions (url, secret, source) VALUES ('https://x.example/', NULL, 'env')`, []
    );
    const [row] = await c2_query(
      'SELECT enabled, consecutive_failures, paused_until, event_types, workspace_id FROM webhook_subscriptions WHERE id = ?',
      [env.insertId]
    );
    expect(row).toEqual({ enabled: 1, consecutive_failures: 0, paused_until: null, event_types: null, workspace_id: null });
    await c2_query('DELETE FROM webhook_subscriptions WHERE id = ?', [env.insertId]);
  });

  it('refuses a delivery status outside pending, delivered and dead', async () => {
    expect(await errorCode(() => c2_query(
      `INSERT INTO webhook_deliveries (subscription_id, event_id, status) VALUES (?, ?, 'sent')`,
      [subscriptionId, eventId]
    ))).toBe('ER_CHECK_CONSTRAINT_VIOLATED');
  });

  it('refuses a second event with the same uuid, and a second delivery of one event to one subscription', async () => {
    expect(await errorCode(() => insertEvent('00000000-0000-4000-8000-000000000001'))).toBe('ER_DUP_ENTRY');

    await c2_query('INSERT INTO webhook_deliveries (subscription_id, event_id) VALUES (?, ?)', [subscriptionId, eventId]);
    expect(await errorCode(() => c2_query(
      'INSERT INTO webhook_deliveries (subscription_id, event_id) VALUES (?, ?)', [subscriptionId, eventId]
    ))).toBe('ER_DUP_ENTRY');

    const [delivery] = await c2_query(
      'SELECT status, attempts, leased_by FROM webhook_deliveries WHERE subscription_id = ? AND event_id = ?',
      [subscriptionId, eventId]
    );
    expect(delivery).toEqual({ status: 'pending', attempts: 0, leased_by: null });
  });

  it('keeps the exact body bytes', async () => {
    const bytes = Buffer.from('{"title":"Café ☕ 🚀"}', 'utf8');
    const created = await c2_query(
      `INSERT INTO webhook_events (event_uuid, type, workspace_id, occurred_at, body)
       VALUES ('00000000-0000-4000-8000-0000000000b1', 'log.update', 1, '2026-09-28 00:00:00.123', ?)`,
      [bytes]
    );
    const [row] = await c2_query('SELECT body FROM webhook_events WHERE id = ?', [created.insertId]);
    expect(Buffer.compare(row.body, bytes)).toBe(0);
  });

  it('deletes a subscription\'s deliveries with it, and an event\'s deliveries with the event', async () => {
    const doomed = await insertSubscription('https://doomed.example/hook');
    await c2_query('INSERT INTO webhook_deliveries (subscription_id, event_id) VALUES (?, ?)', [doomed, eventId]);
    await c2_query('DELETE FROM webhook_subscriptions WHERE id = ?', [doomed]);
    expect(await c2_query('SELECT id FROM webhook_deliveries WHERE subscription_id = ?', [doomed])).toEqual([]);

    const pruned = await insertEvent('00000000-0000-4000-8000-0000000000c1');
    await c2_query('INSERT INTO webhook_deliveries (subscription_id, event_id) VALUES (?, ?)', [subscriptionId, pruned]);
    await c2_query('DELETE FROM webhook_events WHERE id = ?', [pruned]);
    expect(await c2_query('SELECT id FROM webhook_deliveries WHERE event_id = ?', [pruned])).toEqual([]);
  });

  it('keeps a subscription whose creator is deleted, with no creator', async () => {
    const user = await c2_query(`INSERT INTO users (name, email, password_hash) VALUES ('hookmaker', 'hookmaker@example.com', NULL)`, []);
    const created = await c2_query(
      `INSERT INTO webhook_subscriptions (url, secret, source, created_by) VALUES ('https://kept.example/', 's', 'admin', ?)`,
      [user.insertId]
    );
    await c2_query('DELETE FROM users WHERE id = ?', [user.insertId]);
    const [row] = await c2_query('SELECT created_by FROM webhook_subscriptions WHERE id = ?', [created.insertId]);
    expect(row).toEqual({ created_by: null });
  });
});
