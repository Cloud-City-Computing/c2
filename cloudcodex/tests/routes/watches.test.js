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

describe('Watches Routes', () => {
  beforeEach(() => resetMocks());

  describe('GET /api/watches', () => {
    it('returns the user\'s watches', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([
        { id: 1, resource_type: 'log', resource_id: 42, source: 'manual', created_at: '2026-01-01', resource_name: 'Doc' },
      ]);

      const res = await request(app)
        .get('/api/watches')
        .set('Authorization', 'Bearer t');

      expect(res.status).toBe(200);
      expect(res.body.watches).toHaveLength(1);
    });
  });

  describe('GET /api/watches/:type/:id', () => {
    it('returns watching:true when row exists', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ id: 9, source: 'manual' }]);

      const res = await request(app)
        .get('/api/watches/log/42')
        .set('Authorization', 'Bearer t');

      expect(res.status).toBe(200);
      expect(res.body.watching).toBe(true);
      expect(res.body.source).toBe('manual');
    });

    it('returns watching:false when no row', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/api/watches/log/42')
        .set('Authorization', 'Bearer t');

      expect(res.status).toBe(200);
      expect(res.body.watching).toBe(false);
    });

    it('rejects invalid resource type', async () => {
      mockAuthenticated();
      const res = await request(app)
        .get('/api/watches/squad/42')
        .set('Authorization', 'Bearer t');
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/watches', () => {
    it('creates a watch when user has read access', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 42 }]) // checkLogReadAccess
        .mockResolvedValueOnce({ affectedRows: 1 }); // INSERT

      const res = await request(app)
        .post('/api/watches')
        .set('Authorization', 'Bearer t')
        .send({ resourceType: 'log', resourceId: 42 });

      expect(res.status).toBe(200);
      expect(res.body.watching).toBe(true);
      const insert = c2_query.mock.calls.find((c) => /INSERT INTO watches/i.test(c[0]));
      expect(insert).toBeTruthy();
    });

    it('rejects when user has no read access to the resource', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]); // no access

      const res = await request(app)
        .post('/api/watches')
        .set('Authorization', 'Bearer t')
        .send({ resourceType: 'log', resourceId: 42 });

      expect(res.status).toBe(403);
    });

    it('rejects invalid input', async () => {
      mockAuthenticated();

      const res = await request(app)
        .post('/api/watches')
        .set('Authorization', 'Bearer t')
        .send({ resourceType: 'comment', resourceId: 1 });

      expect(res.status).toBe(400);
    });

    it('rejects unauthenticated', async () => {
      mockUnauthenticated();
      const res = await request(app)
        .post('/api/watches')
        .send({ resourceType: 'log', resourceId: 1 });
      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /api/watches/:type/:id', () => {
    it('removes a watch', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce({ affectedRows: 1 });

      const res = await request(app)
        .delete('/api/watches/log/42')
        .set('Authorization', 'Bearer t');

      expect(res.status).toBe(200);
      expect(res.body.watching).toBe(false);
    });

    it('returns success when no row existed (idempotent)', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce({ affectedRows: 0 });

      const res = await request(app)
        .delete('/api/watches/log/42')
        .set('Authorization', 'Bearer t');

      expect(res.status).toBe(200);
    });
  });
});
