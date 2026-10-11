/**
 * The subscription cap, proved against a live MySQL server
 *
 * The count check sits in the INSERT itself (INSERT ... SELECT ... WHERE
 * (SELECT COUNT(*) ...) < 50), so MySQL has to accept that statement shape.
 * The unit suite mocks the query; this file runs the real one at the limit.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { c2_query, generateSessionToken } from '../../mysql_connect.js';
import { loadSubscriptions } from '../../services/webhooks.js';

let adminToken;

const count = async () => Number((await c2_query('SELECT COUNT(*) AS n FROM webhook_subscriptions', []))[0].n);

beforeAll(async () => {
  const created = await c2_query(
    `INSERT INTO users (name, email, password_hash, is_admin) VALUES ('capadmin', 'capadmin@example.com', NULL, TRUE)`,
    []
  );
  adminToken = await generateSessionToken({ id: created.insertId });
});

beforeEach(async () => {
  await c2_query('DELETE FROM webhook_deliveries', []);
  await c2_query('DELETE FROM webhook_subscriptions', []);
  await loadSubscriptions();
});

describe('the subscription cap', () => {
  it('admits the fiftieth subscription and refuses the fifty-first, leaving the count at fifty', async () => {
    for (let i = 0; i < 49; i += 1) {
      await c2_query(`INSERT INTO webhook_subscriptions (url, secret, source) VALUES (?, ?, 'admin')`, [
        `https://203.0.113.${i + 1}/hook`,
        'e'.repeat(64),
      ]);
    }
    expect(await count()).toBe(49);

    const fiftieth = await request(app)
      .post('/api/admin/webhooks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ url: 'https://203.0.113.200/hook' });
    expect(fiftieth.status).toBe(201);
    expect(await count()).toBe(50);

    const refused = await request(app)
      .post('/api/admin/webhooks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ url: 'https://203.0.113.201/hook' });
    expect(refused.status).toBe(409);
    expect(refused.body.message).toMatch(/maximum of 50 webhook subscriptions/);
    expect(await count()).toBe(50);
  });
});
