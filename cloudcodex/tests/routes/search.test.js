import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
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
  // ── Machine credential (service token) ────────────────────

  describe('service token (machine credential)', () => {
    const SERVICE_TOKEN = 'cloud-command-service-token-00000000';
    const SERVICE_ROW = { id: 9, name: 'cloud-command', email: 'svc@example.com', is_admin: 0 };

    beforeEach(() => {
      process.env.SERVICE_TOKEN = SERVICE_TOKEN;
      process.env.SERVICE_TOKEN_USER = 'svc@example.com';
      // No session row backs this token, so a 200 below can only come from the
      // machine path.
      mockUnauthenticated();
    });

    afterEach(() => {
      delete process.env.SERVICE_TOKEN;
      delete process.env.SERVICE_TOKEN_USER;
    });

    it('is accepted on GET /api/search, as a non-admin principal', async () => {
      c2_query.mockResolvedValueOnce([SERVICE_ROW]);      // principal lookup
      c2_query.mockResolvedValueOnce([{ total: 1 }]);     // count
      c2_query.mockResolvedValueOnce([
        { id: 1, title: 'Runbook', created_at: '2026-01-01', author: 'user', archive_name: 'Proj', html_content: '<p>runbook</p>', char_count: 7 },
      ]);

      const res = await request(app)
        .get('/api/search?query=runbook')
        .set('Authorization', `Bearer ${SERVICE_TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body.results).toHaveLength(1);
      expect(validateAndAutoLogin).not.toHaveBeenCalled();

      // readAccessParams binds is_admin FIRST, then the user id. The count
      // query is [ ...searchParams, ...accessParams ], so the access params
      // start at index 1. This pins the bound principal to the service user
      // and to a non-admin first param; the forced literal `is_admin: false`
      // itself is what tests/services/machine-auth.test.js covers, since a
      // row with is_admin 0 would bind false either way.
      const countParams = c2_query.mock.calls[1][1];
      expect(countParams[1]).toBe(false);
      expect(countParams[2]).toBe('9');
      expect(countParams[3]).toBe(9);
    });

    it('is accepted on GET /api/browse, as a non-admin principal', async () => {
      c2_query.mockResolvedValueOnce([SERVICE_ROW]);      // principal lookup
      c2_query.mockResolvedValueOnce([{ total: 1 }]);     // count
      c2_query.mockResolvedValueOnce([
        { id: 1, title: 'Log One', created_at: '2026-01-01', author: 'user', archive_name: 'Proj', excerpt: 'Hello', char_count: 5 },
      ]);

      const res = await request(app)
        .get('/api/browse')
        .set('Authorization', `Bearer ${SERVICE_TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body.results).toHaveLength(1);
      expect(validateAndAutoLogin).not.toHaveBeenCalled();

      // Browse has no search params, so the access params start at index 0.
      const countParams = c2_query.mock.calls[1][1];
      expect(countParams[0]).toBe(false);
      expect(countParams[1]).toBe('9');
    });

    it('is rejected with 401 on GET /api/search/filters', async () => {
      // Queued deliberately, and unused by the passing path. Without it this
      // test is a false green: the principal lookup would find no row, so the
      // credential would be refused even if the route HAD been widened to
      // machineOrAuth, and the 401 would prove nothing. With the row queued, a
      // widened route authenticates and answers 200, and this fails.
      c2_query.mockResolvedValueOnce([SERVICE_ROW]);

      const res = await request(app)
        .get('/api/search/filters')
        .set('Authorization', `Bearer ${SERVICE_TOKEN}`);

      // The scope is a scope: /api/search/filters keeps bare requireAuth, so
      // the machine credential is just an unknown session token there.
      expect(res.status).toBe(401);
      expect(validateAndAutoLogin).toHaveBeenCalledWith(SERVICE_TOKEN);
    });

    it('is rejected with 401 on GET /api/presence', async () => {
      // Queued for the same reason as the filters test above.
      c2_query.mockResolvedValueOnce([SERVICE_ROW]);

      const res = await request(app)
        .get('/api/presence')
        .set('Authorization', `Bearer ${SERVICE_TOKEN}`);

      expect(res.status).toBe(401);
      expect(validateAndAutoLogin).toHaveBeenCalledWith(SERVICE_TOKEN);
    });

    it('does not authenticate a token that is merely close to the service token', async () => {
      const res = await request(app)
        .get('/api/browse')
        .set('Authorization', `Bearer ${SERVICE_TOKEN}x`);

      expect(res.status).toBe(401);
      expect(validateAndAutoLogin).toHaveBeenCalledWith(`${SERVICE_TOKEN}x`);
    });

    it('still accepts an ordinary session token on the machine-enabled routes', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ total: 0 }]);
      c2_query.mockResolvedValueOnce([]);

      const browse = await request(app)
        .get('/api/browse')
        .set('Authorization', 'Bearer valid-token');

      expect(browse.status).toBe(200);
      // The session user, not the service principal.
      expect(c2_query.mock.calls[0][1][1]).toBe(String(TEST_USER.id));

      c2_query.mockResolvedValueOnce([{ total: 0 }]);
      c2_query.mockResolvedValueOnce([]);
      const search = await request(app)
        .get('/api/search?query=anything')
        .set('Authorization', 'Bearer valid-token');

      expect(search.status).toBe(200);
    });

    it('leaves the routes on session auth when the service token is unconfigured', async () => {
      delete process.env.SERVICE_TOKEN;
      delete process.env.SERVICE_TOKEN_USER;

      const res = await request(app)
        .get('/api/browse')
        .set('Authorization', `Bearer ${SERVICE_TOKEN}`);

      expect(res.status).toBe(401);
      expect(c2_query).not.toHaveBeenCalled();
    });
  });
});
