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
      // Hidden `system` archives (the GitHub PR-session ones) must never be
      // listed. Ordinary users hold real read AND write grants on those, so
      // without this predicate they appear in everyone's sidebar. Asserting on
      // the generated SQL because c2_query is mocked and cannot filter.
      expect(c2_query.mock.calls[0][0]).toMatch(/COALESCE\(p\.`system`, FALSE\)/);
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

    // The workspace is the tenant boundary. Holding the *global* create_archive
    // bit (which createDefaultPermissions hands every account) must not mean
    // "may create an archive inside anyone's squad".
    it('rejects a squad_id in a workspace the caller is not in', async () => {
      mockAuthenticated();
      c2_query
        // requirePermission loads permissions: global create_archive is set
        .mockResolvedValueOnce([{ create_squad: true, create_archive: true, create_log: true }])
        // isSquadWorkspaceMember: the squad resolves to workspace 99
        .mockResolvedValueOnce([{ workspace_id: 99 }])
        // isWorkspaceMember: the caller is neither owner nor squad member there
        .mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/archives')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: 'Planted Archive', squad_id: 42 });

      expect(res.status).toBe(403);
      // Generic message on purpose: naming the squad would make this route a
      // squad enumeration oracle.
      expect(res.body.message).toBe("You do not have the 'create_archive' permission");
      // The insert must never have been reached.
      expect(c2_query.mock.calls.some(c => /INSERT INTO archives/.test(c[0]))).toBe(false);
    });

    it('creates an archive when the squad is in the caller workspace', async () => {
      mockAuthenticated();
      c2_query
        // requirePermission loads permissions
        .mockResolvedValueOnce([{ create_squad: true, create_archive: true, create_log: true }])
        // isSquadWorkspaceMember: the squad resolves to workspace 7
        .mockResolvedValueOnce([{ workspace_id: 7 }])
        // isWorkspaceMember: the caller is inside workspace 7
        .mockResolvedValueOnce([{ 1: 1 }])
        // INSERT archive
        .mockResolvedValueOnce({ insertId: 6 });

      const res = await request(app)
        .post('/api/archives')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: 'Own Archive', squad_id: 42 });

      expect(res.status).toBe(201);
      expect(res.body.archiveId).toBe(6);
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
        .mockResolvedValueOnce([{ '1': 1 }])            // isArchiveOwner
        .mockResolvedValueOnce([{ workspace_id: 7 }])   // archive workspace
        .mockResolvedValueOnce([{ '1': 1 }])            // grantee is a member
        .mockResolvedValueOnce([{ acl: '[1]' }])         // SELECT current acl
        .mockResolvedValueOnce([]);                       // UPDATE

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
        .mockResolvedValueOnce([{ '1': 1 }])            // isArchiveOwner
        .mockResolvedValueOnce([{ workspace_id: 7 }])   // archive workspace
        .mockResolvedValueOnce([{ '1': 1 }])            // grantee squad is in it
        .mockResolvedValueOnce([{ acl: '[]' }])          // SELECT current squad acl
        .mockResolvedValueOnce([]);                       // UPDATE

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

    // -- Tenant boundary on the grantee (C2-1c) --
    //
    // The caller is authorised with isArchiveOwner, which says nothing about
    // the grantee. Without a boundary check an archive owner can hand read or
    // write on their tenant's content to an account, or a whole squad, in a
    // different workspace.

    it('rejects granting access to a user outside the archive workspace', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ '1': 1 }])              // isArchiveOwner
        .mockResolvedValueOnce([{ workspace_id: 7 }])     // archive workspace
        .mockResolvedValueOnce([]);                        // grantee not in it

      const res = await request(app)
        .post('/api/archives/1/access')
        .set('Authorization', 'Bearer valid-token')
        .send({ userId: 42, accessType: 'read', action: 'add' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('outside this workspace');
      expect(c2_query.mock.calls.some(([sql]) => /UPDATE archives SET/.test(sql))).toBe(false);
    });

    it('rejects granting access to a squad outside the archive workspace', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ '1': 1 }])              // isArchiveOwner
        .mockResolvedValueOnce([{ workspace_id: 7 }])     // archive workspace
        .mockResolvedValueOnce([]);                        // grantee squad not in it

      const res = await request(app)
        .post('/api/archives/1/access')
        .set('Authorization', 'Bearer valid-token')
        .send({ squadId: 9, accessType: 'write', action: 'add' });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('outside this workspace');
      expect(c2_query.mock.calls.some(([sql]) => /UPDATE archives SET/.test(sql))).toBe(false);
    });

    it('accepts a user inside the archive workspace', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ '1': 1 }])              // isArchiveOwner
        .mockResolvedValueOnce([{ workspace_id: 7 }])     // archive workspace
        .mockResolvedValueOnce([{ '1': 1 }])              // grantee is a member
        .mockResolvedValueOnce([{ acl: '[]' }])            // SELECT current acl
        .mockResolvedValueOnce([]);                        // UPDATE

      const res = await request(app)
        .post('/api/archives/1/access')
        .set('Authorization', 'Bearer valid-token')
        .send({ userId: 42, accessType: 'read', action: 'add' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // The boundary lookup and the membership predicate both ran, and the
      // membership predicate asked about the grantee, not the caller.
      expect(c2_query.mock.calls.some(([sql]) => /JOIN squads t ON t\.id = p\.squad_id/.test(sql))).toBe(true);
      const memberCall = c2_query.mock.calls.find(([sql]) => /FROM workspaces o/.test(sql));
      expect(memberCall).toBeDefined();
      expect(memberCall[1]).toEqual([7, 42, 42]);
      expect(c2_query.mock.calls.some(([sql]) => /UPDATE archives SET/.test(sql))).toBe(true);
    });

    it('accepts a squad inside the archive workspace', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ '1': 1 }])              // isArchiveOwner
        .mockResolvedValueOnce([{ workspace_id: 7 }])     // archive workspace
        .mockResolvedValueOnce([{ '1': 1 }])              // grantee squad is in it
        .mockResolvedValueOnce([{ acl: '[]' }])            // SELECT current squad acl
        .mockResolvedValueOnce([]);                        // UPDATE

      const res = await request(app)
        .post('/api/archives/1/access')
        .set('Authorization', 'Bearer valid-token')
        .send({ squadId: 9, accessType: 'read', action: 'add' });

      expect(res.status).toBe(200);
      // The granted squad is compared to the archive workspace directly, not
      // routed through the user-shaped membership predicate.
      const squadCall = c2_query.mock.calls.find(([sql]) => /FROM squads WHERE id = \? AND workspace_id = \?/.test(sql));
      expect(squadCall).toBeDefined();
      expect(squadCall[1]).toEqual([9, 7]);
      expect(c2_query.mock.calls.some(([sql]) => /FROM workspaces o/.test(sql))).toBe(false);
    });

    it('still removes a grantee that is outside the archive workspace', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ '1': 1 }])              // isArchiveOwner
        .mockResolvedValueOnce([{ acl: '[42]' }])          // SELECT current acl
        .mockResolvedValueOnce([]);                        // UPDATE

      const res = await request(app)
        .post('/api/archives/1/access')
        .set('Authorization', 'Bearer valid-token')
        .send({ userId: 42, accessType: 'read', action: 'remove' });

      expect(res.status).toBe(200);
      // Cross-tenant grants predate this check, so a remove must never be
      // boundary-gated: gating it would make those grants unrevokable.
      expect(c2_query.mock.calls.some(([sql]) => /JOIN squads t ON t\.id = p\.squad_id/.test(sql))).toBe(false);
      const update = c2_query.mock.calls.find(([sql]) => /UPDATE archives SET/.test(sql));
      expect(update[1][0]).toBe('[]');
    });

    it('accepts a grant on an archive with no owning squad', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ '1': 1 }])              // isArchiveOwner
        .mockResolvedValueOnce([])                         // no squad, so no workspace
        .mockResolvedValueOnce([{ acl: '[]' }])            // SELECT current acl
        .mockResolvedValueOnce([]);                        // UPDATE

      const res = await request(app)
        .post('/api/archives/1/access')
        .set('Authorization', 'Bearer valid-token')
        .send({ userId: 42, accessType: 'read', action: 'add' });

      expect(res.status).toBe(200);
      expect(c2_query.mock.calls.some(([sql]) => /FROM workspaces o/.test(sql))).toBe(false);
      expect(c2_query.mock.calls.some(([sql]) => /UPDATE archives SET/.test(sql))).toBe(true);
    });

    it('refuses a squad grant when the owning squad has no workspace', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ '1': 1 }])              // isArchiveOwner
        .mockResolvedValueOnce([{ workspace_id: null }])  // orphaned squad
        .mockResolvedValueOnce([]);                        // grantee squad: no match on NULL

      const res = await request(app)
        .post('/api/archives/1/access')
        .set('Authorization', 'Bearer valid-token')
        .send({ squadId: 9, accessType: 'read', action: 'add' });

      // An orphaned squad has no tenant, so "is the grantee inside it?" is
      // unanswerable and the answer to an unanswerable question is no. The
      // check runs and `workspace_id = NULL` matches nothing.
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/outside this workspace/i);
      const squadCall = c2_query.mock.calls.find(([sql]) => /FROM squads WHERE id = \? AND workspace_id = \?/.test(sql));
      expect(squadCall[1]).toEqual([9, null]);
      expect(c2_query.mock.calls.some(([sql]) => /UPDATE archives SET/.test(sql))).toBe(false);
    });

    it('refuses a user grant when the owning squad has no workspace', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ '1': 1 }])              // isArchiveOwner
        .mockResolvedValueOnce([{ workspace_id: null }])  // orphaned squad
        .mockResolvedValueOnce([]);                        // isWorkspaceMember: no match

      const res = await request(app)
        .post('/api/archives/1/access')
        .set('Authorization', 'Bearer valid-token')
        .send({ userId: 42, accessType: 'read', action: 'add' });

      expect(res.status).toBe(403);
      // isWorkspaceMember is still asked, and `Number(null)` binds workspace 0,
      // which no row has.
      const memberCall = c2_query.mock.calls.find(([sql]) => /FROM workspaces o/.test(sql));
      expect(memberCall[1][0]).toBe(0);
      expect(c2_query.mock.calls.some(([sql]) => /UPDATE archives SET/.test(sql))).toBe(false);
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

    // Regression guard for the tenant-boundary change in requirePermission:
    // only a *body*-supplied squad_id is validated ahead of the global bit.
    // The archive-derived squad deliberately is not, because this route
    // re-checks with writeAccessWhere immediately after the middleware, and an
    // early check would refuse a caller holding an explicit write_access grant
    // without workspace membership. It would also add a middleware query that
    // shifts every mock queue driving this route.
    it('issues no extra middleware query for the archive-derived squad', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ create_squad: true, create_archive: true, create_log: true }])
        .mockResolvedValueOnce([{ id: 1 }])
        .mockResolvedValueOnce({ insertId: 10 });

      const res = await request(app)
        .post('/api/archives/1/logs')
        .set('Authorization', 'Bearer valid-token')
        .send({ title: 'New Log' });

      expect(res.status).toBe(201);
      // The middleware never resolves the archive's squad on this path.
      expect(c2_query.mock.calls.some(c => /SELECT squad_id FROM archives/.test(c[0]))).toBe(false);
      // Permissions load, then straight to the writeAccessWhere re-check.
      expect(c2_query.mock.calls[0][0]).toMatch(/FROM permissions WHERE user_id/);
      expect(c2_query.mock.calls[1][0]).toMatch(/FROM archives p/);
      expect(c2_query.mock.calls[1][0]).toMatch(/JSON_CONTAINS\(p\.write_access/);
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
      // The write-access check must also exclude `system` archives: opening a
      // GitHub PR session grants write on one, and without this a session
      // opener could delete that PR's shared document and cascade away every
      // mirrored review comment on it.
      expect(c2_query.mock.calls[0][0]).toMatch(/COALESCE\(p\.`system`, FALSE\)/);
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

  // ── GET /api/archives/:archiveId/repos ────────────────────

  describe('GET /api/archives/:archiveId/repos', () => {
    it('returns linked repos', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1 }]) // read access check
        .mockResolvedValueOnce([
          { id: 10, repo_full_name: 'user/repo', repo_owner: 'user', repo_name: 'repo', linked_at: '2026-01-01', linked_by_name: 'Test' },
        ]);

      const res = await request(app)
        .get('/api/archives/1/repos')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.repos).toHaveLength(1);
      expect(res.body.repos[0].repo_full_name).toBe('user/repo');
    });

    it('rejects when no read access', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]); // no access

      const res = await request(app)
        .get('/api/archives/1/repos')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });

    it('rejects invalid archive ID', async () => {
      mockAuthenticated();

      const res = await request(app)
        .get('/api/archives/abc/repos')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });
  });

  // ── POST /api/archives/:archiveId/repos ────────────────────

  describe('POST /api/archives/:archiveId/repos', () => {
    it('links a repo to an archive', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ 1: 1 }]) // isArchiveOwner
        .mockResolvedValueOnce({ insertId: 50 }); // INSERT

      const res = await request(app)
        .post('/api/archives/1/repos')
        .set('Authorization', 'Bearer valid-token')
        .send({ repoFullName: 'user/repo', repoOwner: 'user', repoName: 'repo' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.repoLinkId).toBe(50);
    });

    it('rejects when not archive owner', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]); // not owner

      const res = await request(app)
        .post('/api/archives/1/repos')
        .set('Authorization', 'Bearer valid-token')
        .send({ repoFullName: 'user/repo', repoOwner: 'user', repoName: 'repo' });

      expect(res.status).toBe(403);
    });

    it('rejects missing fields', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ 1: 1 }]); // isArchiveOwner

      const res = await request(app)
        .post('/api/archives/1/repos')
        .set('Authorization', 'Bearer valid-token')
        .send({ repoFullName: 'user/repo' });

      expect(res.status).toBe(400);
    });

    it('handles duplicate link', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ 1: 1 }]) // isArchiveOwner
        .mockRejectedValueOnce({ code: 'ER_DUP_ENTRY' }); // duplicate

      const res = await request(app)
        .post('/api/archives/1/repos')
        .set('Authorization', 'Bearer valid-token')
        .send({ repoFullName: 'user/repo', repoOwner: 'user', repoName: 'repo' });

      expect(res.status).toBe(409);
    });

    it('rejects invalid archive ID', async () => {
      mockAuthenticated();

      const res = await request(app)
        .post('/api/archives/abc/repos')
        .set('Authorization', 'Bearer valid-token')
        .send({ repoFullName: 'user/repo', repoOwner: 'user', repoName: 'repo' });

      expect(res.status).toBe(400);
    });
  });

  // ── DELETE /api/archives/:archiveId/repos/:repoId ──────────

  describe('DELETE /api/archives/:archiveId/repos/:repoId', () => {
    it('unlinks a repo', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ 1: 1 }]) // isArchiveOwner
        .mockResolvedValueOnce({ affectedRows: 1 }); // DELETE

      const res = await request(app)
        .delete('/api/archives/1/repos/10')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects when not owner', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]); // not owner

      const res = await request(app)
        .delete('/api/archives/1/repos/10')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });

    it('returns 404 for non-existent link', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ 1: 1 }]) // isArchiveOwner
        .mockResolvedValueOnce({ affectedRows: 0 }); // not found

      const res = await request(app)
        .delete('/api/archives/1/repos/99')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(404);
    });

    it('rejects invalid IDs', async () => {
      mockAuthenticated();

      const res = await request(app)
        .delete('/api/archives/abc/repos/xyz')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });
  });
});
