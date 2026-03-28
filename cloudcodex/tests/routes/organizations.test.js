import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { c2_query } from '../../mysql_connect.js';
import { mockAuthenticated, mockUnauthenticated, resetMocks, TEST_USER } from '../helpers.js';

describe('Organization Routes', () => {
  beforeEach(() => {
    resetMocks();
  });

  // ── GET /api/organizations ────────────────────────────────

  describe('GET /api/organizations', () => {
    it('returns organizations for authenticated user', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([
        { id: 1, name: 'My Org', owner: 'test@example.com', created_at: '2026-01-01' },
      ]);

      const res = await request(app)
        .get('/api/organizations')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.organizations).toHaveLength(1);
      expect(res.body.organizations[0].name).toBe('My Org');
    });

    it('returns empty list when no orgs', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/api/organizations')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.organizations).toEqual([]);
    });

    it('requires authentication', async () => {
      mockUnauthenticated();

      const res = await request(app)
        .get('/api/organizations')
        .set('Authorization', 'Bearer bad');

      expect(res.status).toBe(401);
    });
  });

  // ── POST /api/organizations ───────────────────────────────

  describe('POST /api/organizations', () => {
    it('creates organization', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce({ insertId: 5 });

      const res = await request(app)
        .post('/api/organizations')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: 'New Org' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.organizationId).toBe(5);
    });

    it('rejects empty name', async () => {
      mockAuthenticated();

      const res = await request(app)
        .post('/api/organizations')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: '' });

      expect(res.status).toBe(400);
    });

    it('rejects missing name', async () => {
      mockAuthenticated();

      const res = await request(app)
        .post('/api/organizations')
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(res.status).toBe(400);
    });
  });

  // ── PUT /api/organizations/:id ────────────────────────────

  describe('PUT /api/organizations/:id', () => {
    it('renames org for owner', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1 }])  // owner check
        .mockResolvedValueOnce([]);            // UPDATE

      const res = await request(app)
        .put('/api/organizations/1')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: 'Renamed Org' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects non-owner', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]); // not owner

      const res = await request(app)
        .put('/api/organizations/1')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: 'Renamed Org' });

      expect(res.status).toBe(403);
    });

    it('rejects invalid ID', async () => {
      mockAuthenticated();

      const res = await request(app)
        .put('/api/organizations/abc')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: 'Test' });

      expect(res.status).toBe(400);
    });

    it('rejects empty name', async () => {
      mockAuthenticated();

      const res = await request(app)
        .put('/api/organizations/1')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: '' });

      expect(res.status).toBe(400);
    });
  });

  // ── DELETE /api/organizations/:id ─────────────────────────

  describe('DELETE /api/organizations/:id', () => {
    it('deletes org for owner', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1 }]) // owner check
        .mockResolvedValueOnce([]);           // DELETE

      const res = await request(app)
        .delete('/api/organizations/1')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects non-owner', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]); // not owner

      const res = await request(app)
        .delete('/api/organizations/1')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });

    it('rejects invalid ID', async () => {
      mockAuthenticated();

      const res = await request(app)
        .delete('/api/organizations/abc')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });
  });
});
