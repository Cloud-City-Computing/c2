import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { c2_query } from '../../mysql_connect.js';
import { mockAuthenticated, mockUnauthenticated, resetMocks, TEST_USER } from '../helpers.js';

describe('Search Routes', () => {
  beforeEach(() => {
    resetMocks();
  });

  describe('GET /api/search', () => {
    it('returns matching results', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([
        { id: 1, title: 'Getting Started', created_at: '2026-01-01', author: 'user', project_name: 'Proj', excerpt: 'Welcome...' },
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
      c2_query.mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/api/search?query=test&limit=5')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      // Verify the limit was passed to the query
      const queryCall = c2_query.mock.calls[0];
      expect(queryCall[1]).toContain('5'); // limit param
    });

    it('caps limit at 10', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]);

      await request(app)
        .get('/api/search?query=test&limit=50')
        .set('Authorization', 'Bearer valid-token');

      const queryCall = c2_query.mock.calls[0];
      expect(queryCall[1]).toContain('10'); // capped at RESULTS_LIMIT
    });

    it('requires authentication', async () => {
      mockUnauthenticated();

      const res = await request(app)
        .get('/api/search?query=test')
        .set('Authorization', 'Bearer bad');

      expect(res.status).toBe(401);
    });
  });
});
