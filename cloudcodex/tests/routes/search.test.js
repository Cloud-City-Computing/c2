import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { c2_query } from '../../mysql_connect.js';
import { getAllPresence } from '../../services/collab.js';
import { mockAuthenticated, mockUnauthenticated, resetMocks, TEST_USER } from '../helpers.js';

vi.mock('../../services/collab.js', () => ({
  getAllPresence: vi.fn(() => ({})),
}));

describe('Search Routes', () => {
  beforeEach(() => {
    resetMocks();
    getAllPresence.mockReset().mockReturnValue({});
  });

  describe('GET /api/search', () => {
    it('returns matching results', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ total: 1 }]);
      c2_query.mockResolvedValueOnce([
        { id: 1, title: 'Getting Started', created_at: '2026-01-01', author: 'user', archive_name: 'Proj', html_content: '<p>Welcome to getting started</p>', char_count: 30 },
      ]);

      const res = await request(app)
        .get('/api/search?query=getting')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.results).toHaveLength(1);
      expect(res.body.results[0].title).toBe('Getting Started');
    });

    it('returns empty for blank query', async () => {
      mockAuthenticated();

      const res = await request(app)
        .get('/api/search?query=')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.results).toEqual([]);
    });

    it('rejects query over 100 chars', async () => {
      mockAuthenticated();

      const longQuery = 'a'.repeat(101);
      const res = await request(app)
        .get(`/api/search?query=${longQuery}`)
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/100 characters/);
    });

    it('respects limit parameter', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ total: 0 }]);
      c2_query.mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/api/search?query=test&limit=5')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      // The second call is the results query — limit is passed as a param
      const queryCall = c2_query.mock.calls[1];
      expect(queryCall[1]).toContain('5'); // limit param
    });

    it('caps limit at 48', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ total: 0 }]);
      c2_query.mockResolvedValueOnce([]);

      await request(app)
        .get('/api/search?query=test&limit=50')
        .set('Authorization', 'Bearer valid-token');

      // The second call is the results query — limit is capped at MAX_BROWSE_LIMIT (48)
      const queryCall = c2_query.mock.calls[1];
      expect(queryCall[1]).toContain('48');
    });

    it('requires authentication', async () => {
      mockUnauthenticated();

      const res = await request(app)
        .get('/api/search?query=test')
        .set('Authorization', 'Bearer bad');

      expect(res.status).toBe(401);
    });
  });

  // ── GET /api/browse ───────────────────────────────────────

  describe('GET /api/browse', () => {
    it('returns paginated results', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ total: 2 }]);
      c2_query.mockResolvedValueOnce([
        { id: 1, title: 'Log One', created_at: '2026-01-01', author: 'user', archive_name: 'Proj', excerpt: 'Hello', char_count: 100 },
        { id: 2, title: 'Log Two', created_at: '2026-01-02', author: 'user', archive_name: 'Proj', excerpt: 'World', char_count: 200 },
      ]);

      const res = await request(app)
        .get('/api/browse?page=1&limit=12')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.results).toHaveLength(2);
      expect(res.body.total).toBe(2);
      expect(res.body.page).toBe(1);
      expect(res.body.totalPages).toBe(1);
    });

    it('accepts sort parameter', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ total: 0 }]);
      c2_query.mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/api/browse?sort=title')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
    });

    it('defaults to newest sort for unknown sort value', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ total: 0 }]);
      c2_query.mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/api/browse?sort=invalid')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
    });

    it('requires authentication', async () => {
      mockUnauthenticated();

      const res = await request(app)
        .get('/api/browse')
        .set('Authorization', 'Bearer bad');

      expect(res.status).toBe(401);
    });
  });

  // ── GET /api/presence ─────────────────────────────────────

  describe('GET /api/presence', () => {
    it('returns empty presence when no editors', async () => {
      mockAuthenticated();
      getAllPresence.mockReturnValue({});

      const res = await request(app)
        .get('/api/presence')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.presence).toEqual({});
    });

    it('returns presence filtered by read access', async () => {
      mockAuthenticated();
      getAllPresence.mockReturnValue({
        '10': [{ id: 2, name: 'other', color: '#ff0000' }],
        '20': [{ id: 3, name: 'hidden', color: '#00ff00' }],
      });
      // Accessible logs query returns only log 10
      c2_query.mockResolvedValueOnce([{ id: 10 }]);

      const res = await request(app)
        .get('/api/presence')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.presence).toHaveProperty('10');
      expect(res.body.presence).not.toHaveProperty('20');
    });

    it('requires authentication', async () => {
      mockUnauthenticated();

      const res = await request(app)
        .get('/api/presence')
        .set('Authorization', 'Bearer bad');

      expect(res.status).toBe(401);
    });
  });
});
