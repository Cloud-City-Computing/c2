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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { c2_query } from '../../mysql_connect.js';
import { emitEvent, loadSubscriptions } from '../../services/webhooks.js';
import { schemaClaims, MIGRATIONS_DIR } from '../../scripts/migrate.js';

const here = path.dirname(fileURLToPath(import.meta.url));

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

/**
 * Resolve once `n` lock requests are parked on the order lock row: the emits
 * waiting behind the holder. Polls the server's own record of waiting requests,
 * so the test waits on the server's state, not on a guessed delay.
 * (information_schema.innodb_trx does not list an autocommit statement that is
 * waiting, so it cannot be used for this.)
 */
async function waitForLockWaits(n) {
  for (let i = 0; i < 1000; i++) {
    const [row] = await c2_query(
      "SELECT COUNT(*) AS n FROM performance_schema.data_locks WHERE OBJECT_NAME = 'webhook_sequence_lock' AND LOCK_STATUS = 'WAITING'",
      []
    );
    if (Number(row.n) >= n) return;
    await sleep(10);
  }
  throw new Error(`no ${n} lock request(s) parked on webhook_sequence_lock`);
}

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
  it('nothing seeds the lock row: init.sql and the migration insert none, and no row exists before the first emit', async () => {
    // restore.sh refuses a non-empty database unless told --replace, and counts
    // rows, so a seeded lock row would make a new install look like data. The
    // first emit creates the row instead (INSERT IGNORE inside its transaction).
    // Statements only: the comments in both files describe the seed in words.
    const statements = (file) =>
      readFileSync(file, 'utf8').split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
    const init = statements(path.join(here, '..', '..', '..', 'init.sql'));
    const migration = statements(path.join(MIGRATIONS_DIR, '2026-10-10-webhook-sequence-lock.sql'));
    expect(init).not.toMatch(/INSERT[^;]*webhook_sequence_lock/i);
    expect(migration).not.toMatch(/INSERT[^;]*webhook_sequence_lock/i);
    const [row] = await c2_query('SELECT COUNT(*) AS n FROM webhook_sequence_lock', []);
    expect(Number(row.n)).toBe(0);
  });

  it('an emit waits for the emit holding the order lock, so its id is above the one that commits first', async () => {
    holder = await openSecond();
    // As emitEvent does: the row is ensured in autocommit, then the transaction locks it.
    await holder.query('INSERT IGNORE INTO webhook_sequence_lock (id) VALUES (1)');
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

  it('a later emit that could finish first does not overtake an earlier emit still in flight', async () => {
    // Emit A takes its id, then blocks writing its deliveries: the subscription
    // row for its workspace is locked by the holder below. Emit B is for another
    // workspace, with no lock in its way, so without the order lock it would
    // insert, commit and become visible under a higher id before A commits.
    const subA = (await c2_query(
      `INSERT INTO webhook_subscriptions (url, secret, source, workspace_id) VALUES ('https://203.0.113.11/a', ?, 'admin', 1)`,
      ['d'.repeat(64)]
    )).insertId;
    await c2_query(
      `INSERT INTO webhook_subscriptions (url, secret, source, workspace_id) VALUES ('https://203.0.113.12/b', ?, 'admin', 2)`,
      ['d'.repeat(64)]
    );
    await loadSubscriptions();

    holder = await openSecond();
    await holder.beginTransaction();
    await holder.query('UPDATE webhook_subscriptions SET enabled = enabled WHERE id = ?', [subA]);

    const emitA = emitEvent(ACTION, { workspaceId: 1, squadId: null });
    await sleep(300);
    let bSettled = false;
    const emitB = emitEvent(ACTION, { workspaceId: 2, squadId: null }).then((result) => {
      bSettled = true;
      return result;
    });
    await sleep(400);
    // B must wait behind A (the order lock), so it cannot have committed yet.
    expect(bSettled).toBe(false);

    await holder.commit();
    const [a, b] = await Promise.all([emitA, emitB]);

    expect(a.deliveries).toBeGreaterThan(0);
    expect(b.deliveries).toBeGreaterThan(0);
    expect(a.eventId).toBeLessThan(b.eventId);
    const visible = (await c2_query('SELECT id FROM webhook_events ORDER BY id', [])).map((r) => Number(r.id));
    expect(visible).toEqual([a.eventId, b.eventId]);
  });

  it('occurred_at is the instant the order lock is granted, so two parked emits carry that instant', async () => {
    // Where each emit waits: emitEvent's INSERT IGNORE of the lock row is its own
    // autocommit statement, before the transaction, and the holder's FOR UPDATE
    // blocks it. So each emit parks at the INSERT IGNORE, not at the FOR UPDATE.
    // The clock is moved while each one is parked, and then the lock is released.
    // An emit that read its instant on entry carries the instant of its start;
    // one that reads it under the lock carries the grant instant, for both.
    holder = await openSecond();
    await holder.query('INSERT IGNORE INTO webhook_sequence_lock (id) VALUES (1)');
    await holder.beginTransaction();
    await holder.query('SELECT id FROM webhook_sequence_lock WHERE id = 1 FOR UPDATE');

    const T1 = Date.parse('2026-10-10T10:00:01.000Z');
    const T2 = Date.parse('2026-10-10T10:00:02.000Z');
    const T3 = Date.parse('2026-10-10T10:00:03.000Z');
    let emitA;
    let emitB;
    let a;
    let b;
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(T1);
      emitA = emitEvent(ACTION, SCOPE);
      await waitForLockWaits(1);
      vi.setSystemTime(T2);
      emitB = emitEvent(ACTION, SCOPE);
      await waitForLockWaits(2);
      vi.setSystemTime(T3);
      await holder.commit();
      // The granted emits run on after the commit; the clock must stay fake until they have read it.
      [a, b] = await Promise.all([emitA, emitB]);
    } finally {
      vi.useRealTimers();
    }

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    const rows = await c2_query(
      "SELECT id, DATE_FORMAT(occurred_at, '%Y-%m-%d %H:%i:%s.%f') AS at FROM webhook_events ORDER BY id",
      []
    );
    expect(rows.map((r) => Number(r.id))).toEqual([a.eventId, b.eventId].sort((x, y) => x - y));
    // Both grants happened after the clock reached T3, so both rows carry T3. An
    // emit that read its instant on entry would carry T1 and T2 instead.
    expect(rows.map((r) => r.at)).toEqual(['2026-10-10 10:00:03.000000', '2026-10-10 10:00:03.000000']);
  });

  it('the migration claims the lock table, so --adopt-fresh-install checks it', () => {
    const contents = readFileSync(path.join(MIGRATIONS_DIR, '2026-10-10-webhook-sequence-lock.sql'), 'utf8');
    expect(schemaClaims(contents)).toEqual([{ kind: 'table', table: 'webhook_sequence_lock' }]);
  });
});
