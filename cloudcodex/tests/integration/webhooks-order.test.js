/**
 * The outbox ids are allocated in commit order, proved against a live MySQL
 *
 * A receiver is handed sequence (the outbox id) in the order the rows become
 * visible, so an emit must not take a lower id than an emit that commits
 * before it. emitEvent therefore locks webhook_sequence_lock FOR UPDATE before
 * its INSERT. The first test holds that lock from a second connection, the way
 * an in-flight emit would, and shows that the emit waits, and then takes an id
 * above the one committed under the lock.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { c2_query } from '../../mysql_connect.js';
import { emitEvent, loadSubscriptions } from '../../services/webhooks.js';
import { schemaClaims, MIGRATIONS_DIR } from '../../scripts/migrate.js';

const ACTION = { action: 'archive.delete', resourceId: 9, user: { id: 1, name: 'order' }, metadata: {} };
const SCOPE = { workspaceId: 1, squadId: null };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A second connection to the test schema, for the part of the test that holds a lock. */
const openSecond = () =>
  mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
  });

let holder;

beforeEach(async () => {
  await c2_query('DELETE FROM webhook_deliveries', []);
  await c2_query('DELETE FROM webhook_events', []);
  await c2_query('DELETE FROM webhook_subscriptions', []);
  await c2_query(
    `INSERT INTO webhook_subscriptions (url, secret, source) VALUES ('https://203.0.113.10/order', ?, 'admin')`,
    ['d'.repeat(64)]
  );
  await loadSubscriptions();
});

afterEach(async () => {
  if (holder) {
    await holder.rollback().catch(() => {});
    await holder.end();
    holder = null;
  }
});

describe('emit order', () => {
  it('an emit waits for the emit holding the order lock, so its id is above the one that commits first', async () => {
    holder = await openSecond();
    await holder.beginTransaction();
    // The in-flight emit: it holds the order lock and has taken an id, but has not committed.
    await holder.query('SELECT id FROM webhook_sequence_lock WHERE id = 1 FOR UPDATE');
    const [inserted] = await holder.query(
      `INSERT INTO webhook_events (event_uuid, type, workspace_id, occurred_at, body)
       VALUES ('00000000-0000-4000-8000-0000000000aa', 'archive.delete', 1, UTC_TIMESTAMP(3), ?)`,
      [Buffer.from('{}', 'utf8')]
    );
    const slowId = inserted.insertId;

    let settled = false;
    const later = emitEvent(ACTION, SCOPE).then((result) => {
      settled = true;
      return result;
    });

    // Without the lock the second emit would have committed by now.
    await sleep(400);
    expect(settled).toBe(false);

    await holder.commit();
    const result = await later;

    expect(result).not.toBeNull();
    expect(result.eventId).toBeGreaterThan(slowId);
    const visible = (await c2_query('SELECT id FROM webhook_events ORDER BY id', [])).map((r) => Number(r.id));
    expect(visible).toEqual([slowId, result.eventId]);
  });

  it('overlapping emits never leave a gap: every snapshot of the visible ids is contiguous', async () => {
    const snapshots = [];
    let done = false;
    const reader = (async () => {
      while (!done) {
        snapshots.push((await c2_query('SELECT id FROM webhook_events ORDER BY id', [])).map((r) => Number(r.id)));
      }
    })();

    const results = await Promise.all(Array.from({ length: 40 }, () => emitEvent(ACTION, SCOPE)));
    done = true;
    await reader;

    const ids = results.map((r) => r.eventId);
    expect(new Set(ids).size).toBe(40);
    for (const snapshot of snapshots) {
      if (snapshot.length === 0) continue;
      const contiguous = snapshot.every((id, i) => i === 0 || id === snapshot[i - 1] + 1);
      expect(contiguous, `visible ids ${snapshot.join(',')}`).toBe(true);
    }
  });

  it('the migration claims the lock table, so --adopt-fresh-install checks it', () => {
    const contents = readFileSync(path.join(MIGRATIONS_DIR, '2026-10-10-webhook-sequence-lock.sql'), 'utf8');
    expect(schemaClaims(contents)).toEqual([{ kind: 'table', table: 'webhook_sequence_lock' }]);
  });
});
