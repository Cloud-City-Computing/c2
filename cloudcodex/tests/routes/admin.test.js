import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { c2_query, withTransaction } from '../../mysql_connect.js';
import { sendEmail, isMailEnabled } from '../../services/email.js';
import { getAllPresence, getActiveDocCount } from '../../services/collab.js';
import { ensureAdminUser, bootstrapInstance } from '../../routes/admin.js';
import { mockAuthenticated, mockUnauthenticated, resetMocks, TEST_USER } from '../helpers.js';

vi.mock('../../services/collab.js', () => ({
  getAllPresence: vi.fn(() => ({})),
  getActiveDocCount: vi.fn(() => 0),
}));

const ADMIN_USER = { ...TEST_USER, is_admin: true };

describe('Admin Routes', () => {
  beforeEach(() => {
    resetMocks();
    getAllPresence.mockReset().mockReturnValue({});
    getActiveDocCount.mockReset().mockReturnValue(0);
    isMailEnabled.mockReturnValue(true);
  });

  // --- GET /api/admin/status ---

  describe('GET /api/admin/status', () => {
    it('returns true for admin user', async () => {
      mockAuthenticated(ADMIN_USER);
      const res = await request(app)
        .get('/api/admin/status')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.isAdmin).toBe(true);
    });

    it('returns false for non-admin user', async () => {
      mockAuthenticated(TEST_USER);
      const res = await request(app)
        .get('/api/admin/status')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.isAdmin).toBe(false);
    });

    it('requires authentication', async () => {
      mockUnauthenticated();
      const res = await request(app).get('/api/admin/status');
      expect(res.status).toBe(401);
    });
  });

  // --- GET /api/admin/workspaces ---

  describe('GET /api/admin/workspaces', () => {
    it('returns all workspaces for admin', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([
        { id: 1, name: 'Workspace A', owner: 'owner@test.com', created_at: '2026-01-01', squad_count: 2, member_count: 5 },
      ]);

      const res = await request(app)
        .get('/api/admin/workspaces')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.workspaces).toHaveLength(1);
      expect(res.body.workspaces[0].name).toBe('Workspace A');
    });

    it('rejects non-admin user', async () => {
      mockAuthenticated(TEST_USER);
      const res = await request(app)
        .get('/api/admin/workspaces')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });

    it('requires authentication', async () => {
      mockUnauthenticated();
      const res = await request(app).get('/api/admin/workspaces');
      expect(res.status).toBe(401);
    });
  });

  // --- POST /api/admin/workspaces ---

  describe('POST /api/admin/workspaces', () => {
    it('creates a workspace', async () => {
      mockAuthenticated(ADMIN_USER);
      // Find owner user
      c2_query.mockResolvedValueOnce([{ id: 2 }]);
      // Insert workspace
      c2_query.mockResolvedValueOnce({ insertId: 10 });

      const res = await request(app)
        .post('/api/admin/workspaces')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: 'New Workspace', ownerEmail: 'owner@test.com' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.workspaceId).toBe(10);
    });

    it('creates workspace with squad and archive', async () => {
      mockAuthenticated(ADMIN_USER);
      // Find owner user
      c2_query.mockResolvedValueOnce([{ id: 2 }]);
      // Insert workspace
      c2_query.mockResolvedValueOnce({ insertId: 10 });
      // Insert squad
      c2_query.mockResolvedValueOnce({ insertId: 20 });
      // Insert squad member (owner)
      c2_query.mockResolvedValueOnce({ insertId: 30 });
      // Insert archive
      c2_query.mockResolvedValueOnce({ insertId: 40 });

      const res = await request(app)
        .post('/api/admin/workspaces')
        .set('Authorization', 'Bearer valid-token')
        .send({
          name: 'New Workspace',
          ownerEmail: 'owner@test.com',
          squadName: 'Engineering',
          archiveName: 'Docs',
        });

      expect(res.status).toBe(201);
      expect(res.body.workspaceId).toBe(10);
      expect(res.body.squadId).toBe(20);
      expect(res.body.archiveId).toBe(40);
    });

    it('rejects empty name', async () => {
      mockAuthenticated(ADMIN_USER);
      const res = await request(app)
        .post('/api/admin/workspaces')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: '', ownerEmail: 'owner@test.com' });

      expect(res.status).toBe(400);
    });

    it('rejects name over 255 characters', async () => {
      mockAuthenticated(ADMIN_USER);
      const res = await request(app)
        .post('/api/admin/workspaces')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: 'a'.repeat(256), ownerEmail: 'owner@test.com' });

      expect(res.status).toBe(400);
    });

    it('rejects invalid owner email', async () => {
      mockAuthenticated(ADMIN_USER);
      const res = await request(app)
        .post('/api/admin/workspaces')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: 'Workspace', ownerEmail: 'notanemail' });

      expect(res.status).toBe(400);
    });

    it('rejects when owner user not found', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([]); // no user found

      const res = await request(app)
        .post('/api/admin/workspaces')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: 'Workspace', ownerEmail: 'nobody@test.com' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/No user found/);
    });

    it('rejects non-admin user', async () => {
      mockAuthenticated(TEST_USER);
      const res = await request(app)
        .post('/api/admin/workspaces')
        .set('Authorization', 'Bearer valid-token')
        .send({ name: 'Workspace', ownerEmail: 'owner@test.com' });

      expect(res.status).toBe(403);
    });
  });

  // --- DELETE /api/admin/workspaces/:id ---

  describe('DELETE /api/admin/workspaces/:id', () => {
    it('deletes a workspace', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([{ id: 1 }]); // workspace found
      c2_query.mockResolvedValueOnce({ affectedRows: 1 }); // delete

      const res = await request(app)
        .delete('/api/admin/workspaces/1')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 404 when workspace not found', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([]); // not found

      const res = await request(app)
        .delete('/api/admin/workspaces/999')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(404);
    });

    it('rejects invalid workspace ID', async () => {
      mockAuthenticated(ADMIN_USER);
      const res = await request(app)
        .delete('/api/admin/workspaces/abc')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });

    it('rejects non-admin user', async () => {
      mockAuthenticated(TEST_USER);
      const res = await request(app)
        .delete('/api/admin/workspaces/1')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });
  });

  // --- GET /api/admin/users ---

  describe('GET /api/admin/users', () => {
    it('returns all users for admin', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([
        { id: 1, name: 'admin', email: 'admin@test.com', is_admin: 1, created_at: '2026-01-01', squad_count: 0 },
        { id: 2, name: 'user', email: 'user@test.com', is_admin: 0, created_at: '2026-01-02', squad_count: 1 },
      ]);

      const res = await request(app)
        .get('/api/admin/users')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.users).toHaveLength(2);
    });

    it('rejects non-admin user', async () => {
      mockAuthenticated(TEST_USER);
      const res = await request(app)
        .get('/api/admin/users')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });
  });

  // --- DELETE /api/admin/users/:id ---

  describe('DELETE /api/admin/users/:id', () => {
    it('deletes a non-admin user', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([{ id: 5, is_admin: 0 }]); // user found
      c2_query.mockResolvedValueOnce({ affectedRows: 1 }); // delete

      const res = await request(app)
        .delete('/api/admin/users/5')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects deleting self', async () => {
      mockAuthenticated(ADMIN_USER);
      const res = await request(app)
        .delete(`/api/admin/users/${ADMIN_USER.id}`)
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Cannot delete your own/);
    });

    it('rejects deleting another admin', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([{ id: 3, is_admin: 1 }]); // admin user found

      const res = await request(app)
        .delete('/api/admin/users/3')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Cannot delete an admin/);
    });

    it('returns 404 when user not found', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([]); // not found

      const res = await request(app)
        .delete('/api/admin/users/999')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(404);
    });

    it('rejects invalid user ID', async () => {
      mockAuthenticated(ADMIN_USER);
      const res = await request(app)
        .delete('/api/admin/users/abc')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });

    it('rejects non-admin user', async () => {
      mockAuthenticated(TEST_USER);
      const res = await request(app)
        .delete('/api/admin/users/5')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });
  });

  // --- GET /api/admin/invitations ---

  describe('GET /api/admin/invitations', () => {
    it('returns all invitations for admin', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([
        { id: 1, email: 'new@test.com', accepted: 0, created_at: '2026-03-01', expires_at: '2026-03-08', invited_by_name: 'admin' },
      ]);

      const res = await request(app)
        .get('/api/admin/invitations')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.invitations).toHaveLength(1);
    });

    it('rejects non-admin user', async () => {
      mockAuthenticated(TEST_USER);
      const res = await request(app)
        .get('/api/admin/invitations')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });
  });

  // --- POST /api/admin/invitations ---

  describe('POST /api/admin/invitations', () => {
    it('sends invitation email', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([]); // no existing user
      c2_query.mockResolvedValueOnce([]); // no existing invitation
      c2_query.mockResolvedValueOnce({ insertId: 1 }); // insert invitation
      sendEmail.mockResolvedValueOnce({ messageId: 'sent' });

      const res = await request(app)
        .post('/api/admin/invitations')
        .set('Authorization', 'Bearer valid-token')
        .send({ email: 'newuser@test.com' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(sendEmail).toHaveBeenCalled();
    });

    it('returns the signup url and emails it when mail is enabled', async () => {
      mockAuthenticated(ADMIN_USER);
      isMailEnabled.mockReturnValue(true);
      c2_query.mockResolvedValueOnce([]);                  // no existing user
      c2_query.mockResolvedValueOnce([]);                  // no existing invitation
      c2_query.mockResolvedValueOnce({ insertId: 1 });     // insert invitation
      sendEmail.mockResolvedValueOnce({ messageId: 'sent' });

      const res = await request(app)
        .post('/api/admin/invitations')
        .set('Authorization', 'Bearer valid-token')
        .send({ email: 'newuser@test.com' });

      expect(res.status).toBe(201);
      expect(res.body.signup_url).toContain('?invite=');
      expect(res.body.emailed).toBe(true);
      expect(sendEmail).toHaveBeenCalled();
    });

    it('returns the signup url without sending when mail is disabled', async () => {
      mockAuthenticated(ADMIN_USER);
      isMailEnabled.mockReturnValue(false);
      c2_query.mockResolvedValueOnce([]);
      c2_query.mockResolvedValueOnce([]);
      c2_query.mockResolvedValueOnce({ insertId: 1 });

      const res = await request(app)
        .post('/api/admin/invitations')
        .set('Authorization', 'Bearer valid-token')
        .send({ email: 'newuser@test.com' });

      expect(res.status).toBe(201);
      expect(res.body.signup_url).toContain('?invite=');
      expect(res.body.emailed).toBe(false);
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('still returns 201 with the link when sending throws', async () => {
      mockAuthenticated(ADMIN_USER);
      isMailEnabled.mockReturnValue(true);
      c2_query.mockResolvedValueOnce([]);
      c2_query.mockResolvedValueOnce([]);
      c2_query.mockResolvedValueOnce({ insertId: 1 });
      sendEmail.mockRejectedValueOnce(new Error('smtp exploded'));

      const res = await request(app)
        .post('/api/admin/invitations')
        .set('Authorization', 'Bearer valid-token')
        .send({ email: 'newuser@test.com' });

      expect(res.status).toBe(201);
      expect(res.body.signup_url).toContain('?invite=');
      expect(res.body.emailed).toBe(false);
      expect(res.body.message).toContain('Share the link below');
      expect(sendEmail).toHaveBeenCalled();
    });

    it('rejects invalid email', async () => {
      mockAuthenticated(ADMIN_USER);
      const res = await request(app)
        .post('/api/admin/invitations')
        .set('Authorization', 'Bearer valid-token')
        .send({ email: 'notvalid' });

      expect(res.status).toBe(400);
    });

    it('rejects when user already exists', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([{ id: 2 }]); // user exists

      const res = await request(app)
        .post('/api/admin/invitations')
        .set('Authorization', 'Bearer valid-token')
        .send({ email: 'existing@test.com' });

      expect(res.status).toBe(409);
    });

    it('rejects when invitation already pending', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([]); // no user
      c2_query.mockResolvedValueOnce([{ id: 1 }]); // existing invitation

      const res = await request(app)
        .post('/api/admin/invitations')
        .set('Authorization', 'Bearer valid-token')
        .send({ email: 'pending@test.com' });

      expect(res.status).toBe(409);
    });

    it('rejects non-admin user', async () => {
      mockAuthenticated(TEST_USER);
      const res = await request(app)
        .post('/api/admin/invitations')
        .set('Authorization', 'Bearer valid-token')
        .send({ email: 'newuser@test.com' });

      expect(res.status).toBe(403);
    });
  });

  // --- DELETE /api/admin/invitations/:id ---

  describe('DELETE /api/admin/invitations/:id', () => {
    it('deletes an invitation', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce({ affectedRows: 1 });

      const res = await request(app)
        .delete('/api/admin/invitations/1')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects invalid invitation ID', async () => {
      mockAuthenticated(ADMIN_USER);
      const res = await request(app)
        .delete('/api/admin/invitations/abc')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });

    it('rejects non-admin user', async () => {
      mockAuthenticated(TEST_USER);
      const res = await request(app)
        .delete('/api/admin/invitations/1')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });
  });

  // --- GET /api/invite/validate/:token ---

  describe('GET /api/invite/validate/:token', () => {
    it('returns valid for a good token', async () => {
      const futureDate = new Date(Date.now() + 86400000);
      c2_query.mockResolvedValueOnce([{ id: 1, email: 'new@test.com', accepted: false, expires_at: futureDate }]);

      const res = await request(app).get('/api/invite/validate/validtoken123');

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.email).toBe('new@test.com');
    });

    it('returns invalid for expired token', async () => {
      const pastDate = new Date(Date.now() - 86400000);
      c2_query.mockResolvedValueOnce([{ id: 1, email: 'new@test.com', accepted: false, expires_at: pastDate }]);

      const res = await request(app).get('/api/invite/validate/expiredtoken');

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(false);
    });

    it('returns invalid for accepted token', async () => {
      const futureDate = new Date(Date.now() + 86400000);
      c2_query.mockResolvedValueOnce([{ id: 1, email: 'new@test.com', accepted: true, expires_at: futureDate }]);

      const res = await request(app).get('/api/invite/validate/usedtoken');

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(false);
    });

    it('returns invalid for unknown token', async () => {
      c2_query.mockResolvedValueOnce([]); // not found

      const res = await request(app).get('/api/invite/validate/unknowntoken');

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(false);
    });
  });

  // --- GET /api/admin/stats ---

  describe('GET /api/admin/stats', () => {
    it('returns system statistics', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([{
        userCount: 10, workspaceCount: 3, squadCount: 5,
        archiveCount: 8, logCount: 42, pendingInviteCount: 2,
      }]);

      const res = await request(app)
        .get('/api/admin/stats')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.stats.userCount).toBe(10);
      expect(res.body.stats.workspaceCount).toBe(3);
      expect(res.body.stats.squadCount).toBe(5);
      expect(res.body.stats.archiveCount).toBe(8);
      expect(res.body.stats.logCount).toBe(42);
      expect(res.body.stats.pendingInviteCount).toBe(2);
    });

    it('includes online user and active doc counts', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([{
        userCount: 1, workspaceCount: 1, squadCount: 1,
        archiveCount: 1, logCount: 1, pendingInviteCount: 0,
      }]);
      getAllPresence.mockReturnValue({
        1: [{ id: 10, name: 'Alice' }],
        2: [{ id: 10, name: 'Alice' }, { id: 11, name: 'Bob' }],
      });
      getActiveDocCount.mockReturnValue(2);

      const res = await request(app)
        .get('/api/admin/stats')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.stats.onlineUserCount).toBe(2);
      expect(res.body.stats.activeDocCount).toBe(2);
    });

    it('rejects non-admin user', async () => {
      mockAuthenticated(TEST_USER);
      const res = await request(app)
        .get('/api/admin/stats')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });

    it('requires authentication', async () => {
      mockUnauthenticated();
      const res = await request(app).get('/api/admin/stats');
      expect(res.status).toBe(401);
    });
  });

  // --- GET /api/admin/users/:id/permissions ---

  describe('GET /api/admin/users/:id/permissions', () => {
    it('returns user permissions', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([{ id: 5 }]); // user exists
      c2_query.mockResolvedValueOnce([{ create_squad: true, create_archive: false, create_log: true }]);

      const res = await request(app)
        .get('/api/admin/users/5/permissions')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.permissions.create_squad).toBe(true);
      expect(res.body.permissions.create_archive).toBe(false);
    });

    it('returns defaults when no permissions row', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([{ id: 5 }]); // user exists
      c2_query.mockResolvedValueOnce([]); // no perms row

      const res = await request(app)
        .get('/api/admin/users/5/permissions')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.permissions).toEqual({ create_squad: false, create_archive: false, create_log: true });
    });

    it('returns 404 for missing user', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([]); // user not found

      const res = await request(app)
        .get('/api/admin/users/999/permissions')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(404);
    });

    it('rejects invalid user ID', async () => {
      mockAuthenticated(ADMIN_USER);
      const res = await request(app)
        .get('/api/admin/users/abc/permissions')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });

    it('rejects non-admin user', async () => {
      mockAuthenticated(TEST_USER);
      const res = await request(app)
        .get('/api/admin/users/5/permissions')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });
  });

  // --- PUT /api/admin/users/:id/permissions ---

  describe('PUT /api/admin/users/:id/permissions', () => {
    it('updates user permissions', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([{ id: 5 }]); // user exists
      c2_query.mockResolvedValueOnce({ affectedRows: 1 }); // upsert

      const res = await request(app)
        .put('/api/admin/users/5/permissions')
        .set('Authorization', 'Bearer valid-token')
        .send({ create_squad: true, create_archive: true, create_log: false });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 404 for missing user', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([]); // user not found

      const res = await request(app)
        .put('/api/admin/users/999/permissions')
        .set('Authorization', 'Bearer valid-token')
        .send({ create_squad: true, create_archive: false, create_log: true });

      expect(res.status).toBe(404);
    });

    it('rejects invalid user ID', async () => {
      mockAuthenticated(ADMIN_USER);
      const res = await request(app)
        .put('/api/admin/users/abc/permissions')
        .set('Authorization', 'Bearer valid-token')
        .send({ create_squad: true });

      expect(res.status).toBe(400);
    });

    it('rejects non-admin user', async () => {
      mockAuthenticated(TEST_USER);
      const res = await request(app)
        .put('/api/admin/users/5/permissions')
        .set('Authorization', 'Bearer valid-token')
        .send({ create_squad: true });

      expect(res.status).toBe(403);
    });
  });

  // --- PUT /api/admin/users/:id/admin ---

  describe('PUT /api/admin/users/:id/admin', () => {
    it('grants admin status', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([{ id: 5, is_admin: false }]); // user exists
      c2_query.mockResolvedValueOnce({ affectedRows: 1 }); // update

      const res = await request(app)
        .put('/api/admin/users/5/admin')
        .set('Authorization', 'Bearer valid-token')
        .send({ is_admin: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('revokes admin status', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([{ id: 5, is_admin: true }]); // user exists
      c2_query.mockResolvedValueOnce({ affectedRows: 1 }); // update

      const res = await request(app)
        .put('/api/admin/users/5/admin')
        .set('Authorization', 'Bearer valid-token')
        .send({ is_admin: false });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('prevents changing own admin status', async () => {
      mockAuthenticated(ADMIN_USER);
      const res = await request(app)
        .put(`/api/admin/users/${ADMIN_USER.id}/admin`)
        .set('Authorization', 'Bearer valid-token')
        .send({ is_admin: false });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Cannot change your own/);
    });

    it('returns 404 for missing user', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([]); // user not found

      const res = await request(app)
        .put('/api/admin/users/999/admin')
        .set('Authorization', 'Bearer valid-token')
        .send({ is_admin: true });

      expect(res.status).toBe(404);
    });

    it('rejects invalid user ID', async () => {
      mockAuthenticated(ADMIN_USER);
      const res = await request(app)
        .put('/api/admin/users/abc/admin')
        .set('Authorization', 'Bearer valid-token')
        .send({ is_admin: true });

      expect(res.status).toBe(400);
    });

    it('rejects non-admin user', async () => {
      mockAuthenticated(TEST_USER);
      const res = await request(app)
        .put('/api/admin/users/5/admin')
        .set('Authorization', 'Bearer valid-token')
        .send({ is_admin: true });

      expect(res.status).toBe(403);
    });
  });

  // --- GET /api/admin/squads ---

  describe('GET /api/admin/squads', () => {
    it('returns all squads', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([
        { id: 1, name: 'Engineering', workspace_name: 'Acme', member_count: 3, archive_count: 2 },
        { id: 2, name: 'Design', workspace_name: 'Acme', member_count: 1, archive_count: 0 },
      ]);

      const res = await request(app)
        .get('/api/admin/squads')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.squads).toHaveLength(2);
      expect(res.body.squads[0].name).toBe('Engineering');
    });

    it('rejects non-admin user', async () => {
      mockAuthenticated(TEST_USER);
      const res = await request(app)
        .get('/api/admin/squads')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });
  });

  // --- GET /api/admin/squads/:id/members ---

  describe('GET /api/admin/squads/:id/members', () => {
    it('returns squad members with permissions', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([{ id: 1, name: 'Engineering' }]); // squad exists
      c2_query.mockResolvedValueOnce([
        { user_id: 10, name: 'Alice', role: 'owner', can_read: true, can_write: true },
        { user_id: 11, name: 'Bob', role: 'member', can_read: true, can_write: false },
      ]);

      const res = await request(app)
        .get('/api/admin/squads/1/members')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.squad).toBe('Engineering');
      expect(res.body.members).toHaveLength(2);
    });

    it('returns 404 for missing squad', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([]); // squad not found

      const res = await request(app)
        .get('/api/admin/squads/999/members')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(404);
    });

    it('rejects invalid squad ID', async () => {
      mockAuthenticated(ADMIN_USER);
      const res = await request(app)
        .get('/api/admin/squads/abc/members')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });

    it('rejects non-admin user', async () => {
      mockAuthenticated(TEST_USER);
      const res = await request(app)
        .get('/api/admin/squads/1/members')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });
  });

  // --- PUT /api/admin/squads/:id/members/:userId ---

  describe('PUT /api/admin/squads/:id/members/:userId', () => {
    it('updates member role and permissions', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([{ id: 1 }]); // member exists
      c2_query.mockResolvedValueOnce({ affectedRows: 1 }); // update

      const res = await request(app)
        .put('/api/admin/squads/1/members/10')
        .set('Authorization', 'Bearer valid-token')
        .send({ role: 'admin', can_write: true, can_publish: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 404 for missing member', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([]); // no member

      const res = await request(app)
        .put('/api/admin/squads/1/members/999')
        .set('Authorization', 'Bearer valid-token')
        .send({ role: 'admin' });

      expect(res.status).toBe(404);
    });

    it('rejects invalid role', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([{ id: 1 }]); // member exists

      const res = await request(app)
        .put('/api/admin/squads/1/members/10')
        .set('Authorization', 'Bearer valid-token')
        .send({ role: 'superadmin' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Invalid role/);
    });

    it('rejects invalid IDs', async () => {
      mockAuthenticated(ADMIN_USER);
      const res = await request(app)
        .put('/api/admin/squads/abc/members/xyz')
        .set('Authorization', 'Bearer valid-token')
        .send({ role: 'admin' });

      expect(res.status).toBe(400);
    });

    it('rejects non-admin user', async () => {
      mockAuthenticated(TEST_USER);
      const res = await request(app)
        .put('/api/admin/squads/1/members/10')
        .set('Authorization', 'Bearer valid-token')
        .send({ role: 'admin' });

      expect(res.status).toBe(403);
    });
  });

  // --- DELETE /api/admin/squads/:id/members/:userId ---

  describe('DELETE /api/admin/squads/:id/members/:userId', () => {
    it('removes a member', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce({ affectedRows: 1 }); // delete

      const res = await request(app)
        .delete('/api/admin/squads/1/members/10')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 404 when member not found', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce({ affectedRows: 0 }); // nothing deleted

      const res = await request(app)
        .delete('/api/admin/squads/1/members/999')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(404);
    });

    it('rejects invalid IDs', async () => {
      mockAuthenticated(ADMIN_USER);
      const res = await request(app)
        .delete('/api/admin/squads/abc/members/xyz')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });

    it('rejects non-admin user', async () => {
      mockAuthenticated(TEST_USER);
      const res = await request(app)
        .delete('/api/admin/squads/1/members/10')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });
  });

  // --- GET /api/admin/presence ---

  describe('GET /api/admin/presence', () => {
    it('returns empty presence when no users online', async () => {
      mockAuthenticated(ADMIN_USER);

      const res = await request(app)
        .get('/api/admin/presence')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.onlineUsers).toEqual([]);
      expect(res.body.activeDocCount).toBe(0);
    });

    it('returns online users with editing info', async () => {
      mockAuthenticated(ADMIN_USER);
      getAllPresence.mockReturnValue({
        5: [{ id: 10, name: 'Alice', avatar_url: '/a.png' }],
        8: [{ id: 10, name: 'Alice', avatar_url: '/a.png' }, { id: 11, name: 'Bob', avatar_url: null }],
      });
      getActiveDocCount.mockReturnValue(2);
      // log info query
      c2_query.mockResolvedValueOnce([
        { id: 5, title: 'Getting Started', archive_name: 'Docs', archive_id: 1 },
        { id: 8, title: 'API Reference', archive_name: 'Docs', archive_id: 1 },
      ]);

      const res = await request(app)
        .get('/api/admin/presence')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.activeDocCount).toBe(2);
      expect(res.body.onlineUsers).toHaveLength(2);

      const alice = res.body.onlineUsers.find(u => u.name === 'Alice');
      expect(alice.editing).toHaveLength(2);
      const bob = res.body.onlineUsers.find(u => u.name === 'Bob');
      expect(bob.editing).toHaveLength(1);
    });

    it('rejects non-admin user', async () => {
      mockAuthenticated(TEST_USER);
      const res = await request(app)
        .get('/api/admin/presence')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });

    it('requires authentication', async () => {
      mockUnauthenticated();
      const res = await request(app).get('/api/admin/presence');
      expect(res.status).toBe(401);
    });
  });
});

