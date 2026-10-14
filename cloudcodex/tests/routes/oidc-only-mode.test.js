/**
 * Hosted mode refuses every local human sign-in on the server, route by route
 *
 * With AUTH_PROVIDERS=oidc (no local) the local sign-in routes answer 404 before they touch the
 * database: sign-up, password login, reset, 2FA, the username check, and the local email change. The
 * account update still renames, but an email or password change is refused with 403. Google's routes
 * answer 404 when Google is not offered. Each refusal is checked to have read nothing. With AUTH_PROVIDERS
 * unset, the same routes are reachable exactly as before.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { c2_query, validateAndAutoLogin } from '../../mysql_connect.js';
import { mockAuthenticated, resetMocks, TEST_USER } from '../helpers.js';

const KEYS = ['AUTH_PROVIDERS', 'APP_URL', 'OIDC_ISSUER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];

/** Every local-only route, with a body that would be valid if the route were mounted. */
const LOCAL_ROUTES = [
  ['post', '/api/login', { username: 'alice', password: 'Password1!' }],
  ['post', '/api/create-account', { username: 'alice', password: 'Password1!', email: 'a@test.com', inviteToken: 't' }],
  ['get', '/api/check-username/alice', undefined],
  ['post', '/api/forgot-password', { email: 'a@test.com' }],
  ['post', '/api/reset-password', { token: 't', password: 'Password1!' }],
  ['post', '/api/2fa/verify', { twoFactorToken: 't', code: '123456' }],
  ['post', '/api/2fa/enable', { method: 'totp' }],
  ['post', '/api/2fa/totp/confirm', { code: '123456' }],
  ['post', '/api/2fa/disable', { password: 'Password1!' }],
  ['post', '/api/2fa/disable/confirm', { code: '123456' }],
  ['get', '/api/2fa/status', undefined],
  ['post', '/api/update-account/confirm-email', { confirmToken: 't', code: '123456' }],
];

describe('hosted mode (AUTH_PROVIDERS without local)', () => {
  let saved;

  beforeEach(() => {
    resetMocks();
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
    process.env.AUTH_PROVIDERS = 'oidc';
    process.env.OIDC_ISSUER_URL = 'https://id.example.test';
    process.env.APP_URL = 'https://codex.example.test';
    process.env.OIDC_CLIENT_ID = 'test-client';
    process.env.OIDC_CLIENT_SECRET = 'test-secret';
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const send = (method, path, body) => {
    const req = request(app)[method](path);
    return body === undefined ? req : req.send(body);
  };

  describe.each(LOCAL_ROUTES)('%s %s', (method, path, body) => {
    it('answers 404 and reads nothing, before any authentication', async () => {
      const res = await send(method, path, body);
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(c2_query).not.toHaveBeenCalled();
      expect(validateAndAutoLogin).not.toHaveBeenCalled();
    });
  });

  it('leaves the local route mounted when local is listed, as today', async () => {
    process.env.AUTH_PROVIDERS = 'local,oidc';
    c2_query.mockResolvedValueOnce([]); // the login lookup finds no user
    const res = await request(app).post('/api/login').send({ username: 'alice', password: 'Password1!' });
    expect(res.status).toBe(401);
    expect(c2_query).toHaveBeenCalled();
  });

  describe('account update', () => {
    it('refuses an email change with 403 and writes nothing', async () => {
      mockAuthenticated(TEST_USER);
      const res = await request(app)
        .post('/api/update-account')
        .send({ token: 't', userId: TEST_USER.id, email: 'other@test.com', currentPassword: 'x' });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/sign-in provider/);
      expect(c2_query.mock.calls.filter(([sql]) => /^\s*(UPDATE|INSERT|DELETE)/i.test(sql))).toEqual([]);
    });

    it('refuses a password change with 403 and writes nothing', async () => {
      mockAuthenticated(TEST_USER);
      const res = await request(app)
        .post('/api/update-account')
        .send({ token: 't', userId: TEST_USER.id, password: 'NewPassword1!', currentPassword: 'x' });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/sign-in provider/);
      expect(c2_query.mock.calls.filter(([sql]) => /^\s*(UPDATE|INSERT|DELETE)/i.test(sql))).toEqual([]);
    });

    it('still renames: the display name is not a sign-in credential', async () => {
      mockAuthenticated(TEST_USER);
      c2_query.mockResolvedValueOnce([]); // no other user holds the name
      c2_query.mockResolvedValueOnce({ affectedRows: 1 });
      const res = await request(app)
        .post('/api/update-account')
        .send({ token: 't', userId: TEST_USER.id, name: 'renamed' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('accepts an email that arrives unchanged, the way the account panel sends the form', async () => {
      mockAuthenticated(TEST_USER);
      c2_query.mockResolvedValueOnce([]); // no other user holds the name
      c2_query.mockResolvedValueOnce({ affectedRows: 1 });
      const res = await request(app)
        .post('/api/update-account')
        .send({ token: 't', userId: TEST_USER.id, name: 'renamed', email: TEST_USER.email });
      expect(res.status).toBe(200);
    });
  });

  describe('Google sign-in', () => {
    it('answers 404 on the start and callback routes when Google is not offered', async () => {
      const start = await request(app).get('/api/oauth/google');
      const callback = await request(app).get('/api/oauth/google/callback?code=x&state=y');
      expect(start.status).toBe(404);
      expect(callback.status).toBe(404);
      expect(c2_query).not.toHaveBeenCalled();
    });

    it('reports google and local as not offered on /api/oauth/providers, and oidc as the only one', async () => {
      const res = await request(app).get('/api/oauth/providers');
      expect(res.body.providers.google).toBe(false);
      expect(res.body.providers.local).toBe(false);
      expect(res.body.providers.oidc.enabled).toBe(true);
    });
  });

  it('reports local as offered on /api/oauth/providers when AUTH_PROVIDERS is unset', async () => {
    delete process.env.AUTH_PROVIDERS;
    delete process.env.OIDC_ISSUER_URL;
    const res = await request(app).get('/api/oauth/providers');
    expect(res.body.providers.local).toBe(true);
  });
});
