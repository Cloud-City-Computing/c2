import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { c2_query } from '../../mysql_connect.js';
import { sendEmail } from '../../services/email.js';
import { mockAuthenticated, mockUnauthenticated, resetMocks, TEST_USER } from '../helpers.js';

const ADMIN_USER = { ...TEST_USER, is_admin: true };

describe('Admin Routes', () => {
  beforeEach(() => {
    resetMocks();
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

    it('returns 500 when email fails to send', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([]); // no user
      c2_query.mockResolvedValueOnce([]); // no invitation
      c2_query.mockResolvedValueOnce({ insertId: 1 }); // insert
      sendEmail.mockRejectedValueOnce(new Error('SMTP down'));

      const res = await request(app)
        .post('/api/admin/invitations')
        .set('Authorization', 'Bearer valid-token')
        .send({ email: 'newuser@test.com' });

      expect(res.status).toBe(500);
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
      c2_query.mockResolvedValueOnce([{ userCount: 10 }]);
      c2_query.mockResolvedValueOnce([{ workspaceCount: 3 }]);
      c2_query.mockResolvedValueOnce([{ squadCount: 5 }]);
      c2_query.mockResolvedValueOnce([{ archiveCount: 8 }]);
      c2_query.mockResolvedValueOnce([{ logCount: 42 }]);
      c2_query.mockResolvedValueOnce([{ pendingInviteCount: 2 }]);

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
});