// --- bootstrapInstance ---
// Not a route handler, so it's exercised directly rather than over HTTP.
// This describe block owns its own env/mock lifecycle (it's a sibling of
// `describe('Admin Routes', ...)`, so that block's beforeEach does not
// cascade here) to keep ADMIN_EMAIL/ADMIN_USERNAME explicit rather than
// inherited from whatever the machine's .env happens to hold — CI has none.
describe('bootstrapInstance', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetMocks();
    process.env.ADMIN_EMAIL = 'admin@example.com';
    process.env.ADMIN_USERNAME = 'Admin';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('seeds workspace, squad, archive and welcome doc on an empty install', async () => {
    c2_query.mockResolvedValueOnce([{ n: 0 }]);          // workspace count
    c2_query.mockResolvedValueOnce({ insertId: 11 });    // workspace
    c2_query.mockResolvedValueOnce({ insertId: 22 });    // squad
    c2_query.mockResolvedValueOnce({ insertId: 33 });    // squad_members
    c2_query.mockResolvedValueOnce({ insertId: 44 });    // archive
    c2_query.mockResolvedValueOnce({ insertId: 55 });    // log

    const seeded = await bootstrapInstance(1);

    expect(seeded).toBe(true);

    const archiveCall = c2_query.mock.calls.find(([sql]) => sql.includes('INSERT INTO archives'));
    expect(archiveCall).toBeDefined();
    // squad_id is the second bound param and must not be null, or the
    // archive is orphaned and unreachable by anyone but its creator.
    expect(archiveCall[1][1]).toBe(22);

    const workspaceCall = c2_query.mock.calls.find(([sql]) => sql.includes('INSERT INTO workspaces'));
    expect(workspaceCall[1][1]).toBe(process.env.ADMIN_EMAIL);

    // The five writes must run inside withTransaction (not as five loose
    // c2_query calls), or a failure partway through leaves a partial seed
    // that the COUNT(*) guard mistakes for a completed install on the next
    // boot. The default test mock (tests/setup.js) forwards straight to
    // c2_query, which is why the assertions above still see the writes.
    expect(withTransaction).toHaveBeenCalledTimes(1);
  });

  it('does nothing when a workspace already exists', async () => {
    c2_query.mockResolvedValueOnce([{ n: 3 }]);

    const seeded = await bootstrapInstance(1);

    expect(seeded).toBe(false);
    expect(c2_query).toHaveBeenCalledTimes(1);
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it('does nothing when no admin id is supplied', async () => {
    const seeded = await bootstrapInstance(null);

    expect(seeded).toBe(false);
    expect(c2_query).not.toHaveBeenCalled();
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it('propagates the failure and never reports success when a write fails mid-seed', async () => {
    // Simulates what a real rollback leaves behind: withTransaction rolls
    // back and rethrows (see tests/mysql_connect.test.js), so the caller
    // sees the original error and no rows exist for the next boot's
    // COUNT(*) guard to trip on.
    c2_query.mockResolvedValueOnce([{ n: 0 }]); // workspace count
    withTransaction.mockRejectedValueOnce(new Error('archive insert failed'));

    await expect(bootstrapInstance(1)).rejects.toThrow('archive insert failed');
  });
});

// --- ensureAdminUser ---
// Not a route handler either. Its return value is the Step 3 deliverable
// server.js now depends on (server.js passes it straight into
// bootstrapInstance), so both branches — existing admin found vs. admin
// created fresh — need direct coverage of what id comes back, not just
// that a UPDATE/INSERT happened.
describe('ensureAdminUser', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetMocks();
    process.env.ADMIN_USERNAME = 'Admin';
    process.env.ADMIN_PASSWORD = 'correct horse battery staple';
    process.env.ADMIN_EMAIL = 'admin@example.com';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns the existing user id and syncs credentials when the admin already exists', async () => {
    c2_query.mockResolvedValueOnce([{ id: 5, is_admin: true }]); // SELECT existing
    c2_query.mockResolvedValueOnce({ affectedRows: 1 });          // UPDATE

    const id = await ensureAdminUser();

    expect(id).toBe(5);
    const updateCall = c2_query.mock.calls.find(([sql]) => sql.includes('UPDATE users'));
    expect(updateCall).toBeDefined();
    expect(updateCall[1][1]).toBe('admin@example.com'); // email
    expect(updateCall[1][2]).toBe(5);                     // WHERE id = ?
  });

  it('creates the admin user, seeds default permissions, and returns the new id when none exists', async () => {
    c2_query.mockResolvedValueOnce([]);                 // SELECT: no existing admin
    c2_query.mockResolvedValueOnce({ insertId: 42 });   // INSERT users
    c2_query.mockResolvedValueOnce({ insertId: 1 });    // createDefaultPermissions INSERT

    const id = await ensureAdminUser();

    expect(id).toBe(42);
    const permissionsCall = c2_query.mock.calls.find(([sql]) => sql.includes('INSERT INTO permissions'));
    expect(permissionsCall).toBeDefined();
    expect(permissionsCall[1]).toEqual([42]);
  });
});
