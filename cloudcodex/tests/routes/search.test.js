import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import http from 'node:http';
import https from 'node:https';
import app from '../../app.js';
import { c2_query, validateAndAutoLogin } from '../../mysql_connect.js';
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
      // Browse is an archive-as-a-place surface, so hidden `system` archives
      // (GitHub PR sessions, which ordinary users now hold grants on) must be
      // excluded from both the count and the result query.
      expect(c2_query.mock.calls[0][0]).toMatch(/COALESCE\(pr\.`system`, FALSE\)/);
      expect(c2_query.mock.calls[1][0]).toMatch(/COALESCE\(pr\.`system`, FALSE\)/);
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
  // ── The machine credential is gone (CDX-SA-3) ─────────────

  describe('a former service token is an unknown session token', () => {
    const SERVICE_TOKEN = 'sibling-service-token-00000000';
    const SERVICE_ROW = { id: 9, name: 'sibling-service', email: 'svc@example.com', is_admin: 0 };

    beforeEach(() => {
      process.env.SERVICE_TOKEN = SERVICE_TOKEN;
      process.env.SERVICE_TOKEN_USER = 'svc@example.com';
      // No session row backs this token, so nothing may answer 200 for it.
      mockUnauthenticated();
    });

    afterEach(() => {
      delete process.env.SERVICE_TOKEN;
      delete process.env.SERVICE_TOKEN_USER;
    });

    it.each(['/api/search?query=runbook', '/api/browse'])(
      'is refused with 401 on %s, and looked up as a session',
      async (url) => {
        c2_query.mockResolvedValueOnce([SERVICE_ROW]); // would be the principal lookup, if it still existed
        const res = await request(app).get(url).set('Authorization', `Bearer ${SERVICE_TOKEN}`);

        expect(res.status).toBe(401);
        expect(validateAndAutoLogin).toHaveBeenCalledWith(SERVICE_TOKEN);
        expect(c2_query.mock.calls.some(([sql]) => /FROM users/.test(sql) && /email/.test(sql))).toBe(false);
      }
    );

    it('makes no outbound request for a JWS-shaped bearer on search and browse', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const httpsSpy = vi.spyOn(https, 'request');
      const httpSpy = vi.spyOn(http, 'request');
      try {
        for (const url of ['/api/search?query=runbook', '/api/browse']) {
          const res = await request(app).get(url).set('Authorization', 'Bearer aaa.bbb.ccc');
          expect(res.status).toBe(401);
        }
        // Supertest calls http.request against its own loopback server, so only a call that leaves
        // loopback is an outbound request.
        const leavesLoopback = ([target]) => {
          const host = typeof target === 'string' ? new URL(target).hostname : (target?.hostname ?? target?.host);
          return Boolean(host) && !['127.0.0.1', 'localhost', '::1'].includes(host);
        };
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(httpsSpy.mock.calls.filter(leavesLoopback)).toEqual([]);
        expect(httpSpy.mock.calls.filter(leavesLoopback)).toEqual([]);
      } finally {
        fetchSpy.mockRestore();
        httpsSpy.mockRestore();
        httpSpy.mockRestore();
      }
    });

    it('answers a mocked session on search and browse exactly as before', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ total: 0 }]);
      c2_query.mockResolvedValueOnce([]);
      const browse = await request(app).get('/api/browse').set('Authorization', 'Bearer valid-token');
      expect(browse.status).toBe(200);
      expect(c2_query.mock.calls[0][1][1]).toBe(String(TEST_USER.id));
    });
  });
});
