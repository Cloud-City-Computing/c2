import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { c2_query } from '../../mysql_connect.js';
import { mockAuthenticated, mockUnauthenticated, resetMocks, TEST_USER } from '../helpers.js';

describe('Archive Routes', () => {
  beforeEach(() => {
    resetMocks();
  });

  // ── GET /api/archives ─────────────────────────────────────

  describe('GET /api/archives', () => {
    it('returns archives the user can access', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([
        { id: 1, name: 'Archive A', created_at: '2026-01-01', created_by: 'user', created_by_id: 1, squad_name: null, squad_id: null },
      ]);

      const res = await request(app)
        .get('/api/archives')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.archives).toHaveLength(1);
      expect(res.body.archives[0].name).toBe('Archive A');
    });

    it('requires authentication', async () => {
      mockUnauthenticated();

      const res = await request(app)
        .get('/api/archives')
        .set('Authorization', 'Bearer bad-token');

      expect(res.status).toBe(401);
    });
  });

  // ── GET /api/archives/:archiveId/logs ────────────────────

  describe('GET /api/archives/:archiveId/logs', () => {
    it('returns log tree', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1 }]) // archive access check
        .mockResolvedValueOnce([
          { id: 1, title: 'Root', parent_id: null, version: 1, created_at: '2026-01-01', updated_at: null, created_by: 'user', archive_id: 1 },
          { id: 2, title: 'Child', parent_id: 1, version: 1, created_at: '2026-01-02', updated_at: null, created_by: 'user', archive_id: 1 },
        ]);

      const res = await request(app)
        .get('/api/archives/1/logs')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.logs).toHaveLength(1); // 1 root
      expect(res.body.logs[0].children).toHaveLength(1); // 1 child nested
    });

    it('returns 403 without access', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]); // no access

      const res = await request(app)
        .get('/api/archives/1/logs')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });

    it('rejects invalid archiveId', async () => {
      mockAuthenticated();

      const res = await request(app)
        .get('/api/archives/abc/logs')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });
  });

  // ── POST /api/archives ────────────────────────────────────

  describe('POST /api/archives', () => {
    it('creates a archive with permission', async () => {
      mockAuthenticated();
      // requirePermission loads permissions
      c2_query.mockResolvedValueOnce([{ create_squad: true, create_archive: true, create_log: true }]);
      // INSERT archive
      c2_query.mockResolvedValueOnce({ insertId: 5 });

      const res = await request(app)
        .post('/api/archives')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: 'New Archive' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.archiveId).toBe(5);
    });

    it('rejects without create_archive permission', async () => {
      mockAuthenticated();
      // requirePermission loads permissions — no create_archive
      c2_query.mockResolvedValueOnce([{ create_squad: false, create_archive: false, create_log: true }]);

      const res = await request(app)
        .post('/api/archives')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: 'New Archive' });

      expect(res.status).toBe(403);
    });

    it('rejects empty name', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ create_squad: true, create_archive: true, create_log: true }]);

      const res = await request(app)
        .post('/api/archives')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: '' });

      expect(res.status).toBe(400);
    });
  });

  // ── PUT /api/archives/:id ─────────────────────────────────

  describe('PUT /api/archives/:id', () => {
    it('renames archive with write access', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1 }]) // write access check
        .mockResolvedValueOnce([]);           // UPDATE

      const res = await request(app)
        .put('/api/archives/1')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: 'Renamed' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects without write access', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]); // no access

      const res = await request(app)
        .put('/api/archives/1')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: 'Renamed' });

      expect(res.status).toBe(403);
    });

    it('rejects empty name', async () => {
      mockAuthenticated();

      const res = await request(app)
        .put('/api/archives/1')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: '' });

      expect(res.status).toBe(400);
    });
  });

  // ── DELETE /api/archives/:id ──────────────────────────────

  describe('DELETE /api/archives/:id', () => {
    it('deletes archive for owner', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ '1': 1 }]) // isArchiveOwner check
        .mockResolvedValueOnce([]);            // DELETE

      const res = await request(app)
        .delete('/api/archives/1')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects non-owner', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]); // not owner

      const res = await request(app)
        .delete('/api/archives/1')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });

    it('rejects invalid ID', async () => {
      mockAuthenticated();

      const res = await request(app)
        .delete('/api/archives/abc')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });
  });

  // ── POST /api/archives/:id/access ─────────────────────────

  describe('POST /api/archives/:id/access', () => {
    it('adds read access for owner', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ '1': 1 }])        // isArchiveOwner
        .mockResolvedValueOnce([{ acl: '[1]' }])     // SELECT current acl
        .mockResolvedValueOnce([]);                    // UPDATE

      const res = await request(app)
        .post('/api/archives/1/access')
        .set('Authorization', 'Bearer valid-token')
        .send({ userId: 2, accessType: 'read', action: 'add' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects invalid parameters', async () => {
      mockAuthenticated();

      const res = await request(app)
        .post('/api/archives/1/access')
        .set('Authorization', 'Bearer valid-token')
        .send({ userId: 2, accessType: 'invalid', action: 'add' });

      expect(res.status).toBe(400);
    });

    it('rejects non-owner', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]); // not owner

      const res = await request(app)
        .post('/api/archives/1/access')
        .set('Authorization', 'Bearer valid-token')
        .send({ userId: 2, accessType: 'read', action: 'add' });

      expect(res.status).toBe(403);
    });

    it('rejects when no target type provided', async () => {
      mockAuthenticated();

      const res = await request(app)
        .post('/api/archives/1/access')
        .set('Authorization', 'Bearer valid-token')
        .send({ accessType: 'read', action: 'add' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Provide exactly one');
    });

    it('rejects when multiple target types provided', async () => {
      mockAuthenticated();

      const res = await request(app)
        .post('/api/archives/1/access')
        .set('Authorization', 'Bearer valid-token')
        .send({ userId: 2, squadId: 3, accessType: 'read', action: 'add' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Provide exactly one');
    });

    // -- Squad access --

    it('adds squad read access', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ '1': 1 }])        // isArchiveOwner
        .mockResolvedValueOnce([{ acl: '[]' }])      // SELECT current squad acl
        .mockResolvedValueOnce([]);                    // UPDATE

      const res = await request(app)
        .post('/api/archives/1/access')
        .set('Authorization', 'Bearer valid-token')
        .send({ squadId: 5, accessType: 'read', action: 'add' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('removes squad write access', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ '1': 1 }])        // isArchiveOwner
        .mockResolvedValueOnce([{ acl: '[5,6]' }])   // SELECT current squad acl
        .mockResolvedValueOnce([]);                    // UPDATE

      const res = await request(app)
        .post('/api/archives/1/access')
        .set('Authorization', 'Bearer valid-token')
        .send({ squadId: 5, accessType: 'write', action: 'remove' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects invalid squadId', async () => {
      mockAuthenticated();

      const res = await request(app)
        .post('/api/archives/1/access')
        .set('Authorization', 'Bearer valid-token')
        .send({ squadId: 'abc', accessType: 'read', action: 'add' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid squadId');
    });

    // -- Workspace access --

    it('grants workspace read access', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ '1': 1 }])        // isArchiveOwner
        .mockResolvedValueOnce([]);                    // UPDATE

      const res = await request(app)
        .post('/api/archives/1/access')
        .set('Authorization', 'Bearer valid-token')
        .send({ workspace: true, accessType: 'read', action: 'add' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('revokes workspace write access', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ '1': 1 }])        // isArchiveOwner
        .mockResolvedValueOnce([]);                    // UPDATE

      const res = await request(app)
        .post('/api/archives/1/access')
        .set('Authorization', 'Bearer valid-token')
        .send({ workspace: true, accessType: 'write', action: 'remove' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ── GET /api/archives/:id/access ──────────────────────────

  describe('GET /api/archives/:id/access', () => {
    it('returns access configuration including owner squad members', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1 }])   // readAccessWhere check
        .mockResolvedValueOnce([{              // SELECT archive access columns
          read_access: '[1,2]',
          write_access: '[1]',
          read_access_squads: '[3]',
          write_access_squads: '[]',
          read_access_workspace: false,
          write_access_workspace: false,
          squad_id: 10,
          created_by: 1,
          created_by_name: 'alice',
        }])
        .mockResolvedValueOnce([               // resolve users
          { id: 1, name: 'alice', email: 'alice@test.com' },
          { id: 2, name: 'bob', email: 'bob@test.com' },
        ])
        .mockResolvedValueOnce([               // resolve squads
          { id: 3, name: 'Backend Team' },
        ])
        .mockResolvedValueOnce([               // workspace squads
          { id: 3, name: 'Backend Team' },
          { id: 10, name: 'Frontend Team' },
        ])
        .mockResolvedValueOnce([               // granted squad members (squad 3)
          { user_id: 2 },
        ])
        .mockResolvedValueOnce([{ name: 'Frontend Team' }])  // owner squad name
        .mockResolvedValueOnce([               // owner squad members
          { user_id: 1, name: 'alice', email: 'alice@test.com', role: 'owner', can_read: true, can_write: true },
          { user_id: 3, name: 'carol', email: 'carol@test.com', role: 'member', can_read: true, can_write: false },
        ]);

      const res = await request(app)
        .get('/api/archives/1/access')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.access.read_users).toHaveLength(2);
      expect(res.body.access.write_users).toHaveLength(1);
      expect(res.body.access.read_squads).toHaveLength(1);
      expect(res.body.access.read_squads[0].name).toBe('Backend Team');
      expect(res.body.access.read_workspace).toBe(false);
      expect(res.body.access.workspace_squads).toHaveLength(2);
      expect(res.body.access.owner_squad_name).toBe('Frontend Team');
      expect(res.body.access.owner_squad_members).toHaveLength(2);
      expect(res.body.access.owner_squad_members[0].role).toBe('owner');
      expect(res.body.access.created_by_name).toBe('alice');
      // granted squad user IDs = squad 3 members (user 2) + owner squad members (users 1, 3)
      expect(res.body.access.granted_squad_user_ids).toEqual(expect.arrayContaining([2, 1, 3]));
      expect(res.body.access.granted_squad_user_ids).toHaveLength(3);
    });

    it('rejects user without read access', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]); // no read access

      const res = await request(app)
        .get('/api/archives/1/access')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });

    it('rejects invalid archiveId', async () => {
      mockAuthenticated();

      const res = await request(app)
        .get('/api/archives/abc/access')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });
  });

  // ── POST /api/archives/:archiveId/logs ───────────────────

  describe('POST /api/archives/:archiveId/logs', () => {
    it('creates log with permission', async () => {
      mockAuthenticated();
      // requirePermission('create_log') -> load permissions
      c2_query.mockResolvedValueOnce([{ create_squad: true, create_archive: true, create_log: true }]);
      // write access check
      c2_query.mockResolvedValueOnce([{ id: 1 }]);
      // INSERT log
      c2_query.mockResolvedValueOnce({ insertId: 10 });

      const res = await request(app)
        .post('/api/archives/1/logs')
        .set('Authorization', 'Bearer valid-token')
        .send({ title: 'New Log' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('requires authentication', async () => {
      mockUnauthenticated();

      const res = await request(app)
        .post('/api/archives/1/logs')
        .set('Authorization', 'Bearer bad')
        .send({ title: 'New Log' });

      expect(res.status).toBe(401);
    });
  });

  // ── PUT /api/archives/:archiveId/logs/:logId ────────────

  describe('PUT /api/archives/:archiveId/logs/:logId', () => {
    it('renames a log with write access', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1 }])  // write access
        .mockResolvedValueOnce([]);           // UPDATE logs

      const res = await request(app)
        .put('/api/archives/1/logs/10')
        .set('Authorization', 'Bearer valid-token')
        .send({ title: 'New Title' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('moves a log to a new parent', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1 }])  // write access
        .mockResolvedValueOnce([]);           // UPDATE logs

      const res = await request(app)
        .put('/api/archives/1/logs/10')
        .set('Authorization', 'Bearer valid-token')
        .send({ parent_id: 5 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects with no fields to update', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ id: 1 }]);  // write access

      const res = await request(app)
        .put('/api/archives/1/logs/10')
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(res.status).toBe(400);
    });

    it('rejects without write access', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]);  // no access

      const res = await request(app)
        .put('/api/archives/1/logs/10')
        .set('Authorization', 'Bearer valid-token')
        .send({ title: 'New Title' });

      expect(res.status).toBe(403);
    });

    it('rejects invalid IDs', async () => {
      mockAuthenticated();

      const res = await request(app)
        .put('/api/archives/abc/logs/xyz')
        .set('Authorization', 'Bearer valid-token')
        .send({ title: 'New Title' });

      expect(res.status).toBe(400);
    });

    it('rejects non-numeric parent_id', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ id: 1 }]);  // write access

      const res = await request(app)
        .put('/api/archives/1/logs/10')
        .set('Authorization', 'Bearer valid-token')
        .send({ parent_id: 'malicious' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid parent_id');
    });
  });

  // ── DELETE /api/archives/:archiveId/logs/:logId ─────────

  describe('DELETE /api/archives/:archiveId/logs/:logId', () => {
    it('deletes a log with write access', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1 }])  // write access
        .mockResolvedValueOnce([]);           // DELETE

      const res = await request(app)
        .delete('/api/archives/1/logs/10')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects without write access', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]);  // no access

      const res = await request(app)
        .delete('/api/archives/1/logs/10')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });

    it('rejects invalid IDs', async () => {
      mockAuthenticated();

      const res = await request(app)
        .delete('/api/archives/abc/logs/xyz')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });
  });
});
