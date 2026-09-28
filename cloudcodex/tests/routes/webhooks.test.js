/**
 * Tests for the webhook admin API, /api/admin/webhooks
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import request from 'supertest';
import app from '../../app.js';
import { c2_query } from '../../mysql_connect.js';
import { mockAuthenticated, mockUnauthenticated, resetMocks, TEST_USER } from '../helpers.js';

const ADMIN_USER = { ...TEST_USER, is_admin: true };
const STORED_SECRET = 'f'.repeat(64);
const fingerprint = (secret) => createHash('sha256').update(secret, 'utf8').digest('hex').slice(0, 8);

/** A stored subscription row as the list query reads it. */
const row = (over = {}) => ({
  id: 4,
  url: 'https://93.184.215.14/hook',
  source: 'admin',
  secret: STORED_SECRET,
  enabled: 1,
  event_types: null,
  workspace_id: null,
  disabled_reason: null,
  consecutive_failures: 0,
  paused_until: null,
  created_by: 1,
  created_at: '2026-09-28T00:00:00.000Z',
  ...over,
});

/** Every SQL issued, in order. */
const sqls = () => c2_query.mock.calls.map(([sql]) => sql);

/** The admin routes and a body each accepts, for the refusal sweeps. */
const ROUTES = [
  ['get', '/api/admin/webhooks', undefined],
  ['post', '/api/admin/webhooks', { url: 'https://93.184.215.14/hook' }],
  ['post', '/api/admin/webhooks/4/rotate', undefined],
  ['patch', '/api/admin/webhooks/4', { enabled: true }],
  ['delete', '/api/admin/webhooks/4', undefined],
];

