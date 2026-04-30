import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { c2_query } from '../../mysql_connect.js';
import { mockAuthenticated, mockUnauthenticated, resetMocks } from '../helpers.js';

describe('OAuth Routes', () => {
  beforeEach(() => {
    resetMocks();
  });

  // --- GET /api/oauth/providers ---

  describe('GET /api/oauth/providers', () => {
    it('returns provider availability', async () => {
      const res = await request(app).get('/api/oauth/providers');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.providers).toBeDefined();
      expect(typeof res.body.providers.google).toBe('boolean');
      expect(typeof res.body.providers.github).toBe('boolean');
    });
  });

  // --- GET /api/oauth/status ---

  describe('GET /api/oauth/status', () => {
    it('returns linked accounts for authenticated user', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([
        { provider: 'google', provider_email: 'user@google.com', created_at: '2026-01-01' },
      ]);
      c2_query.mockResolvedValueOnce([{ password_hash: 'hashed' }]);

      const res = await request(app)
        .get('/api/oauth/status')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.accounts).toHaveLength(1);
      expect(res.body.accounts[0].provider).toBe('google');
      expect(res.body.hasPassword).toBe(true);
    });

    it('returns hasPassword false when no password set', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]);
      c2_query.mockResolvedValueOnce([{ password_hash: null }]);

      const res = await request(app)
        .get('/api/oauth/status')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.hasPassword).toBe(false);
    });

    it('requires authentication', async () => {
      mockUnauthenticated();
      const res = await request(app).get('/api/oauth/status');
      expect(res.status).toBe(401);
    });
  });

  // --- POST /api/oauth/google/unlink ---

  describe('POST /api/oauth/google/unlink', () => {
    it('unlinks Google account when user has password', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ password_hash: 'hashed' }]); // has password
      c2_query.mockResolvedValueOnce({ affectedRows: 1 }); // delete oauth

      const res = await request(app)
        .post('/api/oauth/google/unlink')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects when user has no password', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ password_hash: null }]); // no password

      const res = await request(app)
        .post('/api/oauth/google/unlink')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/must set a password/);
    });

    it('requires authentication', async () => {
      mockUnauthenticated();
      const res = await request(app).post('/api/oauth/google/unlink');
      expect(res.status).toBe(401);
    });
  });

  // --- POST /api/oauth/github/unlink ---

  describe('POST /api/oauth/github/unlink', () => {
    it('unlinks GitHub account when user has password', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ password_hash: 'hashed' }]); // has password
      c2_query.mockResolvedValueOnce([{ id: 1 }]); // other provider exists (or not needed)
      c2_query.mockResolvedValueOnce([{ encrypted_token: null }]); // no token to revoke
      c2_query.mockResolvedValueOnce({ affectedRows: 1 }); // delete oauth

      const res = await request(app)
        .post('/api/oauth/github/unlink')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects when no password and no other OAuth providers', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ password_hash: null }]); // no password
      c2_query.mockResolvedValueOnce([]); // no other providers

      const res = await request(app)
        .post('/api/oauth/github/unlink')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/must set a password|another login method/);
    });

    it('requires authentication', async () => {
      mockUnauthenticated();
      const res = await request(app).post('/api/oauth/github/unlink');
      expect(res.status).toBe(401);
    });
  });

  // --- GET /api/github/status ---

  describe('GET /api/github/status', () => {
    it('returns connected status when GitHub is linked', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ provider_email: 'ghuser@github.com', provider_user_id: '12345' }]);

      const res = await request(app)
        .get('/api/github/status')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.connected).toBe(true);
      expect(res.body.githubId).toBe('12345');
    });

    it('returns not connected when GitHub is not linked', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]); // no account

      const res = await request(app)
        .get('/api/github/status')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.connected).toBe(false);
    });

    it('requires authentication', async () => {
      mockUnauthenticated();
      const res = await request(app).get('/api/github/status');
      expect(res.status).toBe(401);
    });

    it('exposes login, avatar_url, token_status, and needs_reconnect', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{
        provider_email: 'gh@x.com',
        provider_user_id: '777',
        provider_username: 'octocat',
        provider_avatar_url: 'https://gh/a.png',
        token_status: 'revoked',
      }]);

      const res = await request(app)
        .get('/api/github/status')
        .set('Authorization', 'Bearer t');

      expect(res.body).toMatchObject({
        connected: true,
        login: 'octocat',
        avatar_url: 'https://gh/a.png',
        token_status: 'revoked',
        needs_reconnect: true,
      });
    });

    it('returns nulls and needs_reconnect=false when not connected', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/api/github/status')
        .set('Authorization', 'Bearer t');

      expect(res.body).toMatchObject({
        connected: false,
        login: null,
        avatar_url: null,
        token_status: null,
        needs_reconnect: false,
      });
    });
  });

  // --- OAuth callback error paths (Google) ---

  describe('GET /api/oauth/google/callback — error redirects', () => {
    it('redirects with oauth_error when provider passes error param', async () => {
      const res = await request(app).get('/api/oauth/google/callback?error=access_denied');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/?oauth_error=access_denied');
    });

    it('redirects with missing_params when code is absent', async () => {
      const res = await request(app).get('/api/oauth/google/callback?state=anything');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/?oauth_error=missing_params');
    });

    it('redirects with missing_params when state is absent', async () => {
      const res = await request(app).get('/api/oauth/google/callback?code=abc');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/?oauth_error=missing_params');
    });

    it('redirects with invalid_state when state is unknown', async () => {
      const res = await request(app).get('/api/oauth/google/callback?code=abc&state=never-issued');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/?oauth_error=invalid_state');
    });
  });

  // --- OAuth callback error paths (GitHub) ---

  describe('GET /api/oauth/github/callback — error redirects', () => {
    it('redirects with github_error=access_denied when provider passes error', async () => {
      const res = await request(app).get('/api/oauth/github/callback?error=access_denied');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/account?github_error=access_denied');
    });

    it('redirects with missing_params when code is absent', async () => {
      const res = await request(app).get('/api/oauth/github/callback?state=anything');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/account?github_error=missing_params');
    });

    it('redirects with invalid_state when state is unknown', async () => {
      const res = await request(app).get('/api/oauth/github/callback?code=abc&state=bogus');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/account?github_error=invalid_state');
    });
  });

  // --- OAuth initiation guards ---

  describe('GET /api/oauth/github (initiation)', () => {
    it('requires authentication', async () => {
      mockUnauthenticated();
      const res = await request(app).get('/api/oauth/github');
      expect(res.status).toBe(401);
    });
  });

  // --- Token encryption ---

  describe('encryptToken / decryptToken', () => {
    it('returns null when GITHUB_CLIENT_SECRET is unset', async () => {
      const original = process.env.GITHUB_CLIENT_SECRET;
      delete process.env.GITHUB_CLIENT_SECRET;
      try {
        const { encryptToken, decryptToken } = await import('../../routes/oauth.js?token-test-1');
        expect(encryptToken('hello')).toBeNull();
        expect(decryptToken('iv:tag:cipher')).toBeNull();
      } finally {
        if (original !== undefined) process.env.GITHUB_CLIENT_SECRET = original;
      }
    });

    it('round-trips a token when GITHUB_CLIENT_SECRET is set', async () => {
      const original = process.env.GITHUB_CLIENT_SECRET;
      process.env.GITHUB_CLIENT_SECRET = 'unit-test-secret-with-enough-entropy';
      try {
        // Re-import with a different query to bypass module cache so the
        // new env value is picked up.
        const { encryptToken, decryptToken } = await import('../../routes/oauth.js?token-test-2');
        const plaintext = 'gho_abc123secrettokenvalue';
        const stored = encryptToken(plaintext);
        expect(stored).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
        expect(decryptToken(stored)).toBe(plaintext);
      } finally {
        if (original === undefined) delete process.env.GITHUB_CLIENT_SECRET;
        else process.env.GITHUB_CLIENT_SECRET = original;
      }
    });

    it('decryptToken returns null for malformed input', async () => {
      const original = process.env.GITHUB_CLIENT_SECRET;
      process.env.GITHUB_CLIENT_SECRET = 'unit-test-secret-with-enough-entropy';
      try {
        const { decryptToken } = await import('../../routes/oauth.js?token-test-3');
        expect(decryptToken(null)).toBeNull();
        expect(decryptToken('')).toBeNull();
        expect(decryptToken('only-one-segment')).toBeNull();
        expect(decryptToken('only:two')).toBeNull();
      } finally {
        if (original === undefined) delete process.env.GITHUB_CLIENT_SECRET;
        else process.env.GITHUB_CLIENT_SECRET = original;
      }
    });
  });

  // --- Provider availability flag ---

  describe('GET /api/oauth/providers — env-driven flags', () => {
    it('reflects current configuration of both providers', async () => {
      const res = await request(app).get('/api/oauth/providers');
      expect(res.body.providers.google).toBe(
        Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
      );
      expect(res.body.providers.github).toBe(
        Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET)
      );
    });
  });
});
