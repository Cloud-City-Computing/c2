import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { c2_query } from '../../mysql_connect.js';
import { mockAuthenticated, mockUnauthenticated, resetMocks, TEST_USER } from '../helpers.js';

describe('Favorites Routes', () => {
  beforeEach(() => {
    resetMocks();
  });

  // --- GET /api/favorites ---

  describe('GET /api/favorites', () => {
    it('returns paginated favorites for authenticated user', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([
          { id: 10, title: 'My Doc', created_at: '2026-01-01', archive_id: 1, author: 'alice', archive_name: 'Proj', excerpt: 'Hello...', char_count: 500, favorited_at: '2026-03-01' },
        ]);

      const res = await request(app)
        .get('/api/favorites?page=1&limit=6')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.results).toHaveLength(1);
      expect(res.body.results[0].title).toBe('My Doc');
      expect(res.body.total).toBe(1);
      expect(res.body.page).toBe(1);
    });

    it('returns empty list when user has no favorites', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ total: 0 }])
        .mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/api/favorites')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.results).toHaveLength(0);
      expect(res.body.total).toBe(0);
    });

    it('rejects unauthenticated request', async () => {
      mockUnauthenticated();

      const res = await request(app)
        .get('/api/favorites');

      expect(res.status).toBe(401);
    });
  });

  // --- GET /api/favorites/check ---

  describe('GET /api/favorites/check', () => {
    it('returns true when log is favorited', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ id: 1 }]);

      const res = await request(app)
        .get('/api/favorites/check?logId=10')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.favorited).toBe(true);
    });

    it('returns false when log is not favorited', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/api/favorites/check?logId=10')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.favorited).toBe(false);
    });

    it('rejects missing logId', async () => {
      mockAuthenticated();

      const res = await request(app)
        .get('/api/favorites/check')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });

    it('rejects invalid logId', async () => {
      mockAuthenticated();

      const res = await request(app)
        .get('/api/favorites/check?logId=abc')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });
  });

  // --- POST /api/favorites ---

  describe('POST /api/favorites', () => {
    it('adds a favorite for an accessible log', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 10 }])  // readAccessWhere check
        .mockResolvedValueOnce({ affectedRows: 1 }); // INSERT

      const res = await request(app)
        .post('/api/favorites')
        .set('Authorization', 'Bearer valid-token')
        .send({ logId: 10 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects when user has no read access to log', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]); // no access

      const res = await request(app)
        .post('/api/favorites')
        .set('Authorization', 'Bearer valid-token')
        .send({ logId: 10 });

      expect(res.status).toBe(403);
    });

    it('rejects missing logId', async () => {
      mockAuthenticated();

      const res = await request(app)
        .post('/api/favorites')
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(res.status).toBe(400);
    });

    it('rejects invalid logId', async () => {
      mockAuthenticated();

      const res = await request(app)
        .post('/api/favorites')
        .set('Authorization', 'Bearer valid-token')
        .send({ logId: 'abc' });

      expect(res.status).toBe(400);
    });

    it('handles duplicate favorite gracefully (INSERT IGNORE)', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 10 }])  // access check
        .mockResolvedValueOnce({ affectedRows: 0 }); // already exists

      const res = await request(app)
        .post('/api/favorites')
        .set('Authorization', 'Bearer valid-token')
        .send({ logId: 10 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // --- DELETE /api/favorites/:logId ---

  describe('DELETE /api/favorites/:logId', () => {
    it('removes a favorite', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce({ affectedRows: 1 });

      const res = await request(app)
        .delete('/api/favorites/10')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns success even when favorite did not exist', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce({ affectedRows: 0 });

      const res = await request(app)
        .delete('/api/favorites/10')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects invalid logId', async () => {
      mockAuthenticated();

      const res = await request(app)
        .delete('/api/favorites/abc')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });

    it('rejects unauthenticated request', async () => {
      mockUnauthenticated();

      const res = await request(app)
        .delete('/api/favorites/10');

      expect(res.status).toBe(401);
    });
  });
});
