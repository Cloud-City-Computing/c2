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
import { mockAuthenticated, mockUnauthenticated, resetMocks } from '../helpers.js';

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
  });
});
