/**
 * Tests for the Google callback's hand-off to services/identity.js, with GOOGLE_OAUTH_DOMAIN set
 *
 * A separate file from oauth-google-seam.test.js because routes/oauth.js reads
 * GOOGLE_OAUTH_DOMAIN at import time. With a domain set, the route's policy
 * must require that hosted domain and auto-create members of it, exactly as
 * the inline ladder did.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const google = vi.hoisted(() => {
  process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
  process.env.GOOGLE_OAUTH_DOMAIN = 'example.com';
  return { getToken: vi.fn(), verifyIdToken: vi.fn(), authUrlOptions: [] };
});

vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    generateAuthUrl(options) {
      google.authUrlOptions.push(options);
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

function payload(overrides = {}) {
  return {
    sub: 'google-sub-2',
    email: 'grace@example.com',
    email_verified: true,
    hd: 'example.com',
    picture: 'https://example.com/grace.png',
    ...overrides,
  };
}

async function signIn(idTokenPayload) {
  google.getToken.mockResolvedValueOnce({ tokens: { id_token: 'id-token' } });
  google.verifyIdToken.mockResolvedValueOnce({ getPayload: () => idTokenPayload });
  const start = await request(app).get('/api/oauth/google');
  const state = new URL(start.headers.location).searchParams.get('state');
  return request(app)
    .get(`/api/oauth/google/callback?code=good-code&state=${state}`)
    .set('Cookie', `${GOOGLE_COOKIE}=${state}`);
}

const writes = () => c2_query.mock.calls.filter(([sql]) => /^\s*(INSERT|UPDATE|DELETE)/i.test(sql));

describe('Google callback through the identity seam (GOOGLE_OAUTH_DOMAIN set)', () => {
  beforeEach(() => {
    resetMocks();
    google.getToken.mockReset();
    google.verifyIdToken.mockReset();
    google.authUrlOptions.length = 0;
  });

  it('still asks Google for the hosted domain on initiation', async () => {
    await request(app).get('/api/oauth/google');
    expect(google.authUrlOptions[0]).toMatchObject({ hd: 'example.com' });
  });

  it('refuses another hosted domain as domain_not_allowed, before any query', async () => {
    const res = await signIn(payload({ hd: 'elsewhere.com' }));

    expect(res.headers.location).toBe('/?oauth_error=domain_not_allowed');
    expect(c2_query).not.toHaveBeenCalled();
  });

  it('auto-creates a member of the domain, then signs them in', async () => {
    c2_query.mockResolvedValueOnce([]); // no link
    c2_query.mockResolvedValueOnce([]); // no user by email
    c2_query.mockResolvedValueOnce([]); // username free
    c2_query.mockResolvedValueOnce({ insertId: 88 }); // user
    c2_query.mockResolvedValueOnce({ affectedRows: 1 }); // permissions
    c2_query.mockResolvedValueOnce({ insertId: 4 }); // link
    c2_query.mockResolvedValueOnce([{ id: 88, name: 'grace', avatar_url: null, is_admin: 0 }]);

    const res = await signIn(payload());

    expect(res.headers.location).toBe('/');
    const inserts = writes().map(([sql, params]) => [sql.replace(/\s+/g, ' ').trim().split(' (')[0], params]);
    expect(inserts).toEqual([
      ['INSERT INTO users', ['grace', 'grace@example.com', 'https://example.com/grace.png']],
      ['INSERT INTO permissions', [88]],
      ['INSERT INTO oauth_accounts', [88, 'google-sub-2', 'grace@example.com']],
    ]);
    expect(c2_query.mock.calls[6][1]).toEqual([88]);
  });
});
