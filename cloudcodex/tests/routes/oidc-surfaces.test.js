/**
 * The OIDC surfaces the sign-in screen and the account page read (W6-CDX-5, Task 5.7)
 *
 * GET /api/oauth/providers names the OIDC provider and whether it is on; GET /api/2fa/status says who
 * manages the second factor (managed_by: 'oidc' for an OIDC session, null otherwise).
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { c2_query, getSessionProvider } from '../../mysql_connect.js';
import { mockAuthenticated, resetMocks } from '../helpers.js';

const OIDC_KEYS = ['OIDC_ISSUER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_PROVIDER_NAME', 'OIDC_ACCOUNT_URL', 'APP_URL'];

describe('GET /api/oauth/providers, the oidc entry', () => {
  beforeEach(() => {
    resetMocks();
    for (const key of OIDC_KEYS) delete process.env[key];
  });

  afterEach(() => {
    for (const key of OIDC_KEYS) delete process.env[key];
  });

  it('reports oidc off, under the default name, when no issuer is set', async () => {
    const res = await request(app).get('/api/oauth/providers');
    expect(res.body.providers.oidc).toEqual({ enabled: false, name: 'SSO', accountUrl: null });
  });

  it('reports oidc on, under OIDC_PROVIDER_NAME, when an issuer is configured', async () => {
    process.env.OIDC_ISSUER_URL = 'https://id.example.test';
    process.env.OIDC_CLIENT_ID = 'codex-web';
    process.env.OIDC_CLIENT_SECRET = 'a-secret-for-the-surface-tests';
    process.env.APP_URL = 'https://codex.example.test';
    process.env.OIDC_PROVIDER_NAME = 'Example ID';
    const res = await request(app).get('/api/oauth/providers');
    expect(res.body.providers.oidc).toEqual({ enabled: true, name: 'Example ID', accountUrl: null });
  });

  it('serves OIDC_ACCOUNT_URL beside the name, for the account page link (W6-CDX-42)', async () => {
    process.env.OIDC_ISSUER_URL = 'https://id.example.test';
    process.env.OIDC_CLIENT_ID = 'codex-web';
    process.env.OIDC_CLIENT_SECRET = 'a-secret-for-the-surface-tests';
    process.env.APP_URL = 'https://codex.example.test';
    process.env.OIDC_ACCOUNT_URL = 'https://id.example.test/ui/console/users/me';
    const res = await request(app).get('/api/oauth/providers');
    expect(res.body.providers.oidc.accountUrl).toBe('https://id.example.test/ui/console/users/me');
  });
});

describe('GET /api/2fa/status, managed_by', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('says oidc for an OIDC session, whose issuer governs the second factor', async () => {
    mockAuthenticated();
    getSessionProvider.mockResolvedValueOnce('oidc');
    c2_query.mockResolvedValueOnce([{ two_factor_method: 'totp' }]);

    const res = await request(app).get('/api/2fa/status').set('Authorization', 'Bearer valid-token');

    expect(res.body).toMatchObject({ method: 'totp', enabled: true, managed_by: 'oidc' });
  });

  it('says null for a local or Google session', async () => {
    mockAuthenticated();
    getSessionProvider.mockResolvedValueOnce('google');
    c2_query.mockResolvedValueOnce([{ two_factor_method: 'none' }]);

    const res = await request(app).get('/api/2fa/status').set('Authorization', 'Bearer valid-token');

    expect(res.body.managed_by).toBeNull();
  });
});
