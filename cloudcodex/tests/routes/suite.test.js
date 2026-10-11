/**
 * Cloud Codex - Tests for routes/suite.js
 *
 * GET /api/suite is public and never carries the Cloud Command URL. GET /api/suite/links
 * requires a session, so an anonymous caller never learns the URL, and it is a 404 when suite
 * mode is off.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { mockAuthenticated, mockUnauthenticated, resetMocks } from '../helpers.js';

const KEYS = ['SUITE_COMMAND_WORKSPACE_URL', 'SUITE_NAME', 'NODE_ENV', 'OIDC_ISSUER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_PROVIDER_NAME', 'APP_URL'];
const URL_OK = 'https://command.example.test/w/1';
let saved;

function suiteOn() {
  process.env.SUITE_COMMAND_WORKSPACE_URL = URL_OK;
  process.env.SUITE_NAME = 'Example Suite';
}

beforeEach(() => {
  resetMocks();
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  process.env.NODE_ENV = 'test';
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('GET /api/suite', () => {
  it('answers enabled false and a null name when suite mode is off', async () => {
    const res = await request(app).get('/api/suite');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false, name: null });
  });

  it('answers the name, never the URL, when suite mode is on', async () => {
    suiteOn();
    const res = await request(app).get('/api/suite');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: true, name: 'Example Suite' });
    expect(JSON.stringify(res.body)).not.toContain('command.example.test');
  });

  it('needs no session', async () => {
    mockUnauthenticated();
    const res = await request(app).get('/api/suite');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/suite/links', () => {
  it('is 401 for an anonymous caller when suite mode is on', async () => {
    suiteOn();
    mockUnauthenticated();
    const res = await request(app).get('/api/suite/links');
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain('command.example.test');
  });

  it('is 401 for an anonymous caller when suite mode is off too', async () => {
    mockUnauthenticated();
    const res = await request(app).get('/api/suite/links');
    expect(res.status).toBe(401);
  });

  it('is 404 for a signed-in caller when suite mode is off', async () => {
    mockAuthenticated();
    const res = await request(app).get('/api/suite/links').set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(404);
  });

  it('answers the Cloud Command URL for a signed-in caller when suite mode is on', async () => {
    suiteOn();
    mockAuthenticated();
    const res = await request(app).get('/api/suite/links').set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ commandWorkspaceUrl: new URL(URL_OK).href });
  });
});

describe('GET /api/oauth/providers, the OIDC button name in suite mode (W6-CDX-26)', () => {
  function oidcOn() {
    process.env.OIDC_ISSUER_URL = 'https://id.example.test';
    process.env.OIDC_CLIENT_ID = 'codex-web';
    process.env.OIDC_CLIENT_SECRET = 'a-secret-for-the-suite-tests';
    process.env.APP_URL = 'https://codex.example.test';
  }

  it('names the button after the suite when OIDC_PROVIDER_NAME is unset', async () => {
    oidcOn();
    suiteOn();
    const res = await request(app).get('/api/oauth/providers');
    expect(res.body.providers.oidc).toEqual({ enabled: true, name: 'Example Suite' });
  });

  it('keeps OIDC_PROVIDER_NAME when it is set, even in suite mode', async () => {
    oidcOn();
    suiteOn();
    process.env.OIDC_PROVIDER_NAME = 'Cloud City ID';
    const res = await request(app).get('/api/oauth/providers');
    expect(res.body.providers.oidc).toEqual({ enabled: true, name: 'Cloud City ID' });
  });

  it('keeps the default SSO name outside suite mode', async () => {
    oidcOn();
    const res = await request(app).get('/api/oauth/providers');
    expect(res.body.providers.oidc).toEqual({ enabled: true, name: 'SSO' });
  });
});
