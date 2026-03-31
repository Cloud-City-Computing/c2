import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { c2_query } from '../../mysql_connect.js';
import { mockAuthenticated, mockUnauthenticated, resetMocks, TEST_USER } from '../helpers.js';

describe('Project Routes', () => {
  beforeEach(() => {
    resetMocks();
  });

  // ── GET /api/projects ─────────────────────────────────────

  describe('GET /api/projects', () => {
    it('returns projects the user can access', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([
        { id: 1, name: 'Project A', created_at: '2026-01-01', created_by: 'user', created_by_id: 1, team_name: null, team_id: null },
      ]);

      const res = await request(app)
        .get('/api/projects')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.projects).toHaveLength(1);
      expect(res.body.projects[0].name).toBe('Project A');
    });

    it('requires authentication', async () => {
      mockUnauthenticated();

      const res = await request(app)
        .get('/api/projects')
        .set('Authorization', 'Bearer bad-token');

      expect(res.status).toBe(401);
    });
  });

  // ── GET /api/projects/:projectId/pages ────────────────────

  describe('GET /api/projects/:projectId/pages', () => {
    it('returns page tree', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1 }]) // project access check
        .mockResolvedValueOnce([
          { id: 1, title: 'Root', parent_id: null, version: 1, created_at: '2026-01-01', updated_at: null, created_by: 'user', project_id: 1 },
          { id: 2, title: 'Child', parent_id: 1, version: 1, created_at: '2026-01-02', updated_at: null, created_by: 'user', project_id: 1 },
        ]);

      const res = await request(app)
        .get('/api/projects/1/pages')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.pages).toHaveLength(1); // 1 root
      expect(res.body.pages[0].children).toHaveLength(1); // 1 child nested
    });

    it('returns 403 without access', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]); // no access

      const res = await request(app)
        .get('/api/projects/1/pages')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });

    it('rejects invalid projectId', async () => {
      mockAuthenticated();

      const res = await request(app)
        .get('/api/projects/abc/pages')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });
  });

  // ── POST /api/projects ────────────────────────────────────

  describe('POST /api/projects', () => {
    it('creates a project with permission', async () => {
      mockAuthenticated();
      // requirePermission loads permissions
      c2_query.mockResolvedValueOnce([{ create_team: true, create_project: true, create_page: true }]);
      // INSERT project
      c2_query.mockResolvedValueOnce({ insertId: 5 });

      const res = await request(app)
        .post('/api/projects')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: 'New Project' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.projectId).toBe(5);
    });

    it('rejects without create_project permission', async () => {
      mockAuthenticated();
      // requirePermission loads permissions — no create_project
      c2_query.mockResolvedValueOnce([{ create_team: false, create_project: false, create_page: true }]);

      const res = await request(app)
        .post('/api/projects')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: 'New Project' });

      expect(res.status).toBe(403);
    });

    it('rejects empty name', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ create_team: true, create_project: true, create_page: true }]);

      const res = await request(app)
        .post('/api/projects')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: '' });

      expect(res.status).toBe(400);
    });
  });

  // ── PUT /api/projects/:id ─────────────────────────────────

  describe('PUT /api/projects/:id', () => {
    it('renames project with write access', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1 }]) // write access check
        .mockResolvedValueOnce([]);           // UPDATE

      const res = await request(app)
        .put('/api/projects/1')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: 'Renamed' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects without write access', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]); // no access

      const res = await request(app)
        .put('/api/projects/1')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: 'Renamed' });

      expect(res.status).toBe(403);
    });

    it('rejects empty name', async () => {
      mockAuthenticated();

      const res = await request(app)
        .put('/api/projects/1')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: '' });

      expect(res.status).toBe(400);
    });
  });

  // ── DELETE /api/projects/:id ──────────────────────────────

  describe('DELETE /api/projects/:id', () => {
    it('deletes project for owner', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ '1': 1 }]) // isProjectOwner check
        .mockResolvedValueOnce([]);            // DELETE

      const res = await request(app)
        .delete('/api/projects/1')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects non-owner', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]); // not owner

      const res = await request(app)
        .delete('/api/projects/1')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });

    it('rejects invalid ID', async () => {
      mockAuthenticated();

      const res = await request(app)
        .delete('/api/projects/abc')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });
  });

  // ── POST /api/projects/:id/access ─────────────────────────

  describe('POST /api/projects/:id/access', () => {
    it('adds read access for owner', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ '1': 1 }])        // isProjectOwner
        .mockResolvedValueOnce([{ acl: '[1]' }])     // SELECT current acl
        .mockResolvedValueOnce([]);                    // UPDATE

      const res = await request(app)
        .post('/api/projects/1/access')
        .set('Authorization', 'Bearer valid-token')
        .send({ userId: 2, accessType: 'read', action: 'add' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects invalid parameters', async () => {
      mockAuthenticated();

      const res = await request(app)
        .post('/api/projects/1/access')
        .set('Authorization', 'Bearer valid-token')
        .send({ userId: 2, accessType: 'invalid', action: 'add' });

      expect(res.status).toBe(400);
    });

    it('rejects non-owner', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]); // not owner

      const res = await request(app)
        .post('/api/projects/1/access')
        .set('Authorization', 'Bearer valid-token')
        .send({ userId: 2, accessType: 'read', action: 'add' });

      expect(res.status).toBe(403);
    });
  });

  // ── POST /api/projects/:projectId/pages ───────────────────

  describe('POST /api/projects/:projectId/pages', () => {
    it('creates page with permission', async () => {
      mockAuthenticated();
      // requirePermission('create_page') -> load permissions
      c2_query.mockResolvedValueOnce([{ create_team: true, create_project: true, create_page: true }]);
      // write access check
      c2_query.mockResolvedValueOnce([{ id: 1 }]);
      // INSERT page
      c2_query.mockResolvedValueOnce({ insertId: 10 });

      const res = await request(app)
        .post('/api/projects/1/pages')
        .set('Authorization', 'Bearer valid-token')
        .send({ title: 'New Page' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('requires authentication', async () => {
      mockUnauthenticated();

      const res = await request(app)
        .post('/api/projects/1/pages')
        .set('Authorization', 'Bearer bad')
        .send({ title: 'New Page' });

      expect(res.status).toBe(401);
    });
  });

  // ── PUT /api/projects/:projectId/pages/:pageId ────────────

  describe('PUT /api/projects/:projectId/pages/:pageId', () => {
    it('renames a page with write access', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1 }])  // write access
        .mockResolvedValueOnce([]);           // UPDATE pages

      const res = await request(app)
        .put('/api/projects/1/pages/10')
        .set('Authorization', 'Bearer valid-token')
        .send({ title: 'New Title' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('moves a page to a new parent', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1 }])  // write access
        .mockResolvedValueOnce([]);           // UPDATE pages

      const res = await request(app)
        .put('/api/projects/1/pages/10')
        .set('Authorization', 'Bearer valid-token')
        .send({ parent_id: 5 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects with no fields to update', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ id: 1 }]);  // write access

      const res = await request(app)
        .put('/api/projects/1/pages/10')
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(res.status).toBe(400);
    });

    it('rejects without write access', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]);  // no access

      const res = await request(app)
        .put('/api/projects/1/pages/10')
        .set('Authorization', 'Bearer valid-token')
        .send({ title: 'New Title' });

      expect(res.status).toBe(403);
    });

    it('rejects invalid IDs', async () => {
      mockAuthenticated();

      const res = await request(app)
        .put('/api/projects/abc/pages/xyz')
        .set('Authorization', 'Bearer valid-token')
        .send({ title: 'New Title' });

      expect(res.status).toBe(400);
    });
  });

  // ── DELETE /api/projects/:projectId/pages/:pageId ─────────

  describe('DELETE /api/projects/:projectId/pages/:pageId', () => {
    it('deletes a page with write access', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1 }])  // write access
        .mockResolvedValueOnce([]);           // DELETE

      const res = await request(app)
        .delete('/api/projects/1/pages/10')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects without write access', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]);  // no access

      const res = await request(app)
        .delete('/api/projects/1/pages/10')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });

    it('rejects invalid IDs', async () => {
      mockAuthenticated();

      const res = await request(app)
        .delete('/api/projects/abc/pages/xyz')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });
  });
});
