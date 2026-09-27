import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
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

  // --- POST /api/admin/users/:id/2fa/reset ---

  describe('POST /api/admin/users/:id/2fa/reset', () => {
    it('clears the 2FA method, secret, codes, and setup/confirm tokens, then notifies the user', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query
        .mockResolvedValueOnce([{ id: 5, name: 'bob', two_factor_method: 'totp' }]) // user lookup
        .mockResolvedValueOnce({ affectedRows: 1 }) // UPDATE users
        .mockResolvedValueOnce({ affectedRows: 2 }) // DELETE two_factor_codes
        .mockResolvedValueOnce({ affectedRows: 1 }) // DELETE password_reset_tokens
        .mockResolvedValueOnce({ insertId: 300 }); // INSERT INTO notifications

      const res = await request(app)
        .post('/api/admin/users/5/2fa/reset')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const calls = c2_query.mock.calls;

      const updateUsers = calls.find((c) => /UPDATE users SET two_factor_method/i.test(c[0]));
      expect(updateUsers).toBeTruthy();
      // Pinned end-to-end: both columns cleared, unconditional on the
      // current method (no "AND two_factor_method = ..."), scoped by a
      // bound id (not a hardcoded literal).
      expect(updateUsers[0]).toMatch(
        /^UPDATE users SET two_factor_method\s*=\s*'none',\s*totp_secret\s*=\s*NULL WHERE id = \?$/i
      );
      expect(updateUsers[1]).toEqual([5]);

      const deleteCodes = calls.find((c) => /DELETE FROM two_factor_codes/i.test(c[0]));
      expect(deleteCodes).toBeTruthy();
      // Pinned: scoped to the target user, not an unfiltered wipe.
      expect(deleteCodes[0]).toMatch(/^DELETE FROM two_factor_codes WHERE user_id = \?$/i);
      expect(deleteCodes[1]).toEqual([5]);

      const deleteTokens = calls.find((c) => /DELETE FROM password_reset_tokens/i.test(c[0]));
      expect(deleteTokens).toBeTruthy();
      // Pinned: scoped to the target user AND unused only, not every user's
      // tokens and not the used ones too.
      expect(deleteTokens[0]).toMatch(
        /^DELETE FROM password_reset_tokens WHERE user_id = \?\s+AND used = FALSE$/i
      );
      expect(deleteTokens[1]).toEqual([5]);

      const notifInsert = calls.find((c) => /INSERT INTO notifications/i.test(c[0]));
      expect(notifInsert).toBeTruthy();
      expect(notifInsert[1]).toContain(5); // recipient is the target user
      expect(notifInsert[1]).toContain('admin_2fa_reset');
    });

    it('does not notify when an admin resets their own 2FA', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query
        .mockResolvedValueOnce([{ id: ADMIN_USER.id, name: ADMIN_USER.name, two_factor_method: 'email' }])
        .mockResolvedValueOnce({ affectedRows: 1 })
        .mockResolvedValueOnce({ affectedRows: 0 })
        .mockResolvedValueOnce({ affectedRows: 0 });

      const res = await request(app)
        .post(`/api/admin/users/${ADMIN_USER.id}/2fa/reset`)
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const notifInsert = c2_query.mock.calls.find((c) => /INSERT INTO notifications/i.test(c[0]));
      expect(notifInsert).toBeFalsy();
    });

    it('returns 404 for a user that does not exist', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([]); // not found

      const res = await request(app)
        .post('/api/admin/users/999/2fa/reset')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(404);
    });

    it('rejects an invalid user ID', async () => {
      mockAuthenticated(ADMIN_USER);
      const res = await request(app)
        .post('/api/admin/users/abc/2fa/reset')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });

    it('rejects a non-admin user', async () => {
      mockAuthenticated(TEST_USER);
      const res = await request(app)
        .post('/api/admin/users/5/2fa/reset')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });

    it('requires authentication', async () => {
      mockUnauthenticated();
      const res = await request(app).post('/api/admin/users/5/2fa/reset');
      expect(res.status).toBe(401);
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

    it('persists the squad, role and flags when a squad is given', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([]);                 // no existing user
      c2_query.mockResolvedValueOnce([]);                 // no existing invitation
      c2_query.mockResolvedValueOnce([{ id: 7 }]);        // squad exists
      c2_query.mockResolvedValueOnce({ insertId: 1 });    // insert invitation

      const res = await request(app)
        .post('/api/admin/invitations')
        .set('Authorization', 'Bearer valid-token')
        .send({
          email: 'newuser@test.com',
          squadId: 7,
          role: 'admin',
          permissions: { can_write: true, can_create_log: true },
        });

      expect(res.status).toBe(201);
      const insert = c2_query.mock.calls[3];
      expect(insert[0]).toContain('INSERT INTO user_invitations');
      // email, token, invited_by, squad_id, role, then the seven flags.
      expect(insert[1][3]).toBe(7);
      expect(insert[1][4]).toBe('admin');
      expect(insert[1].slice(5)).toEqual([true, true, true, false, false, false, false]);
    });

    it('stores a NULL squad and default flags when no squad is given', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([]);
      c2_query.mockResolvedValueOnce([]);
      c2_query.mockResolvedValueOnce({ insertId: 1 });

      const res = await request(app)
        .post('/api/admin/invitations')
        .set('Authorization', 'Bearer valid-token')
        .send({ email: 'newuser@test.com' });

      expect(res.status).toBe(201);
      const insert = c2_query.mock.calls[2];
      expect(insert[1][3]).toBeNull();
      expect(insert[1][4]).toBe('member');
      expect(insert[1].slice(5)).toEqual([true, false, false, false, false, false, false]);
    });

    it('rejects a malformed squad id before it touches the database', async () => {
      mockAuthenticated(ADMIN_USER);

      const res = await request(app)
        .post('/api/admin/invitations')
        .set('Authorization', 'Bearer valid-token')
        .send({ email: 'newuser@test.com', squadId: 'nope' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/squad/i);
      expect(c2_query).not.toHaveBeenCalled();
    });

    it('404s when the squad does not exist', async () => {
      mockAuthenticated(ADMIN_USER);
      c2_query.mockResolvedValueOnce([]);
      c2_query.mockResolvedValueOnce([]);
      c2_query.mockResolvedValueOnce([]);   // squad lookup finds nothing

      const res = await request(app)
        .post('/api/admin/invitations')
        .set('Authorization', 'Bearer valid-token')
        .send({ email: 'newuser@test.com', squadId: 99 });

      expect(res.status).toBe(404);
    });

    it('rejects an unknown role before it touches the database', async () => {
      mockAuthenticated(ADMIN_USER);

      const res = await request(app)
        .post('/api/admin/invitations')
        .set('Authorization', 'Bearer valid-token')
        .send({ email: 'newuser@test.com', squadId: 7, role: 'superuser' });

      expect(res.status).toBe(400);
      expect(c2_query).not.toHaveBeenCalled();
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

  it('seeds workspace, squad, squad ownership, archive and welcome doc on an empty install', async () => {
    c2_query.mockResolvedValueOnce([{ workspaces: 0, archives: 0, logs: 0 }]); // content guard
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

    // owner_id is a users FK, so the seeded workspace is owned by the admin's
    // row id. It used to store ADMIN_EMAIL, which silently detached the
    // workspace whenever that address changed.
    const workspaceCall = c2_query.mock.calls.find(([sql]) => sql.includes('INSERT INTO workspaces'));
    expect(workspaceCall[0]).toContain('owner_id');
    expect(workspaceCall[1][1]).toBe(1); // the admin user id passed to bootstrapInstance

    // The squad-ownership row. Without it the admin is not a member of the
    // squad the seeded archive hangs off, so clauses 4-7 of readAccessWhere
    // never fire for anyone the admin later adds. Deleting the
    // addSquadOwnerMember call used to leave the whole suite green.
    const memberCall = c2_query.mock.calls.find(([sql]) => sql.includes('INSERT INTO squad_members'));
    expect(memberCall).toBeDefined();
    expect(memberCall[1]).toEqual([22, 1]);           // (squad id, admin id)
    expect(memberCall[0]).toMatch(/'owner'/);

    // The welcome document, the headline of the whole first-boot seed, and
    // the other write that could vanish silently.
    const logCall = c2_query.mock.calls.find(([sql]) => sql.includes('INSERT INTO logs'));
    expect(logCall).toBeDefined();
    expect(logCall[1][0]).toBe(44);                   // archive_id, from the archive insert
    expect(logCall[1][1]).toBe('Welcome to Cloud Codex');
    expect(logCall[1][2]).toMatch(/Welcome to Cloud Codex/);
    expect(logCall[1][3]).toBe(1);                    // created_by
    expect(logCall[1][4]).toBe(1);                    // updated_by

    // Five writes, no more and no fewer, plus the single guard read.
    expect(c2_query).toHaveBeenCalledTimes(6);

    // The five writes must run inside withTransaction (not as five loose
    // c2_query calls), or a failure partway through leaves a partial seed
    // that the guard mistakes for a completed install on the next boot. The
    // default test mock (tests/setup.js) forwards straight to c2_query,
    // which is why the assertions above still see the writes. The test
    // below overrides that to prove the writes really are on the
    // transaction's executor.
    expect(withTransaction).toHaveBeenCalledTimes(1);
  });

  it('runs every seed write on the transaction executor, not the pool', async () => {
    // The global withTransaction mock forwards with `fn(c2_query)`, so the
    // executor the code receives IS the c2_query mock and `await query(...)`
    // is indistinguishable from `await c2_query(...)` to every assertion
    // above. Dropping the third argument at the addSquadOwnerMember call
    // would silently push that insert onto a different pooled connection,
    // outside the transaction, with the suite still green. A distinct
    // executor spy is the only thing that can tell them apart.
    const txQuery = vi.fn()
      .mockResolvedValueOnce({ insertId: 11 })   // workspace
      .mockResolvedValueOnce({ insertId: 22 })   // squad
      .mockResolvedValueOnce({ insertId: 33 })   // squad_members
      .mockResolvedValueOnce({ insertId: 44 })   // archive
      .mockResolvedValueOnce({ insertId: 55 });  // log
    c2_query.mockResolvedValueOnce([{ workspaces: 0, archives: 0, logs: 0 }]); // content guard
    withTransaction.mockImplementationOnce(fn => fn(txQuery));

    const seeded = await bootstrapInstance(1);

    expect(seeded).toBe(true);

    // All five writes landed on the transaction's executor.
    const txSql = txQuery.mock.calls.map(([sql]) => sql);
    expect(txQuery).toHaveBeenCalledTimes(5);
    expect(txSql.filter(sql => sql.includes('INSERT INTO workspaces'))).toHaveLength(1);
    expect(txSql.filter(sql => sql.includes('INSERT INTO squads'))).toHaveLength(1);
    expect(txSql.filter(sql => sql.includes('INSERT INTO squad_members'))).toHaveLength(1);
    expect(txSql.filter(sql => sql.includes('INSERT INTO archives'))).toHaveLength(1);
    expect(txSql.filter(sql => sql.includes('INSERT INTO logs'))).toHaveLength(1);

    // …and c2_query saw only the guard read. Any write here is a write that
    // escaped the transaction.
    expect(c2_query).toHaveBeenCalledTimes(1);
    expect(c2_query.mock.calls[0][0]).toMatch(/COUNT\(\*\)/);
    expect(c2_query.mock.calls.some(([sql]) => /INSERT/i.test(sql))).toBe(false);
  });

  it('does nothing when a workspace already exists', async () => {
    c2_query.mockResolvedValueOnce([{ workspaces: 3, archives: 4, logs: 9 }]);

    const seeded = await bootstrapInstance(1);

    expect(seeded).toBe(false);
    expect(c2_query).toHaveBeenCalledTimes(1);
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it('does nothing when workspaces are gone but orphaned archives and logs survive', async () => {
    // DELETE /api/workspaces/:id plus archives.squad_id ON DELETE SET NULL
    // leaves archives and their logs alive with no workspace above them. A
    // workspaces-only guard reads that as a fresh install and seeds a second
    // workspace alongside the survivors.
    c2_query.mockResolvedValueOnce([{ workspaces: 0, archives: 2, logs: 7 }]);

    const seeded = await bootstrapInstance(1);

    expect(seeded).toBe(false);
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it('does nothing when only orphaned logs survive', async () => {
    c2_query.mockResolvedValueOnce([{ workspaces: 0, archives: 0, logs: 1 }]);

    expect(await bootstrapInstance(1)).toBe(false);
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
    c2_query.mockResolvedValueOnce([{ workspaces: 0, archives: 0, logs: 0 }]); // content guard
    withTransaction.mockRejectedValueOnce(new Error('archive insert failed'));

    await expect(bootstrapInstance(1)).rejects.toThrow('archive insert failed');
  });
});

// --- ensureAdminUser ---
// Not a route handler either. server.js passes its return value straight into
// bootstrapInstance, so every branch needs direct coverage of what comes back,
// not just that an UPDATE or INSERT happened.
//
// The sync creates or syncs, and never promotes (GHSA-w8q3-r34w-3pjh). A row
// matched by ADMIN_USERNAME or ADMIN_EMAIL that is not already an admin is
// refused with nothing written. users.name and users.email are each UNIQUE, so
// the two can match two different rows: an admin who renamed while a member
// took the old name, or changed address while a member took the old one. The
// mock cannot say which row matched which way (that is the server's job, and
// tests/integration/admin-sync.test.js proves it on MySQL); what these tests
// pin is that every row the lookup returns is checked, in either order.
describe('ensureAdminUser', () => {
  const originalEnv = { ...process.env };
  const PASSWORD = 'correct horse battery staple';
  let errorSpy;

  beforeEach(() => {
    resetMocks();
    process.env.ADMIN_USERNAME = 'Admin';
    process.env.ADMIN_PASSWORD = PASSWORD;
    process.env.ADMIN_EMAIL = 'admin@example.com';
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    process.env = { ...originalEnv };
  });

  /** Every line the sync logged. */
  const logLines = () => errorSpy.mock.calls.map((args) => args.join(' '));

  /** Every call that could change a row. */
  const writes = () => c2_query.mock.calls.filter(([sql]) => /^\s*(UPDATE|INSERT|DELETE|REPLACE)\b/i.test(sql));

  it('creates the admin user, seeds default permissions, and returns the new id when no account matches', async () => {
    c2_query.mockResolvedValueOnce([]);                 // SELECT: no account matches
    c2_query.mockResolvedValueOnce({ insertId: 42 });   // INSERT users
    c2_query.mockResolvedValueOnce({ insertId: 1 });    // createDefaultPermissions INSERT

    const id = await ensureAdminUser();

    expect(id).toBe(42);
    const insertCall = c2_query.mock.calls.find(([sql]) => sql.includes('INSERT INTO users'));
    expect(insertCall[0]).toMatch(/is_admin/);
    expect(insertCall[1][0]).toBe('Admin');
    expect(insertCall[1][2]).toBe('admin@example.com');
    expect(await bcrypt.compare(PASSWORD, insertCall[1][1])).toBe(true);
    const permissionsCall = c2_query.mock.calls.find(([sql]) => sql.includes('INSERT INTO permissions'));
    expect(permissionsCall).toBeDefined();
    expect(permissionsCall[1]).toEqual([42]);

    // One boot line saying what the sync did, and never the password.
    expect(logLines()).toHaveLength(1);
    expect(logLines()[0]).toMatch(/admin sync: created Admin \/ admin@example\.com .*user 42/);
    expect(logLines()[0]).not.toContain(PASSWORD);
  });

  it('syncs an existing admin: .env resets its email and password, and is_admin is not written', async () => {
    c2_query.mockResolvedValueOnce([{ id: 5, is_admin: 1 }]); // SELECT: the admin
    c2_query.mockResolvedValueOnce({ affectedRows: 1 });       // UPDATE

    const id = await ensureAdminUser();

    expect(id).toBe(5);
    const updates = writes();
    expect(updates).toHaveLength(1);
    const [sql, params] = updates[0];
    expect(sql).toMatch(/^\s*UPDATE users SET/);
    // The row is already an admin, so the sync has no reason to write the flag,
    // and an UPDATE that cannot set it cannot promote anyone.
    expect(sql).not.toMatch(/is_admin/);
    expect(await bcrypt.compare(PASSWORD, params[0])).toBe(true); // password_hash
    expect(params[1]).toBe('admin@example.com');                  // email
    expect(params[2]).toBe(5);                                    // WHERE id = ?

    expect(logLines()).toHaveLength(1);
    expect(logLines()[0]).toMatch(/admin sync: synced Admin \/ admin@example\.com .*user 5/);
    expect(logLines()[0]).not.toContain(PASSWORD);
  });

  it('asks for every account matching by name or by email, not only the first', async () => {
    c2_query.mockResolvedValueOnce([]);
    c2_query.mockResolvedValueOnce({ insertId: 42 });
    c2_query.mockResolvedValueOnce({ insertId: 1 });

    await ensureAdminUser();

    const [sql, params] = c2_query.mock.calls[0];
    expect(sql).toMatch(/^\s*SELECT id, is_admin FROM users WHERE LOWER\(name\) = LOWER\(\?\) OR email = \?/);
    // A LIMIT here would let the server hand back the admin row and hide a
    // member who holds the other identifier.
    expect(sql).not.toMatch(/LIMIT/i);
    expect(params).toEqual(['Admin', 'admin@example.com']);
  });

  it('refuses a non-admin matched by name: returns null and logs one line naming it', async () => {
    // A member whose name is ADMIN_USERNAME, and no admin row matching at all.
    c2_query.mockResolvedValueOnce([{ id: 9, is_admin: 0 }]);

    const id = await ensureAdminUser();

    expect(id).toBeNull();
    expect(logLines()).toHaveLength(1);
    expect(logLines()[0]).toContain(
      'admin sync: Admin / admin@example.com matches an existing non-admin account (user 9), ' +
      'refusing to promote it. Promote it in the admin console if that is intended.'
    );
    expect(logLines()[0]).not.toContain(PASSWORD);
  });

  it('refuses a non-admin matched by email even while the admin still holds the name', async () => {
    // The admin changed address and a member took the old one: the admin row
    // matches by name, the member by email, and the admin row comes back first.
    c2_query.mockResolvedValueOnce([{ id: 2, is_admin: 1 }, { id: 9, is_admin: 0 }]);

    const id = await ensureAdminUser();

    expect(id).toBeNull();
    expect(logLines()).toHaveLength(1);
    expect(logLines()[0]).toContain('matches an existing non-admin account (user 9), refusing to promote it.');
    expect(logLines()[0]).not.toContain(PASSWORD);
  });

  it.each([
    ['a member holds the name, nothing else matches', [{ id: 9, is_admin: 0 }]],
    ['the admin holds the name, a member the email', [{ id: 2, is_admin: 1 }, { id: 9, is_admin: 0 }]],
    ['a member holds the name and comes back first, the admin holds the email', [{ id: 4, is_admin: 0 }, { id: 7, is_admin: 1 }]],
  ])('a refusal writes nothing: %s', async (_label, rows) => {
    c2_query.mockResolvedValueOnce(rows);
    const hashSpy = vi.spyOn(bcrypt, 'hash');
    let result;
    let hashes;
    try {
      result = await ensureAdminUser();
      // Read before mockRestore, which clears the spy's call history.
      hashes = hashSpy.mock.calls.length;
    } finally {
      hashSpy.mockRestore();
    }

    expect(result).toBeNull();
    // The lookup is the only query: no UPDATE of either row, no INSERT of a
    // new admin beside them, and no password hashed for either.
    expect(c2_query).toHaveBeenCalledTimes(1);
    expect(writes()).toEqual([]);
    expect(hashes).toBe(0);
  });
});
