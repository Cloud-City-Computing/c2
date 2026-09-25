/**
 * GitHub linking when another GitHub account links the same user first
 *
 * The callback asks whether this user already has a GitHub row, updates it if
 * so, and otherwise inserts one. Two different GitHub accounts linking one
 * user at the same instant both find no row and both insert; UNIQUE (user_id,
 * provider) refuses the second (docs/maps/open-questions.md C7). The loser is
 * redirected with a named refusal, like every other refusal this callback
 * makes, instead of reaching errorHandler as a 500. Any other duplicate still
 * reaches errorHandler.
 *
 * The provider env must exist before routes/oauth.js loads (it reads the client
 * ids at import time), hence vi.hoisted.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.hoisted(() => {
  process.env.GITHUB_CLIENT_ID = 'test-github-client-id';
  process.env.GITHUB_CLIENT_SECRET = 'test-github-client-secret-0123456789';
});

import request from 'supertest';
import app from '../../app.js';
import { c2_query } from '../../mysql_connect.js';
import { mockAuthenticated, resetMocks, TEST_USER } from '../helpers.js';

const GITHUB_ID = 4242;

const OWN_ROW_LOOKUP_SQL = `SELECT id FROM oauth_accounts WHERE provider = 'github' AND user_id = ? LIMIT 1`;
const OTHER_USER_LOOKUP_SQL = `SELECT user_id FROM oauth_accounts WHERE provider = 'github' AND provider_user_id = ? LIMIT 1`;
const LINK_INSERT_SQL =
  "INSERT INTO oauth_accounts (user_id, provider, provider_user_id, provider_email, provider_username, provider_avatar_url, encrypted_token, token_status) VALUES (?, 'github', ?, ?, ?, ?, ?, 'active')";

/**
 * The error mysql2 raises when an INSERT hits a unique key, as measured on
 * MySQL 8.4.11 (tests/integration/oauth-one-link-per-provider.test.js pins the
 * same shape against a real server).
 */
function duplicateKeyError(entry, key) {
  const message = `Duplicate entry '${entry}' for key '${key}'`;
  return Object.assign(new Error(message), {
    code: 'ER_DUP_ENTRY',
    errno: 1062,
    sqlState: '23000',
    sqlMessage: message,
  });
}

function githubFetchMock() {
  return vi.fn(async (url) => {
    const u = String(url);
    if (u.startsWith('https://github.com/login/oauth/access_token')) {
      return { ok: true, json: async () => ({ access_token: 'gho_second_token' }) };
    }
    if (u === 'https://api.github.com/user') {
      return {
        ok: true,
        json: async () => ({ id: GITHUB_ID, login: 'second', avatar_url: null, email: 'second@example.com' }),
      };
    }
    return { ok: true, json: async () => [] };
  });
}

/** Start a GitHub link as TEST_USER and return the state and the cookie that browser holds. */
async function startGithubLink() {
  mockAuthenticated(TEST_USER);
  const res = await request(app).get('/api/oauth/github').set('Authorization', 'Bearer valid-token');
  expect(res.status).toBe(302);
  const state = new URL(res.headers.location).searchParams.get('state');
  return { state, cookie: `oauth_state_github=${state}` };
}

/** Normalises whitespace so a multi-line template literal compares by content. */
const squash = sql => sql.replace(/\s+/g, ' ').trim();

/** Queue the callback's two lookups (both empty), then the INSERT's outcome. */
function queueLookupsThenInsert(insertOutcome) {
  c2_query.mockResolvedValueOnce([]); // this user has no GitHub row yet
  c2_query.mockResolvedValueOnce([]); // this GitHub account is linked to nobody
  c2_query.mockRejectedValueOnce(insertOutcome); // ...and then the INSERT
}

describe('GitHub linking when another link for this user lands first (C7)', () => {
  beforeEach(() => {
    resetMocks();
    vi.stubGlobal('fetch', githubFetchMock());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('redirects the race loser to github_error=link_conflict instead of a 500', async () => {
    const { state, cookie } = await startGithubLink();
    c2_query.mockClear();
    queueLookupsThenInsert(duplicateKeyError(`${TEST_USER.id}-github`, 'oauth_accounts.uq_oauth_user_provider'));

    const res = await request(app)
      .get(`/api/oauth/github/callback?code=good-code&state=${state}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/account?github_error=link_conflict');
    expect(c2_query.mock.calls.map(([sql, params]) => [squash(sql), params])).toEqual([
      [OWN_ROW_LOOKUP_SQL, [TEST_USER.id]],
      [OTHER_USER_LOOKUP_SQL, [String(GITHUB_ID)]],
      [LINK_INSERT_SQL, [TEST_USER.id, String(GITHUB_ID), 'second@example.com', 'second', null, expect.any(String)]],
    ]);
  });

  // The subject key is the same GitHub account racing itself, which is not
  // this race; it reaches errorHandler exactly as it always has.
  it('still answers a duplicate on the subject key, uq_provider_user, with a 500', async () => {
    const { state, cookie } = await startGithubLink();
    queueLookupsThenInsert(duplicateKeyError(`github-${GITHUB_ID}`, 'oauth_accounts.uq_provider_user'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app)
      .get(`/api/oauth/github/callback?code=good-code&state=${state}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(500);
    consoleError.mockRestore();
  });

  it('still answers any other INSERT failure with a 500', async () => {
    const { state, cookie } = await startGithubLink();
    queueLookupsThenInsert(new Error('connection lost'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app)
      .get(`/api/oauth/github/callback?code=good-code&state=${state}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(500);
    consoleError.mockRestore();
  });
});
