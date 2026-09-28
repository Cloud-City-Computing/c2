/**
 * Tests for the cookies routes/oauth.js writes on an https instance: the __Host- names
 *
 * routes/oauth.js decides Secure from APP_URL, which routes/helpers/shared.js
 * reads at import time, so an https instance needs its own file. On https the
 * Google callback sets __Host-sessionToken, and both providers' state cookies
 * are __Host-oauth_state_<provider>: Secure, Path=/ and no Domain, the three
 * things a browser requires before it stores a __Host- cookie, and the reason
 * a sibling host cannot plant one. A callback reads the state only under that
 * exact name.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';

const google = vi.hoisted(() => {
  const priorAppUrl = process.env.APP_URL;
  process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
  process.env.GITHUB_CLIENT_ID = 'test-github-client-id';
  process.env.GITHUB_CLIENT_SECRET = 'test-github-client-secret-0123456789';
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
import { mockAuthenticated, resetMocks, TEST_USER } from '../helpers.js';

const GOOGLE_COOKIE = '__Host-oauth_state_google';
const GITHUB_COOKIE = '__Host-oauth_state_github';

const setCookie = (res, name) => (res.headers['set-cookie'] || []).find(c => c.startsWith(`${name}=`));
const stateOf = (res) => new URL(res.headers.location).searchParams.get('state');

/** The attributes a browser demands before it stores a __Host- cookie, and no Domain. */
function expectHostOnly(cookie) {
  expect(cookie).toMatch(/;\s*Secure(;|$)/i);
  expect(cookie).toMatch(/;\s*Path=\/(;|$)/i);
  expect(cookie).not.toMatch(/;\s*Domain=/i);
}

async function signIn() {
  c2_query.mockResolvedValueOnce([{ user_id: 42 }]);
  c2_query.mockResolvedValueOnce([{ id: 42, name: 'ada', avatar_url: null, is_admin: 0 }]);
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

// The state cookie binds a callback to the browser that started the flow. A
// sibling host could plant a plain `oauth_state_<provider>` holding a state it
// minted itself, so on https the state lives only under the __Host- name.
describe('the OAuth state cookies on an https instance', () => {
  beforeEach(() => {
    resetMocks();
    google.getToken.mockReset();
    google.verifyIdToken.mockReset();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ access_token: 'gho_token' }) })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Google initiation sets __Host-oauth_state_google: HttpOnly, SameSite=Lax, Secure, Path=/, no Domain', async () => {
    const res = await request(app).get('/api/oauth/google');

    const cookie = setCookie(res, GOOGLE_COOKIE);
    expect(cookie).toContain(`${GOOGLE_COOKIE}=${stateOf(res)}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expectHostOnly(cookie);
    expect(setCookie(res, 'oauth_state_google')).toBeUndefined();
  });

  it('Google callback clears the state under the same name and attributes, so the clear lands', async () => {
    const res = await signIn();
    const cleared = setCookie(res, GOOGLE_COOKIE);
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/i);
    expectHostOnly(cleared);
  });

  for (const [label, name] of [
    ['a plain oauth_state_google', 'oauth_state_google'],
    ['a name that starts with U+00A0', '\u00a0__Host-oauth_state_google'],
  ]) {
    it(`Google callback refuses a state held only in ${label}, and signs nobody in`, async () => {
      const start = await request(app).get('/api/oauth/google');
      const state = stateOf(start);

      const res = await request(app)
        .get(`/api/oauth/google/callback?code=attacker-code&state=${state}`)
        .set('Cookie', `${name}=${state}`);

      expect(res.headers.location).toBe('/?oauth_error=invalid_state');
      expect(google.getToken).not.toHaveBeenCalled();
      expect(setCookie(res, '__Host-sessionToken')).toBeUndefined();
    });
  }

  it('GitHub initiation sets __Host-oauth_state_github: HttpOnly, SameSite=Lax, Secure, Path=/, no Domain', async () => {
    mockAuthenticated(TEST_USER);
    const res = await request(app).get('/api/oauth/github').set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(302);
    const cookie = setCookie(res, GITHUB_COOKIE);
    expect(cookie).toContain(`${GITHUB_COOKIE}=${stateOf(res)}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expectHostOnly(cookie);
    expect(setCookie(res, 'oauth_state_github')).toBeUndefined();
  });

  it('GitHub callback links with the __Host- state, and refuses a plain oauth_state_github before any exchange', async () => {
    mockAuthenticated(TEST_USER);
    const own = await request(app).get('/api/oauth/github').set('Authorization', 'Bearer valid-token');
    const linked = await request(app)
      .get(`/api/oauth/github/callback?code=good-code&state=${stateOf(own)}`)
      .set('Cookie', `${GITHUB_COOKIE}=${stateOf(own)}`);
    expect(linked.headers.location).not.toMatch(/invalid_state/);
    expect(fetch).toHaveBeenCalled();

    fetch.mockClear();
    const other = await request(app).get('/api/oauth/github').set('Authorization', 'Bearer valid-token');
    const refused = await request(app)
      .get(`/api/oauth/github/callback?code=victim-code&state=${stateOf(other)}`)
      .set('Cookie', `oauth_state_github=${stateOf(other)}`);
    expect(refused.headers.location).toBe('/account?github_error=invalid_state');
    expect(fetch).not.toHaveBeenCalled();
  });
});
