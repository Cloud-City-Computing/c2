import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../services/user-channel.js', () => ({
  broadcastToUser: vi.fn(),
  isUserConnected: vi.fn(() => false),
  getConnectedUserCount: vi.fn(() => 0),
  setupUserChannelServer: vi.fn(),
}));

import app from '../../app.js';
import { c2_query } from '../../mysql_connect.js';
import { mockAuthenticated, mockUnauthenticated, resetMocks } from '../helpers.js';

describe('Notifications Routes', () => {
  beforeEach(() => {
    resetMocks();
  });

  describe('GET /api/notifications', () => {
    it('returns the user\'s notifications', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([
        { id: 1, type: 'mention', title: 'x', read_at: null, created_at: '2026-04-01' },
      ]);

      const res = await request(app)
        .get('/api/notifications?limit=10')
        .set('Authorization', 'Bearer t');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.results).toHaveLength(1);
    });

    it('passes unread filter', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/api/notifications?unread=1')
        .set('Authorization', 'Bearer t');

      expect(res.status).toBe(200);
      const sql = c2_query.mock.calls[0][0];
      expect(sql).toMatch(/read_at IS NULL/i);
    });

    it('rejects unauthenticated request', async () => {
      mockUnauthenticated();
      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/notifications/unread-count', () => {
    it('returns the count', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ unread: 4 }]);

      const res = await request(app)
        .get('/api/notifications/unread-count')
        .set('Authorization', 'Bearer t');

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(4);
    });
  });

  describe('POST /api/notifications/:id/read', () => {
    it('marks a notification read', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce({ affectedRows: 1 });

      const res = await request(app)
        .post('/api/notifications/7/read')
        .set('Authorization', 'Bearer t');

      expect(res.status).toBe(200);
      // Confirm the SQL is scoped to user_id (cannot cross-mark)
      const params = c2_query.mock.calls[0][1];
      expect(params).toContain(7);
      expect(params).toContain(1); // TEST_USER.id
    });

    it('rejects invalid id', async () => {
      mockAuthenticated();
      const res = await request(app)
        .post('/api/notifications/abc/read')
        .set('Authorization', 'Bearer t');
      expect(res.status).toBe(400);
    });

    it('cannot mark another user\'s notification read — SQL is scoped to user_id', async () => {
      // Even if attacker passes a valid notification ID belonging to user 99,
      // the UPDATE WHERE clause includes "user_id = req.user.id" so it
      // never affects another user's row.
      mockAuthenticated(); // TEST_USER.id = 1
      c2_query.mockResolvedValueOnce({ affectedRows: 0 }); // no row matched

      const res = await request(app)
        .post('/api/notifications/12345/read')
        .set('Authorization', 'Bearer t');

      expect(res.status).toBe(200); // route doesn't leak existence info
      const sql = c2_query.mock.calls[0][0];
      const params = c2_query.mock.calls[0][1];
      expect(sql).toMatch(/user_id\s*=\s*\?/i);
      expect(params).toContain(1); // current user
      expect(params).toContain(12345);
    });
  });

  describe('GET /api/notifications scoping', () => {
    it('SELECT is scoped to current user_id, never another\'s', async () => {
      mockAuthenticated(); // user 1
      c2_query.mockResolvedValueOnce([]);

      await request(app)
        .get('/api/notifications')
        .set('Authorization', 'Bearer t');

      const sql = c2_query.mock.calls[0][0];
      const params = c2_query.mock.calls[0][1];
      expect(sql).toMatch(/n\.user_id\s*=\s*\?/i);
      expect(params[0]).toBe(1);
    });
  });

  describe('POST /api/notifications/read-all', () => {
    it('marks all read for current user', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce({ affectedRows: 5 });

      const res = await request(app)
        .post('/api/notifications/read-all')
        .set('Authorization', 'Bearer t');

      expect(res.status).toBe(200);
      const params = c2_query.mock.calls[0][1];
      expect(params).toContain(1); // user id
    });
  });

  describe('GET/PUT /api/notifications/preferences', () => {
    it('returns preferences merged with defaults', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{
        notification_prefs: JSON.stringify({ email_mention: false }),
      }]);

      const res = await request(app)
        .get('/api/notifications/preferences')
        .set('Authorization', 'Bearer t');

      expect(res.status).toBe(200);
      expect(res.body.prefs.email_mention).toBe(false);
      expect(res.body.prefs.email_comment_on_my_doc).toBe(true);
    });

    it('rejects non-object body on PUT', async () => {
      mockAuthenticated();

      const res = await request(app)
        .put('/api/notifications/preferences')
        .set('Authorization', 'Bearer t')
        .send([1, 2, 3]);

      expect(res.status).toBe(400);
    });

    it('persists whitelisted keys on PUT', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce({ affectedRows: 1 });

      const res = await request(app)
        .put('/api/notifications/preferences')
        .set('Authorization', 'Bearer t')
        .send({ email_mention: false, garbage: 'value' });

      expect(res.status).toBe(200);
      expect(res.body.prefs.email_mention).toBe(false);
      const stored = JSON.parse(c2_query.mock.calls[0][1][0]);
      expect(stored).not.toHaveProperty('garbage');
    });
  });
});
