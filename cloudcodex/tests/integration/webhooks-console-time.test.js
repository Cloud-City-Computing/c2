/**
 * The webhook console's times, proved against a live MySQL server in a non-UTC zone
 *
 * The pool parses DATETIME values as Node local time, and this process runs with
 * TZ=Europe/London (BST in July). The webhook routes therefore read the UTC columns as
 * text (DATE_FORMAT) and the TIMESTAMP columns as epoch seconds, so a stored UTC instant
 * comes back as the same instant in its ISO form, whatever the server's zone is.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { c2_query, generateSessionToken } from '../../mysql_connect.js';
import { loadSubscriptions } from '../../services/webhooks.js';

let adminToken;
let originalTz;

beforeAll(async () => {
  originalTz = process.env.TZ;
  process.env.TZ = 'Europe/London';
  const created = await c2_query(
    `INSERT INTO users (name, email, password_hash, is_admin) VALUES ('tzadmin', 'tzadmin@example.com', NULL, TRUE)`,
    []
  );
  adminToken = await generateSessionToken({ id: created.insertId });
});

afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

beforeEach(async () => {
  await c2_query('DELETE FROM webhook_deliveries', []);
  await c2_query('DELETE FROM webhook_events', []);
  await c2_query('DELETE FROM webhook_subscriptions', []);
  await loadSubscriptions();
});

describe('the console read of a stored UTC instant, in Europe/London', () => {
  it('reads paused_until back as the same UTC instant, with milliseconds', async () => {
    expect(new Date(2026, 6, 1, 12).getTimezoneOffset()).toBe(-60);
    await c2_query(
      `INSERT INTO webhook_subscriptions (url, secret, source, enabled, consecutive_failures, paused_until)
       VALUES ('https://93.184.215.14/hook', ?, 'admin', TRUE, 3, '2026-07-01 12:00:00.250')`,
      ['e'.repeat(64)]
    );

    const res = await request(app).get('/api/admin/webhooks').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.webhooks[0].paused_until).toBe('2026-07-01T12:00:00.250Z');
  });

  it('reads created_at as the instant MySQL holds for it', async () => {
    const inserted = await c2_query(
      `INSERT INTO webhook_subscriptions (url, secret, source) VALUES ('https://93.184.215.14/hook', ?, 'admin')`,
      ['e'.repeat(64)]
    );
    const [{ seconds }] = await c2_query(
      'SELECT UNIX_TIMESTAMP(created_at) AS seconds FROM webhook_subscriptions WHERE id = ?',
      [inserted.insertId]
    );

    const res = await request(app).get('/api/admin/webhooks').set('Authorization', `Bearer ${adminToken}`);

    expect(res.body.webhooks[0].created_at).toBe(new Date(Number(seconds) * 1000).toISOString());
  });

  it('reads a delivery\'s event occurred_at and delivered_at back as UTC', async () => {
    const sub = await c2_query(
      `INSERT INTO webhook_subscriptions (url, secret, source) VALUES ('https://93.184.215.14/hook', ?, 'admin')`,
      ['e'.repeat(64)]
    );
    const event = await c2_query(
      `INSERT INTO webhook_events (event_uuid, type, workspace_id, occurred_at, body)
       VALUES ('00000000-0000-4000-8000-0000000000aa', 'log.rename', 1, '2026-07-01 12:00:00.250', '{}')`,
      []
    );
    await c2_query(
      `INSERT INTO webhook_deliveries (subscription_id, event_id, status, delivered_at)
       VALUES (?, ?, 'delivered', '2026-07-01 12:00:01.500')`,
      [sub.insertId, event.insertId]
    );

    const res = await request(app)
      .get(`/api/admin/webhooks/${sub.insertId}/deliveries`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.deliveries[0].occurred_at).toBe('2026-07-01T12:00:00.250Z');
    expect(res.body.deliveries[0].delivered_at).toBe('2026-07-01T12:00:01.500Z');
  });
});