describe('/api/admin/webhooks', () => {
  let errorSpy;

  beforeEach(() => {
    resetMocks();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    delete process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS;
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it.each(ROUTES)('refuses a non-admin on %s %s with 403, touching nothing', async (method, url, body) => {
    mockAuthenticated(TEST_USER);
    const res = await request(app)[method](url).set('Authorization', 'Bearer t').send(body);
    expect(res.status).toBe(403);
    expect(c2_query).not.toHaveBeenCalled();
  });

  it.each(ROUTES)('refuses no session on %s %s with 401', async (method, url, body) => {
    mockUnauthenticated();
    const res = await request(app)[method](url).send(body);
    expect(res.status).toBe(401);
  });

  describe('GET', () => {
    it('lists subscriptions with a fingerprint and never the secret, the env row marked managed', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([
        row(),
        row({ id: 5, source: 'env', secret: null, url: 'https://command.example/hook', workspace_id: 3, event_types: ['log.rename'] }),
      ]);
      const res = await request(app).get('/api/admin/webhooks').set('Authorization', 'Bearer t');
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain(STORED_SECRET);
      expect(res.body.webhooks).toEqual([
        {
          id: 4, url: 'https://93.184.215.14/hook', source: 'admin', managed: false, enabled: true,
          event_types: null, workspace_id: null, disabled_reason: null, consecutive_failures: 0,
          paused_until: null, created_by: 1, created_at: '2026-09-28T00:00:00.000Z',
          secret_fingerprint: fingerprint(STORED_SECRET),
        },
        expect.objectContaining({ id: 5, source: 'env', managed: true, secret_fingerprint: null, event_types: ['log.rename'] }),
      ]);
      expect(res.body.webhooks[0]).not.toHaveProperty('secret');
    });
  });

  describe('POST', () => {
    it('creates a subscription and returns its secret once', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query
        .mockResolvedValueOnce([{ id: 3 }])                 // the workspace exists
        .mockResolvedValueOnce({ insertId: 6 })             // insert
        .mockResolvedValueOnce([])                          // cache reload
        .mockResolvedValueOnce([row({ id: 6, workspace_id: 3, event_types: ['log.rename', 'log.delete'] })]);

      // The secret is returned from the insert's own value, so capture it there.
      const res = await request(app)
        .post('/api/admin/webhooks')
        .set('Authorization', 'Bearer t')
        .send({ url: ' https://93.184.215.14/hook ', event_types: ['log.rename', 'log.delete', 'log.rename'], workspace_id: 3 });
      expect(res.status).toBe(201);
      expect(res.body.secret).toMatch(/^[0-9a-f]{64}$/);

      const insert = c2_query.mock.calls.find(([sql]) => /INSERT INTO webhook_subscriptions/.test(sql));
      expect(insert[0]).toMatch(/\(url, secret, source, event_types, workspace_id, created_by\)\s+VALUES \(\?, \?, 'admin', \?, \?, \?\)/);
      expect(insert[1]).toEqual(['https://93.184.215.14/hook', res.body.secret, '["log.rename","log.delete"]', 3, ADMIN_USER.id]);
      expect(sqls().some((sql) => /FROM webhook_subscriptions\s+WHERE enabled = TRUE/.test(sql))).toBe(true);
      expect(res.body.webhook).toMatchObject({ id: 6, managed: false });
      expect(res.body.webhook).not.toHaveProperty('secret');
    });

    it('generates a different secret each time', async () => {
      mockAuthenticated(ADMIN_USER);
      const secrets = [];
      for (let i = 0; i < 2; i += 1) {
        c2_query.mockResolvedValueOnce({ insertId: 6 + i }).mockResolvedValueOnce([]).mockResolvedValueOnce([row({ id: 6 + i })]);
        const res = await request(app).post('/api/admin/webhooks').set('Authorization', 'Bearer t').send({ url: 'https://93.184.215.14/hook' });
        expect(res.status).toBe(201);
        secrets.push(res.body.secret);
      }
      expect(secrets[0]).not.toBe(secrets[1]);
    });

    it('refuses a private target with the guard\'s sentence, and writes nothing', async () => {
      mockAuthenticated(ADMIN_USER);
      const res = await request(app).post('/api/admin/webhooks').set('Authorization', 'Bearer t').send({ url: 'https://10.0.0.5/hook' });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, message: expect.stringMatching(/^The webhook URL resolves to 10\.0\.0\.5/) });
      expect(c2_query).not.toHaveBeenCalled();
    });

    it('answers 400, not a failed insert, for a URL that grows past 2048 characters when normalised', async () => {
      mockAuthenticated(ADMIN_USER);
      const url = `https://93.184.215.14/${'é'.repeat(1000)}`;
      const res = await request(app).post('/api/admin/webhooks').set('Authorization', 'Bearer t').send({ url });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, message: expect.stringMatching(/2048/) });
      expect(c2_query).not.toHaveBeenCalled();
    });

    it('allows a private target when the instance opts in', async () => {
      mockAuthenticated(ADMIN_USER);
      process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS = '1';
      c2_query.mockResolvedValueOnce({ insertId: 6 }).mockResolvedValueOnce([]).mockResolvedValueOnce([row({ id: 6 })]);
      const res = await request(app).post('/api/admin/webhooks').set('Authorization', 'Bearer t').send({ url: 'https://10.0.0.5/hook' });
      expect(res.status).toBe(201);
      delete process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS;
    });

    it('refuses metadata addresses even when the instance opts in to private ones', async () => {
      mockAuthenticated(ADMIN_USER);
      process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS = '1';
      const res = await request(app).post('/api/admin/webhooks').set('Authorization', 'Bearer t').send({ url: 'http://169.254.169.254/latest' });
      expect(res.status).toBe(400);
      delete process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS;
    });

    it.each([
      ['no url', {}],
      ['a url that is not a string', { url: 42 }],
      ['event_types that is not an array', { url: 'https://93.184.215.14/', event_types: 'log.rename' }],
      ['an empty event_types', { url: 'https://93.184.215.14/', event_types: [] }],
      ['an unknown event type', { url: 'https://93.184.215.14/', event_types: ['comment.create'] }],
      ['a workspace_id that is not an id', { url: 'https://93.184.215.14/', workspace_id: 'three' }],
      ['a fractional workspace_id', { url: 'https://93.184.215.14/', workspace_id: 1.5 }],
    ])('refuses %s with 400 and writes nothing', async (_name, body) => {
      mockAuthenticated(ADMIN_USER);
      const res = await request(app).post('/api/admin/webhooks').set('Authorization', 'Bearer t').send(body);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(c2_query).not.toHaveBeenCalled();
    });

    it('refuses a workspace that does not exist', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([]);
      const res = await request(app).post('/api/admin/webhooks').set('Authorization', 'Bearer t').send({ url: 'https://93.184.215.14/', workspace_id: 99 });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/workspace/i);
      expect(sqls()).toHaveLength(1);
    });

    it('answers a failed write with the generic 500 and no secret', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockRejectedValueOnce(new Error('insert failed'));
      const res = await request(app).post('/api/admin/webhooks').set('Authorization', 'Bearer t').send({ url: 'https://93.184.215.14/' });
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ success: false, message: 'An internal server error occurred' });
    });
  });

  describe('POST /:id/rotate', () => {
    it('stores and returns a new secret, once', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([{ id: 4, source: 'admin' }]).mockResolvedValueOnce({ affectedRows: 1 }).mockResolvedValueOnce([]);
      const res = await request(app).post('/api/admin/webhooks/4/rotate').set('Authorization', 'Bearer t');
      expect(res.status).toBe(200);
      expect(res.body.secret).toMatch(/^[0-9a-f]{64}$/);
      expect(res.body.secret_fingerprint).toBe(fingerprint(res.body.secret));
      const update = c2_query.mock.calls[1];
      expect(update[0]).toMatch(/UPDATE webhook_subscriptions SET secret = \? WHERE id = \? AND source = 'admin'/);
      expect(update[1]).toEqual([res.body.secret, 4]);
    });

    it('refuses the env row, whose secret lives in the environment', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([{ id: 4, source: 'env' }]);
      const res = await request(app).post('/api/admin/webhooks/4/rotate').set('Authorization', 'Bearer t');
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/WEBHOOK_SECRET/);
      expect(sqls()).toHaveLength(1);
    });

    it('answers 404 for no such subscription and 400 for a bad id', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([]);
      expect((await request(app).post('/api/admin/webhooks/4/rotate').set('Authorization', 'Bearer t')).status).toBe(404);
      expect((await request(app).post('/api/admin/webhooks/abc/rotate').set('Authorization', 'Bearer t')).status).toBe(400);
    });
  });

  describe('PATCH /:id', () => {
    it('re-enabling clears the failure count, the pause and the reason', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query
        .mockResolvedValueOnce([{ id: 4, source: 'admin' }])
        .mockResolvedValueOnce({ affectedRows: 1 })
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([row()]);
      const res = await request(app).patch('/api/admin/webhooks/4').set('Authorization', 'Bearer t').send({ enabled: true });
      expect(res.status).toBe(200);
      expect(c2_query.mock.calls[1][0]).toMatch(
        /SET enabled = TRUE, consecutive_failures = 0, paused_until = NULL, disabled_reason = NULL\s+WHERE id = \?/
      );
      expect(res.body.webhook).toMatchObject({ id: 4, enabled: true });
      expect(JSON.stringify(res.body)).not.toContain(STORED_SECRET);
      expect(sqls().some((sql) => /WHERE enabled = TRUE/.test(sql))).toBe(true);
    });

    it('disabling records who turned it off', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query
        .mockResolvedValueOnce([{ id: 4, source: 'admin' }])
        .mockResolvedValueOnce({ affectedRows: 1 })
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([row({ enabled: 0, disabled_reason: 'Disabled by an administrator' })]);
      const res = await request(app).patch('/api/admin/webhooks/4').set('Authorization', 'Bearer t').send({ enabled: false });
      expect(res.status).toBe(200);
      expect(c2_query.mock.calls[1][0]).toMatch(/SET enabled = FALSE, disabled_reason = \? WHERE id = \?/);
      expect(c2_query.mock.calls[1][1]).toEqual(['Disabled by an administrator', 4]);
      expect(res.body.webhook.enabled).toBe(false);
    });

    it.each([[{}], [{ enabled: 'yes' }], [{ enabled: 1 }]])('refuses %j with 400', async (body) => {
      mockAuthenticated(ADMIN_USER);
      const res = await request(app).patch('/api/admin/webhooks/4').set('Authorization', 'Bearer t').send(body);
      expect(res.status).toBe(400);
      expect(c2_query).not.toHaveBeenCalled();
    });

    it('refuses the env row, which the environment manages', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([{ id: 4, source: 'env' }]);
      const res = await request(app).patch('/api/admin/webhooks/4').set('Authorization', 'Bearer t').send({ enabled: false });
      expect(res.status).toBe(409);
      expect(sqls()).toHaveLength(1);
    });

    it('answers 404 for no such subscription', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([]);
      expect((await request(app).patch('/api/admin/webhooks/4').set('Authorization', 'Bearer t').send({ enabled: true })).status).toBe(404);
    });
  });

  describe('DELETE /:id', () => {
    it('deletes an admin subscription and reloads the cache', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([{ id: 4, source: 'admin' }]).mockResolvedValueOnce({ affectedRows: 1 }).mockResolvedValueOnce([]);
      const res = await request(app).delete('/api/admin/webhooks/4').set('Authorization', 'Bearer t');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(c2_query.mock.calls[1]).toEqual([`DELETE FROM webhook_subscriptions WHERE id = ? AND source = 'admin'`, [4]]);
      expect(sqls()[2]).toMatch(/WHERE enabled = TRUE/);
    });

    it('refuses the env row', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([{ id: 4, source: 'env' }]);
      const res = await request(app).delete('/api/admin/webhooks/4').set('Authorization', 'Bearer t');
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/WEBHOOK_URL/);
      expect(sqls()).toHaveLength(1);
    });

    it('answers 404 for no such subscription', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([]);
      expect((await request(app).delete('/api/admin/webhooks/4').set('Authorization', 'Bearer t')).status).toBe(404);
    });
  });
});
