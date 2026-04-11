import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { c2_query } from '../../mysql_connect.js';
import { mockAuthenticated, mockUnauthenticated, resetMocks, TEST_USER } from '../helpers.js';

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
  });
});
