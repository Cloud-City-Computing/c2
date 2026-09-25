/**
 * OAuth state is bound to the browser that started the flow.
 *
 * The provider callbacks used to trust a state value for whichever browser
 * completed it. For GitHub linking that let an attacker start a link, withhold
 * the authorization URL, and have a victim complete it: the victim's GitHub
 * token was then stored against the ATTACKER's Codex account. These tests drive
 * the real initiation and callback routes, with the providers configured, and
 * assert that a callback whose browser does not hold the initiation's state
 * cookie is refused before any token exchange or database write.
 *
 * The provider env must exist before routes/oauth.js loads (it reads the client
 * ids at import time), hence vi.hoisted.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.hoisted(() => {
  process.env.GITHUB_CLIENT_ID = 'test-github-client-id';
  process.env.GITHUB_CLIENT_SECRET = 'test-github-client-secret-0123456789';
  process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
});

import request from 'supertest';
import app from '../../app.js';
import { c2_query } from '../../mysql_connect.js';
import { mockAuthenticated, resetMocks, TEST_USER, TEST_USER_2 } from '../helpers.js';

const GITHUB_COOKIE = 'oauth_state_github';
const GOOGLE_COOKIE = 'oauth_state_google';

function stateFromLocation(location) {
  return new URL(location).searchParams.get('state');
}

function setCookieHeader(res, name) {
  return (res.headers['set-cookie'] || []).find(c => c.startsWith(`${name}=`));
}

/** Starts a GitHub link as `user` and returns the state plus the cookie that browser holds. */
async function startGithubLink(user) {
  mockAuthenticated(user);
  const res = await request(app).get('/api/oauth/github').set('Authorization', 'Bearer valid-token');
  expect(res.status).toBe(302);
  const state = stateFromLocation(res.headers.location);
  expect(state).toMatch(/^[0-9a-f]{64}$/);
  return { state, cookie: `${GITHUB_COOKIE}=${state}`, res };
}

function githubFetchMock() {
  return vi.fn(async (url) => {
    const u = String(url);
    if (u.startsWith('https://github.com/login/oauth/access_token')) {
      return { ok: true, json: async () => ({ access_token: 'gho_victim_token' }) };
    }
    if (u === 'https://api.github.com/user') {
      return { ok: true, json: async () => ({ id: 4242, login: 'victim', avatar_url: null, email: 'victim@example.com' }) };
    }
    return { ok: true, json: async () => [] };
  });
}

const oauthAccountWrites = () =>
  c2_query.mock.calls.filter(([sql]) => /oauth_accounts/i.test(sql) && /INSERT|UPDATE/i.test(sql));

describe('OAuth state is bound to the initiating browser', () => {
  let fetchMock;

  beforeEach(() => {
    resetMocks();
    fetchMock = githubFetchMock();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('GitHub linking', () => {
    it('sets an httpOnly, SameSite=Lax state cookie scoped to /api/oauth on initiation', async () => {
      const { state, res } = await startGithubLink(TEST_USER);
      const cookie = setCookieHeader(res, GITHUB_COOKIE);
      expect(cookie).toBeDefined();
      expect(cookie).toContain(`${GITHUB_COOKIE}=${state}`);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(cookie).toMatch(/Path=\/api\/oauth/i);
    });

    it('links the account when the same browser completes its own flow', async () => {
      const { state, cookie } = await startGithubLink(TEST_USER);
      const res = await request(app)
        .get(`/api/oauth/github/callback?code=good-code&state=${state}`)
        .set('Cookie', cookie);
      expect(res.headers.location).toBe('/account?github_linked=1');
      expect(fetchMock).toHaveBeenCalled();
      const insert = oauthAccountWrites().find(([sql]) => /INSERT/i.test(sql));
      expect(insert).toBeDefined();
      expect(insert[1][0]).toBe(TEST_USER.id);
    });

    it("refuses a victim's browser completing an attacker's flow, before any token exchange or write", async () => {
      // The attacker starts a link and keeps the authorization URL.
      const { state } = await startGithubLink(TEST_USER_2);
      // The victim completes it in THEIR browser, which holds no state cookie.
      const res = await request(app).get(`/api/oauth/github/callback?code=victim-code&state=${state}`);
      expect(res.headers.location).toBe('/account?github_error=invalid_state');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(oauthAccountWrites()).toEqual([]);
    });

    it("refuses when the browser holds a different flow's state cookie", async () => {
      const attacker = await startGithubLink(TEST_USER_2);
      const victim = await startGithubLink(TEST_USER);
      const res = await request(app)
        .get(`/api/oauth/github/callback?code=victim-code&state=${attacker.state}`)
        .set('Cookie', victim.cookie);
      expect(res.headers.location).toBe('/account?github_error=invalid_state');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(oauthAccountWrites()).toEqual([]);
    });

    it('burns the state on a refused attempt, so it cannot be completed afterwards', async () => {
      const { state, cookie } = await startGithubLink(TEST_USER_2);
      await request(app).get(`/api/oauth/github/callback?code=x&state=${state}`);
      const retry = await request(app)
        .get(`/api/oauth/github/callback?code=x&state=${state}`)
        .set('Cookie', cookie);
      expect(retry.headers.location).toBe('/account?github_error=invalid_state');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('clears the state cookie on the callback', async () => {
      const { state, cookie } = await startGithubLink(TEST_USER);
      const res = await request(app)
        .get(`/api/oauth/github/callback?code=good-code&state=${state}`)
        .set('Cookie', cookie);
      const cleared = setCookieHeader(res, GITHUB_COOKIE);
      expect(cleared).toBeDefined();
      expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/i);
    });
  });

  describe('Google sign-in', () => {
    it('sets a Google state cookie on initiation', async () => {
      const res = await request(app).get('/api/oauth/google');
      expect(res.status).toBe(302);
      const state = stateFromLocation(res.headers.location);
      const cookie = setCookieHeader(res, GOOGLE_COOKIE);
      expect(cookie).toContain(`${GOOGLE_COOKIE}=${state}`);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
    });

    it('refuses a callback from a browser that did not start the flow', async () => {
      const start = await request(app).get('/api/oauth/google');
      const state = stateFromLocation(start.headers.location);
      const res = await request(app).get(`/api/oauth/google/callback?code=abc&state=${state}`);
      expect(res.headers.location).toBe('/?oauth_error=invalid_state');
      expect(c2_query).not.toHaveBeenCalled();
    });
  });
});
