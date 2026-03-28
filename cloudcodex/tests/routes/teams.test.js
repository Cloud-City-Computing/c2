import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { c2_query } from '../../mysql_connect.js';
import { mockAuthenticated, mockUnauthenticated, resetMocks, TEST_USER } from '../helpers.js';

describe('Team Routes', () => {
  beforeEach(() => {
    resetMocks();
  });

  // ── GET /api/organizations/:orgId/teams ───────────────────

  describe('GET /api/organizations/:orgId/teams', () => {
    it('lists teams for org member', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ '1': 1 }]) // access check
        .mockResolvedValueOnce([
          { id: 1, name: 'Alpha', created_at: '2026-01-01', created_by: 'user' },
        ]);

      const res = await request(app)
        .get('/api/organizations/1/teams')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.teams).toHaveLength(1);
    });

    it('rejects non-member', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]); // no access

      const res = await request(app)
        .get('/api/organizations/1/teams')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });

    it('rejects invalid org ID', async () => {
      mockAuthenticated();

      const res = await request(app)
        .get('/api/organizations/abc/teams')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });
  });

  // ── POST /api/organizations/:orgId/teams ──────────────────

  describe('POST /api/organizations/:orgId/teams', () => {
    it('creates team as org owner', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, owner: TEST_USER.email }]) // org check
        .mockResolvedValueOnce({ insertId: 10 })                     // INSERT team
        .mockResolvedValueOnce([]);                                   // INSERT team_members (creator)

      const res = await request(app)
        .post('/api/organizations/1/teams')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: 'New Team' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.teamId).toBe(10);
    });

    it('rejects empty name', async () => {
      mockAuthenticated();

      const res = await request(app)
        .post('/api/organizations/1/teams')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: '' });

      expect(res.status).toBe(400);
    });

    it('rejects when org not found', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]); // no org

      const res = await request(app)
        .post('/api/organizations/1/teams')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: 'Team' });

      expect(res.status).toBe(404);
    });
  });

  // ── PUT /api/teams/:id ────────────────────────────────────

  describe('PUT /api/teams/:id', () => {
    it('renames team for creator', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, created_by: TEST_USER.id, owner: 'other@test.com' }]) // team check
        .mockResolvedValueOnce([]); // UPDATE

      const res = await request(app)
        .put('/api/teams/1')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: 'Renamed' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects non-owner/creator', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ id: 1, created_by: 999, owner: 'other@test.com' }]);

      const res = await request(app)
        .put('/api/teams/1')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: 'Renamed' });

      expect(res.status).toBe(403);
    });

    it('returns 404 for missing team', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]); // no team

      const res = await request(app)
        .put('/api/teams/999')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: 'Test' });

      expect(res.status).toBe(404);
    });

    it('rejects empty name', async () => {
      mockAuthenticated();

      const res = await request(app)
        .put('/api/teams/1')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: '' });

      expect(res.status).toBe(400);
    });
  });

  // ── DELETE /api/teams/:id ─────────────────────────────────

  describe('DELETE /api/teams/:id', () => {
    it('deletes team for creator', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, created_by: TEST_USER.id, owner: 'other@test.com' }])
        .mockResolvedValueOnce([]);

      const res = await request(app)
        .delete('/api/teams/1')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects non-owner/creator', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ id: 1, created_by: 999, owner: 'other@test.com' }]);

      const res = await request(app)
        .delete('/api/teams/1')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });
  });

  // ── GET /api/teams/:id/members ────────────────────────────

  describe('GET /api/teams/:id/members', () => {
    it('returns members for team creator', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, created_by: TEST_USER.id, owner: null }]) // team check
        .mockResolvedValueOnce([
          { id: 1, user_id: 1, name: 'testuser', email: 'test@example.com', role: 'owner', can_read: true, can_write: true, can_create_page: true, can_create_project: true, can_manage_members: true, can_delete_version: true, joined_at: '2026-01-01' },
        ]);

      const res = await request(app)
        .get('/api/teams/1/members')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.members).toHaveLength(1);
    });

    it('rejects non-member', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, created_by: 999, owner: 'other@test.com' }]) // team found, not creator/owner
        .mockResolvedValueOnce([]); // not a member

      const res = await request(app)
        .get('/api/teams/1/members')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });
  });

  // ── POST /api/teams/:id/members/invite ────────────────────

  describe('POST /api/teams/:id/members/invite', () => {
    it('invites user when manager', async () => {
      mockAuthenticated();
      // canManageTeam queries
      c2_query
        .mockResolvedValueOnce([{ id: 1, created_by: TEST_USER.id, owner: null }]) // team check
        // target user exists
        .mockResolvedValueOnce([{ id: 2 }])
        // not already a member
        .mockResolvedValueOnce([])
        // no pending invitation
        .mockResolvedValueOnce([])
        // INSERT invitation
        .mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/teams/1/members/invite')
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
        .post('/api/teams/1/members/invite')
        .set('Authorization', 'Bearer valid-token')
        .send({ userId: 2 });

      expect(res.status).toBe(409);
    });

    it('rejects invalid user ID', async () => {
      mockAuthenticated();

      const res = await request(app)
        .post('/api/teams/1/members/invite')
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
        { id: 1, team_id: 1, team_name: 'Alpha', org_name: 'Org', invited_by_name: 'admin', role: 'member', created_at: '2026-01-01' },
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
          id: 1, team_id: 1, invited_user_id: TEST_USER.id, invited_by: 2, role: 'member',
          can_read: true, can_write: false, can_create_page: false, can_create_project: false,
          can_manage_members: false, can_delete_version: false, status: 'pending',
        }])
        .mockResolvedValueOnce([])  // INSERT team_members
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
        id: 1, team_id: 1, invited_user_id: 999, invited_by: 2, role: 'member', status: 'pending',
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
});
