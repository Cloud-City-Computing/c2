import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../services/user-channel.js', () => ({
  broadcastToUser: vi.fn(),
  setupUserChannelServer: vi.fn(),
  isUserConnected: vi.fn(() => false),
  getConnectedUserCount: vi.fn(() => 0),
}));

import app from '../../app.js';
import { c2_query } from '../../mysql_connect.js';
import { mockAuthenticated, mockUnauthenticated, resetMocks, TEST_USER } from '../helpers.js';

const ADMIN_USER = { ...TEST_USER, is_admin: true };

describe('Activity Routes', () => {
  beforeEach(() => resetMocks());

  describe('GET /api/activity', () => {
    it('returns workspace activity', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ ok: 1 }]) // workspace access gate
        .mockResolvedValueOnce([
          { id: 1, action: 'log.create', resource_type: 'log', resource_id: 42, created_at: '2026-04-01', actor_name: 'Alice' },
        ]);

      const res = await request(app)
        .get('/api/activity?workspace=5&limit=10')
        .set('Authorization', 'Bearer t');

      expect(res.status).toBe(200);
      expect(res.body.results).toHaveLength(1);
    });

    it('rejects users with no workspace access (403)', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]); // workspace access gate denies

      const res = await request(app)
        .get('/api/activity?workspace=999')
        .set('Authorization', 'Bearer t');

      expect(res.status).toBe(403);
    });

    it('includes the readAccessWhere filter for log/archive entries', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ ok: 1 }]) // workspace access gate
        .mockResolvedValueOnce([]);

      await request(app)
        .get('/api/activity?workspace=5')
        .set('Authorization', 'Bearer t');

      // The second call is the activity query
      const sql = c2_query.mock.calls[1][0];
      // Visibility filter should reference logs / archives joins
      expect(sql).toMatch(/EXISTS \(\s*SELECT 1 FROM logs/i);
      expect(sql).toMatch(/EXISTS \(\s*SELECT 1 FROM archives/i);
    });

    it('rejects missing workspace', async () => {
      mockAuthenticated();

      const res = await request(app)
        .get('/api/activity')
        .set('Authorization', 'Bearer t');

      expect(res.status).toBe(400);
    });

    it('rejects invalid workspace id', async () => {
      mockAuthenticated();

      const res = await request(app)
        .get('/api/activity?workspace=abc')
        .set('Authorization', 'Bearer t');

      expect(res.status).toBe(400);
    });

    it('rejects unauthenticated', async () => {
      mockUnauthenticated();

      const res = await request(app)
        .get('/api/activity?workspace=5');

      expect(res.status).toBe(401);
    });

    it('applies the action_prefix filter when provided', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ ok: 1 }]) // workspace access gate
        .mockResolvedValueOnce([]);

      await request(app)
        .get('/api/activity?workspace=5&action_prefix=log')
        .set('Authorization', 'Bearer t');

      const sql = c2_query.mock.calls[1][0];
      expect(sql).toMatch(/action LIKE \?/i);
      const params = c2_query.mock.calls[1][1];
      expect(params).toContain('log%');
    });
  });

  describe('GET /api/activity — depth & edge cases', () => {
    it('admins skip the workspace access gate (no SELECT on workspaces)', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([]); // only the activity query runs

      const res = await request(app)
        .get('/api/activity?workspace=5')
        .set('Authorization', 'Bearer t');

      expect(res.status).toBe(200);
      // First (and only) query should be the activity SELECT, not a workspace check
      expect(c2_query.mock.calls).toHaveLength(1);
      expect(c2_query.mock.calls[0][0]).toMatch(/FROM activity_log/i);
    });

    it('clamps limit > 200 down to 200', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ ok: 1 }])
        .mockResolvedValueOnce([]);

      await request(app)
        .get('/api/activity?workspace=5&limit=999')
        .set('Authorization', 'Bearer t');

      const params = c2_query.mock.calls[1][1];
      expect(params[params.length - 1]).toBe('200');
    });

    it('clamps limit < 1 up to 1', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ ok: 1 }])
        .mockResolvedValueOnce([]);

      await request(app)
        .get('/api/activity?workspace=5&limit=-50')
        .set('Authorization', 'Bearer t');

      const params = c2_query.mock.calls[1][1];
      expect(params[params.length - 1]).toBe('1');
    });

    it('falls back to default limit of 50 when limit is non-numeric', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ ok: 1 }])
        .mockResolvedValueOnce([]);

      await request(app)
        .get('/api/activity?workspace=5&limit=banana')
        .set('Authorization', 'Bearer t');

      const params = c2_query.mock.calls[1][1];
      expect(params[params.length - 1]).toBe('50');
    });

    it('appends `before` cursor to the WHERE clause and params', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ ok: 1 }])
        .mockResolvedValueOnce([]);

      await request(app)
        .get('/api/activity?workspace=5&before=2026-04-01T00:00:00.000Z')
        .set('Authorization', 'Bearer t');

      const sql = c2_query.mock.calls[1][0];
      expect(sql).toMatch(/al\.created_at < \?/i);
      expect(c2_query.mock.calls[1][1]).toContain('2026-04-01T00:00:00.000Z');
    });

    it('silently ignores invalid action_prefix (rejects values that fail regex)', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ ok: 1 }])
        .mockResolvedValueOnce([]);

      await request(app)
        .get('/api/activity?workspace=5&action_prefix=log;DROP%20TABLE')
        .set('Authorization', 'Bearer t');

      // No `action LIKE ?` should appear because the prefix failed validation
      const sql = c2_query.mock.calls[1][0];
      expect(sql).not.toMatch(/action LIKE \?/i);
    });

    it('returns enriched actor_name and actor_avatar fields', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ ok: 1 }])
        .mockResolvedValueOnce([
          { id: 7, action: 'log.create', actor_name: 'Bob', actor_avatar: '/a.webp' },
        ]);

      const res = await request(app)
        .get('/api/activity?workspace=5')
        .set('Authorization', 'Bearer t');

      expect(res.body.results[0]).toMatchObject({
        actor_name: 'Bob',
        actor_avatar: '/a.webp',
      });
    });

    it('always orders results by created_at DESC', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ ok: 1 }])
        .mockResolvedValueOnce([]);

      await request(app)
        .get('/api/activity?workspace=5')
        .set('Authorization', 'Bearer t');

      expect(c2_query.mock.calls[1][0]).toMatch(/ORDER BY al\.created_at DESC/i);
    });
  });

  describe('GET /api/activity/log/:logId', () => {
    it('returns log-scoped activity when user has read access', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 42 }]) // checkLogReadAccess
        .mockResolvedValueOnce([{ id: 1, action: 'log.update', resource_type: 'log', resource_id: 42 }]);

      const res = await request(app)
        .get('/api/activity/log/42')
        .set('Authorization', 'Bearer t');

      expect(res.status).toBe(200);
      expect(res.body.results).toHaveLength(1);
    });

    it('rejects when user has no read access', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]); // checkLogReadAccess returns no rows

      const res = await request(app)
        .get('/api/activity/log/42')
        .set('Authorization', 'Bearer t');

      expect(res.status).toBe(403);
    });

    it('rejects invalid log id', async () => {
      mockAuthenticated();

      const res = await request(app)
        .get('/api/activity/log/abc')
        .set('Authorization', 'Bearer t');

      expect(res.status).toBe(400);
    });

    it('rejects unauthenticated', async () => {
      mockUnauthenticated();
      const res = await request(app).get('/api/activity/log/42');
      expect(res.status).toBe(401);
    });

    it('includes comment and version subqueries by default', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 42 }])
        .mockResolvedValueOnce([]);

      await request(app)
        .get('/api/activity/log/42')
        .set('Authorization', 'Bearer t');

      const sql = c2_query.mock.calls[1][0];
      expect(sql).toMatch(/resource_type = 'comment'/i);
      expect(sql).toMatch(/resource_type = 'version'/i);
    });

    it('omits comment subquery when include_comments=0', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 42 }])
        .mockResolvedValueOnce([]);

      await request(app)
        .get('/api/activity/log/42?include_comments=0')
        .set('Authorization', 'Bearer t');

      const sql = c2_query.mock.calls[1][0];
      expect(sql).not.toMatch(/resource_type = 'comment'/i);
      expect(sql).toMatch(/resource_type = 'version'/i);
    });

    it('omits version subquery when include_versions=0', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 42 }])
        .mockResolvedValueOnce([]);

      await request(app)
        .get('/api/activity/log/42?include_versions=0')
        .set('Authorization', 'Bearer t');

      const sql = c2_query.mock.calls[1][0];
      expect(sql).toMatch(/resource_type = 'comment'/i);
      expect(sql).not.toMatch(/resource_type = 'version'/i);
    });

    it('clamps limit to MAX_LIMIT (200)', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 42 }])
        .mockResolvedValueOnce([]);

      await request(app)
        .get('/api/activity/log/42?limit=10000')
        .set('Authorization', 'Bearer t');

      const params = c2_query.mock.calls[1][1];
      expect(params[params.length - 1]).toBe('200');
    });
  });
});
