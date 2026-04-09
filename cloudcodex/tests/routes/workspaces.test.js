import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { c2_query } from '../../mysql_connect.js';
import { mockAuthenticated, mockUnauthenticated, resetMocks, TEST_USER } from '../helpers.js';

describe('Workspace Routes', () => {
  beforeEach(() => {
    resetMocks();
  });

  // ── GET /api/workspaces ────────────────────────────────

  describe('GET /api/workspaces', () => {
    it('returns workspaces for authenticated user', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([
        { id: 1, name: 'My Workspace', owner: 'test@example.com', created_at: '2026-01-01' },
      ]);

      const res = await request(app)
        .get('/api/workspaces')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.workspaces).toHaveLength(1);
      expect(res.body.workspaces[0].name).toBe('My Workspace');
    });

    it('returns empty list when no workspaces', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/api/workspaces')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.workspaces).toEqual([]);
    });

    it('requires authentication', async () => {
      mockUnauthenticated();

      const res = await request(app)
        .get('/api/workspaces')
        .set('Authorization', 'Bearer bad');

      expect(res.status).toBe(401);
    });
  });

  // ── POST /api/workspaces ───────────────────────────────

  describe('POST /api/workspaces', () => {
    const ADMIN_USER = { ...TEST_USER, is_admin: true };

    it('creates workspace', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce({ insertId: 5 });

      const res = await request(app)
        .post('/api/workspaces')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: 'New Workspace' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.workspaceId).toBe(5);
    });

    it('rejects non-admin user', async () => {
      mockAuthenticated(); // default TEST_USER, not admin

      const res = await request(app)
        .post('/api/workspaces')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: 'New Workspace' });

      expect(res.status).toBe(403);
    });

    it('rejects empty name', async () => {
      mockAuthenticated(ADMIN_USER);

      const res = await request(app)
        .post('/api/workspaces')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: '' });

      expect(res.status).toBe(400);
    });

    it('rejects missing name', async () => {
      mockAuthenticated(ADMIN_USER);

      const res = await request(app)
        .post('/api/workspaces')
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(res.status).toBe(400);
    });
  });

  // ── PUT /api/workspaces/:id ────────────────────────────

  describe('PUT /api/workspaces/:id', () => {
    it('renames workspace for owner', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1 }])  // owner check
        .mockResolvedValueOnce([]);            // UPDATE

      const res = await request(app)
        .put('/api/workspaces/1')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: 'Renamed Workspace' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects non-owner', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]); // not owner

      const res = await request(app)
        .put('/api/workspaces/1')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: 'Renamed Workspace' });

      expect(res.status).toBe(403);
    });

    it('rejects invalid ID', async () => {
      mockAuthenticated();

      const res = await request(app)
        .put('/api/workspaces/abc')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: 'Test' });

      expect(res.status).toBe(400);
    });

    it('rejects empty name', async () => {
      mockAuthenticated();

      const res = await request(app)
        .put('/api/workspaces/1')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: '' });

      expect(res.status).toBe(400);
    });
  });

  // ── DELETE /api/workspaces/:id ─────────────────────────

  describe('DELETE /api/workspaces/:id', () => {
    it('deletes workspace for owner', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1 }]) // owner check
        .mockResolvedValueOnce([]);           // DELETE

      const res = await request(app)
        .delete('/api/workspaces/1')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects non-owner', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]); // not owner

      const res = await request(app)
        .delete('/api/workspaces/1')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });

    it('rejects invalid ID', async () => {
      mockAuthenticated();

      const res = await request(app)
        .delete('/api/workspaces/abc')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });
  });
});
