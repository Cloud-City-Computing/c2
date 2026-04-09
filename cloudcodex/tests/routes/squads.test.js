import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { c2_query } from '../../mysql_connect.js';
import { mockAuthenticated, resetMocks, TEST_USER } from '../helpers.js';

describe('Squad Routes', () => {
  beforeEach(() => {
    resetMocks();
  });

  // ── GET /api/workspaces/:workspaceId/squads ───────────────────

  describe('GET /api/workspaces/:workspaceId/squads', () => {
    it('lists squads for workspace member', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ '1': 1 }]) // access check
        .mockResolvedValueOnce([
          { id: 1, name: 'Alpha', created_at: '2026-01-01', created_by: 'user' },
        ]);

      const res = await request(app)
        .get('/api/workspaces/1/squads')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.squads).toHaveLength(1);
    });

    it('rejects non-member', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]); // no access

      const res = await request(app)
        .get('/api/workspaces/1/squads')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });

    it('rejects invalid workspace ID', async () => {
      mockAuthenticated();

      const res = await request(app)
        .get('/api/workspaces/abc/squads')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });
  });

  // ── POST /api/workspaces/:workspaceId/squads ──────────────────

  describe('POST /api/workspaces/:workspaceId/squads', () => {
    it('creates squad as workspace owner', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, owner: TEST_USER.email }]) // workspace check
        .mockResolvedValueOnce({ insertId: 10 })                     // INSERT squad
        .mockResolvedValueOnce([]);                                   // INSERT squad_members (creator)

      const res = await request(app)
        .post('/api/workspaces/1/squads')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: 'New Squad' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.squadId).toBe(10);
    });

    it('rejects empty name', async () => {
      mockAuthenticated();

      const res = await request(app)
        .post('/api/workspaces/1/squads')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: '' });

      expect(res.status).toBe(400);
    });

    it('rejects when workspace not found', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]); // no workspace

      const res = await request(app)
        .post('/api/workspaces/1/squads')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: 'Squad' });

      expect(res.status).toBe(404);
    });
  });

  // ── PUT /api/squads/:id ────────────────────────────────────

  describe('PUT /api/squads/:id', () => {
    it('renames squad for creator', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, created_by: TEST_USER.id, owner: 'other@test.com' }]) // squad check
        .mockResolvedValueOnce([]); // UPDATE

      const res = await request(app)
        .put('/api/squads/1')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: 'Renamed' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects non-owner/creator', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ id: 1, created_by: 999, owner: 'other@test.com' }]);

      const res = await request(app)
        .put('/api/squads/1')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: 'Renamed' });

      expect(res.status).toBe(403);
    });

    it('returns 404 for missing squad', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]); // no squad

      const res = await request(app)
        .put('/api/squads/999')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: 'Test' });

      expect(res.status).toBe(404);
    });

    it('rejects empty name', async () => {
      mockAuthenticated();

      const res = await request(app)
        .put('/api/squads/1')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: '' });

      expect(res.status).toBe(400);
    });
  });

  // ── DELETE /api/squads/:id ─────────────────────────────────

  describe('DELETE /api/squads/:id', () => {
    it('deletes squad for creator', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, created_by: TEST_USER.id, owner: 'other@test.com' }])
        .mockResolvedValueOnce([]);

      const res = await request(app)
        .delete('/api/squads/1')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects non-owner/creator', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ id: 1, created_by: 999, owner: 'other@test.com' }]);

      const res = await request(app)
        .delete('/api/squads/1')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });
  });

  // ── GET /api/squads/:id/members ────────────────────────────

  describe('GET /api/squads/:id/members', () => {
    it('returns members for squad creator', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, created_by: TEST_USER.id, owner: null }]) // squad check
        .mockResolvedValueOnce([
          { id: 1, user_id: 1, name: 'testuser', email: 'test@example.com', role: 'owner', can_read: true, can_write: true, can_create_log: true, can_create_archive: true, can_manage_members: true, can_delete_version: true, joined_at: '2026-01-01' },
        ]);

      const res = await request(app)
        .get('/api/squads/1/members')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.members).toHaveLength(1);
    });

    it('rejects non-member', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, created_by: 999, owner: 'other@test.com' }]) // squad found, not creator/owner
        .mockResolvedValueOnce([]); // not a member

      const res = await request(app)
        .get('/api/squads/1/members')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });
  });

  // ── POST /api/squads/:id/members/invite ────────────────────

  describe('POST /api/squads/:id/members/invite', () => {
    it('invites user when manager', async () => {
      mockAuthenticated();
      // canManageSquad queries
      c2_query
        .mockResolvedValueOnce([{ id: 1, created_by: TEST_USER.id, owner: null }]) // squad check
        // target user exists
        .mockResolvedValueOnce([{ id: 2 }])
        // not already a member
        .mockResolvedValueOnce([])
        // no pending invitation
        .mockResolvedValueOnce([])
        // INSERT invitation
        .mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/squads/1/members/invite')
        .set('Authorization', 'Bearer valid-token')
        .send({ userId: 2 });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('rejects if user already member', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, created_by: TEST_USER.id, owner: null }])
        .mockResolvedValueOnce([{ id: 2 }])
        .mockResolvedValueOnce([{ id: 1 }]); // already member

      const res = await request(app)
        .post('/api/squads/1/members/invite')
        .set('Authorization', 'Bearer valid-token')
        .send({ userId: 2 });

      expect(res.status).toBe(409);
    });

    it('rejects invalid user ID', async () => {
      mockAuthenticated();

      const res = await request(app)
        .post('/api/squads/1/members/invite')
        .set('Authorization', 'Bearer valid-token')
        .send({ userId: 'abc' });

      expect(res.status).toBe(400);
    });
  });

  // ── Invitations ───────────────────────────────────────────

  describe('GET /api/invitations', () => {
    it('returns pending invitations for user', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([
        { id: 1, squad_id: 1, squad_name: 'Alpha', workspace_name: 'Workspace', invited_by_name: 'admin', role: 'member', created_at: '2026-01-01' },
      ]);

      const res = await request(app)
        .get('/api/invitations')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.invitations).toHaveLength(1);
    });
  });

  describe('POST /api/invitations/:id/accept', () => {
    it('accepts valid invitation', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{
          id: 1, squad_id: 1, invited_user_id: TEST_USER.id, invited_by: 2, role: 'member',
          can_read: true, can_write: false, can_create_log: false, can_create_archive: false,
          can_manage_members: false, can_delete_version: false, status: 'pending',
        }])
        .mockResolvedValueOnce([])  // INSERT squad_members
        .mockResolvedValueOnce([]); // UPDATE invitation

      const res = await request(app)
        .post('/api/invitations/1/accept')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects invitation for another user', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{
        id: 1, squad_id: 1, invited_user_id: 999, invited_by: 2, role: 'member', status: 'pending',
      }]);

      const res = await request(app)
        .post('/api/invitations/1/accept')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });

    it('rejects non-existent invitation', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]); // not found

      const res = await request(app)
        .post('/api/invitations/999/accept')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/invitations/:id/decline', () => {
    it('declines valid invitation', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, invited_user_id: TEST_USER.id }])
        .mockResolvedValueOnce([]); // UPDATE status

      const res = await request(app)
        .post('/api/invitations/1/decline')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ── GET /api/squads/:id/permissions ────────────────────────

  describe('GET /api/squads/:id/permissions', () => {
    it('returns permissions for workspace owner', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, owner: TEST_USER.email }])  // squad found, user is owner
        .mockResolvedValueOnce([{ create_archive: true, create_log: true }]);  // perms

      const res = await request(app)
        .get('/api/squads/1/permissions')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.permissions.create_archive).toBe(true);
    });

    it('returns defaults when no permissions row exists', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, owner: TEST_USER.email }])
        .mockResolvedValueOnce([]);  // no perms row

      const res = await request(app)
        .get('/api/squads/1/permissions')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.permissions.create_archive).toBe(false);
      expect(res.body.permissions.create_log).toBe(true);
    });

    it('rejects non-owner', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ id: 1, owner: 'other@example.com' }]);

      const res = await request(app)
        .get('/api/squads/1/permissions')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });

    it('returns 404 for unknown squad', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/api/squads/999/permissions')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(404);
    });
  });

  // ── PUT /api/squads/:id/permissions ────────────────────────

  describe('PUT /api/squads/:id/permissions', () => {
    it('updates existing permissions for workspace owner', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, owner: TEST_USER.email }])  // squad found, user is owner
        .mockResolvedValueOnce([{ id: 10 }])  // existing row
        .mockResolvedValueOnce([]);            // UPDATE

      const res = await request(app)
        .put('/api/squads/1/permissions')
        .set('Authorization', 'Bearer valid-token')
        .send({ create_archive: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('inserts permissions when none exist', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, owner: TEST_USER.email }])
        .mockResolvedValueOnce([])   // no existing row
        .mockResolvedValueOnce([]);  // INSERT

      const res = await request(app)
        .put('/api/squads/1/permissions')
        .set('Authorization', 'Bearer valid-token')
        .send({ create_archive: true, create_log: false });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects non-owner', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ id: 1, owner: 'other@example.com' }]);

      const res = await request(app)
        .put('/api/squads/1/permissions')
        .set('Authorization', 'Bearer valid-token')
        .send({ create_archive: true });

      expect(res.status).toBe(403);
    });
  });

  // ── PUT /api/squads/:id/members/:userId ────────────────────

  describe('PUT /api/squads/:id/members/:userId', () => {
    it('updates member role with manage permission', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, created_by: TEST_USER.id, owner: TEST_USER.email }])  // canManageSquad: squad found
        .mockResolvedValueOnce([{ id: 50, role: 'member' }])  // member found
        .mockResolvedValueOnce([]);  // UPDATE

      const res = await request(app)
        .put('/api/squads/1/members/2')
        .set('Authorization', 'Bearer valid-token')
        .send({ can_write: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('prevents modifying own permissions', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ id: 1, created_by: TEST_USER.id, owner: TEST_USER.email }]);

      const res = await request(app)
        .put(`/api/squads/1/members/${TEST_USER.id}`)
        .set('Authorization', 'Bearer valid-token')
        .send({ can_write: true });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('your own');
    });

    it('prevents modifying a squad owner', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, created_by: TEST_USER.id, owner: TEST_USER.email }])
        .mockResolvedValueOnce([{ id: 50, role: 'owner' }]);  // target is owner

      const res = await request(app)
        .put('/api/squads/1/members/2')
        .set('Authorization', 'Bearer valid-token')
        .send({ can_write: false });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('owner');
    });

    it('prevents privilege escalation by non-creator', async () => {
      mockAuthenticated();
      // canManageSquad: user is not owner/creator but has can_manage_members
      c2_query
        .mockResolvedValueOnce([{ id: 1, created_by: 99, owner: 'other@example.com' }])  // squad (not owner/creator)
        .mockResolvedValueOnce([{ can_manage_members: true }])  // membership check in canManageSquad
        .mockResolvedValueOnce([{ id: 50, role: 'member' }]);   // target member

      const res = await request(app)
        .put('/api/squads/1/members/2')
        .set('Authorization', 'Bearer valid-token')
        .send({ can_manage_members: true });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('workspace owners');
    });

    it('rejects without management permission', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, created_by: 99, owner: 'other@example.com' }])
        .mockResolvedValueOnce([]);  // no can_manage_members

      const res = await request(app)
        .put('/api/squads/1/members/2')
        .set('Authorization', 'Bearer valid-token')
        .send({ can_read: true });

      expect(res.status).toBe(403);
    });
  });

  // ── DELETE /api/squads/:id/members/:userId ─────────────────

  describe('DELETE /api/squads/:id/members/:userId', () => {
    it('removes a member', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, created_by: TEST_USER.id, owner: TEST_USER.email }])  // canManageSquad
        .mockResolvedValueOnce([{ role: 'member' }])  // member found, not owner
        .mockResolvedValueOnce([]);                    // DELETE

      const res = await request(app)
        .delete('/api/squads/1/members/2')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('prevents removing a squad owner', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, created_by: TEST_USER.id, owner: TEST_USER.email }])
        .mockResolvedValueOnce([{ role: 'owner' }]);  // target is owner

      const res = await request(app)
        .delete('/api/squads/1/members/2')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('owner');
    });

    it('rejects without management permission', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, created_by: 99, owner: 'other@example.com' }])
        .mockResolvedValueOnce([]);  // no can_manage_members

      const res = await request(app)
        .delete('/api/squads/1/members/2')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });
  });

  // ── GET /api/squads/:id/invitations ────────────────────────

  describe('GET /api/squads/:id/invitations', () => {
    it('returns pending invitations for squad manager', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, created_by: TEST_USER.id, owner: TEST_USER.email }])  // canManageSquad
        .mockResolvedValueOnce([{ id: 10, name: 'Invited User', email: 'inv@example.com' }]);   // invitations

      const res = await request(app)
        .get('/api/squads/1/invitations')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.invitations).toHaveLength(1);
    });

    it('rejects without management permission', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, created_by: 99, owner: 'other@example.com' }])
        .mockResolvedValueOnce([]);  // no can_manage_members

      const res = await request(app)
        .get('/api/squads/1/invitations')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });

    it('returns 404 for unknown squad', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]);  // squad not found (canManageSquad returns null)

      const res = await request(app)
        .get('/api/squads/999/invitations')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(404);
    });
  });

  // ── DELETE /api/invitations/:id ───────────────────────────

  describe('DELETE /api/invitations/:id', () => {
    it('cancels a pending invitation', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 10, squad_id: 1 }])  // invitation found
        .mockResolvedValueOnce([{ id: 1, created_by: TEST_USER.id, owner: TEST_USER.email }])  // canManageSquad
        .mockResolvedValueOnce([]);  // DELETE

      const res = await request(app)
        .delete('/api/invitations/10')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 404 when invitation not found', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]);  // not found

      const res = await request(app)
        .delete('/api/invitations/999')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(404);
    });

    it('rejects without management permission', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 10, squad_id: 1 }])  // invitation found
        .mockResolvedValueOnce([{ id: 1, created_by: 99, owner: 'other@example.com' }])  // squad (not owner)
        .mockResolvedValueOnce([]);  // no can_manage_members

      const res = await request(app)
        .delete('/api/invitations/10')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });
  });
});
