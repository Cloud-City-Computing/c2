/**
 * Tests for the Google callback's session cookie on an https instance: the __Host- name
 *
 * routes/oauth.js decides Secure from APP_URL, which routes/helpers/shared.js
 * reads at import time, so an https instance needs its own file. On https the
 * one server-side writer sets __Host-sessionToken: Secure, Path=/ and no
 * Domain, the three things a browser requires before it stores a __Host-
 * cookie, and the reason a sibling host cannot plant one.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

const google = vi.hoisted(() => {
  const priorAppUrl = process.env.APP_URL;
  process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
  process.env.APP_URL = 'https://codex.example.com';
  delete process.env.GOOGLE_OAUTH_DOMAIN;
  return { getToken: vi.fn(), verifyIdToken: vi.fn(), priorAppUrl };
});

vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    generateAuthUrl(options) {
      return `https://accounts.google.example/auth?state=${options.state}`;
    }
    getToken(code) {
      return google.getToken(code);
    }
    verifyIdToken(options) {
      return google.verifyIdToken(options);
    }
  },
}));

import request from 'supertest';
import app from '../../app.js';
import { c2_query } from '../../mysql_connect.js';
import { resetMocks } from '../helpers.js';

const GOOGLE_COOKIE = 'oauth_state_google';

async function signIn() {
  google.getToken.mockResolvedValueOnce({ tokens: { id_token: 'id-token' } });
  google.verifyIdToken.mockResolvedValueOnce({
    getPayload: () => ({ sub: 'google-sub-1', email: 'ada@example.com', email_verified: true }),
  });
  const start = await request(app).get('/api/oauth/google');
  const state = new URL(start.headers.location).searchParams.get('state');
  return request(app)
    .get(`/api/oauth/google/callback?code=good-code&state=${state}`)
    .set('Cookie', `${GOOGLE_COOKIE}=${state}`);
}

afterAll(() => {
  if (google.priorAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = google.priorAppUrl;
});

describe('Google callback on an https instance', () => {
  beforeEach(() => {
    resetMocks();
    google.getToken.mockReset();
    google.verifyIdToken.mockReset();
    c2_query.mockResolvedValueOnce([{ user_id: 42 }]);
    c2_query.mockResolvedValueOnce([{ id: 42, name: 'ada', avatar_url: null, is_admin: 0 }]);
  });

  it('sets __Host-sessionToken, Secure, Path=/, and never the legacy name', async () => {
    const res = await signIn();

    expect(res.status).toBe(302);
    const cookies = res.headers['set-cookie'] || [];
    const session = cookies.find(c => c.startsWith('__Host-sessionToken='));
    expect(session).toMatch(/^__Host-sessionToken=mock-session-token;/);
    expect(session).toMatch(/;\s*Secure(;|$)/i);
    expect(session).toMatch(/;\s*Path=\/(;|$)/i);
    expect(session).toMatch(/;\s*SameSite=Strict(;|$)/i);
    expect(cookies.some(c => c.startsWith('sessionToken='))).toBe(false);
  });

  it('carries Domain on no Set-Cookie at all', async () => {
    const res = await signIn();

    const cookies = res.headers['set-cookie'] || [];
    expect(cookies.length).toBeGreaterThan(0);
    for (const cookie of cookies) expect(cookie).not.toMatch(/;\s*Domain=/i);
  });
});
