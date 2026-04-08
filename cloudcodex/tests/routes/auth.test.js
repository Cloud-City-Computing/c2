import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import app from '../../app.js';
import { c2_query, validateAndAutoLogin, generateSessionToken } from '../../mysql_connect.js';
import { sendEmail } from '../../services/email.js';
import { mockAuthenticated, mockUnauthenticated, resetMocks, TEST_USER } from '../helpers.js';

// Pre-compute a bcrypt hash for login tests (low rounds for speed)
const TEST_PASSWORD = 'password123';
const TEST_HASH = bcrypt.hashSync(TEST_PASSWORD, 1);

describe('Auth Routes', () => {
  beforeEach(() => {
    resetMocks();
  });

  // ── POST /api/create-account ──────────────────────────────

  describe('POST /api/create-account', () => {
    it('creates account with valid input', async () => {
      // SELECT invitation by token
      c2_query.mockResolvedValueOnce([{ id: 1, invite_email: 'new@test.com', accepted: false, expires_at: new Date(Date.now() + 60000) }]);
      c2_query.mockResolvedValueOnce([]);             // SELECT duplicate username check
      c2_query.mockResolvedValueOnce([]);             // SELECT duplicate email check
      c2_query.mockResolvedValueOnce({ insertId: 10 }); // INSERT user
      generateSessionToken.mockResolvedValueOnce('new-token');
      c2_query.mockResolvedValueOnce([]); // INSERT permissions
      c2_query.mockResolvedValueOnce([]); // UPDATE invitation accepted

      const res = await request(app)
        .post('/api/create-account')
        .send({ username: 'newuser', password: 'Password1!', email: 'new@test.com', inviteToken: 'valid-token' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBe('new-token');
      expect(res.body.user.name).toBe('newuser');
    });

    it('rejects missing fields', async () => {
      const res = await request(app)
        .post('/api/create-account')
        .send({ username: 'user' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('rejects missing invite token', async () => {
      const res = await request(app)
        .post('/api/create-account')
        .send({ username: 'newuser', password: 'Password1!', email: 'new@test.com' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/invitation/i);
    });

    it('rejects invalid username format', async () => {
      // SELECT invitation by token
      c2_query.mockResolvedValueOnce([{ id: 1, invite_email: 'ok@test.com', accepted: false, expires_at: new Date(Date.now() + 60000) }]);

      const res = await request(app)
        .post('/api/create-account')
        .send({ username: 'bad user!', password: 'Password1!', email: 'ok@test.com', inviteToken: 'valid-token' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/username/i);
    });

    it('rejects invalid email', async () => {
      // SELECT invitation by token
      c2_query.mockResolvedValueOnce([{ id: 1, invite_email: 'not-an-email', accepted: false, expires_at: new Date(Date.now() + 60000) }]);

      const res = await request(app)
        .post('/api/create-account')
        .send({ username: 'user123', password: 'Password1!', email: 'not-an-email', inviteToken: 'valid-token' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/email/i);
    });

    it('rejects weak password', async () => {
      // SELECT invitation by token
      c2_query.mockResolvedValueOnce([{ id: 1, invite_email: 'ok@test.com', accepted: false, expires_at: new Date(Date.now() + 60000) }]);

      const res = await request(app)
        .post('/api/create-account')
        .send({ username: 'user123', password: 'short', email: 'ok@test.com', inviteToken: 'valid-token' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/password/i);
    });

    it('rejects duplicate username', async () => {
      // SELECT invitation by token
      c2_query.mockResolvedValueOnce([{ id: 1, invite_email: 'new@test.com', accepted: false, expires_at: new Date(Date.now() + 60000) }]);
      c2_query.mockResolvedValueOnce([{ id: 3 }]); // SELECT duplicate username check — found existing

      const res = await request(app)
        .post('/api/create-account')
        .send({ username: 'newuser', password: 'Password1!', email: 'new@test.com', inviteToken: 'valid-token' });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/username.*taken/i);
    });

    it('rejects duplicate email', async () => {
      // SELECT invitation by token
      c2_query.mockResolvedValueOnce([{ id: 1, invite_email: 'existing@test.com', accepted: false, expires_at: new Date(Date.now() + 60000) }]);
      c2_query.mockResolvedValueOnce([]);           // SELECT duplicate username check — not found
      c2_query.mockResolvedValueOnce([{ id: 5 }]); // SELECT duplicate email check — found existing

      const res = await request(app)
        .post('/api/create-account')
        .send({ username: 'newuser', password: 'Password1!', email: 'existing@test.com', inviteToken: 'valid-token' });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/already exists/i);
    });
  });

  // ── POST /api/login ───────────────────────────────────────

  describe('POST /api/login', () => {
    it('rejects missing credentials', async () => {
      const res = await request(app)
        .post('/api/login')
        .send({});

      expect(res.status).toBe(400);
    });

    it('rejects invalid credentials', async () => {
      // No user found
      c2_query.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/login')
        .send({ username: 'noone', password: 'badpassword1' });

      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/invalid credentials/i);
    });
  });

  // ── POST /api/logout ──────────────────────────────────────

  describe('POST /api/logout', () => {
    it('logs out with valid token', async () => {
      c2_query.mockResolvedValueOnce([]); // DELETE session

      const res = await request(app)
        .post('/api/logout')
        .send({ token: 'some-token' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects missing token', async () => {
      const res = await request(app)
        .post('/api/logout')
        .send({});

      expect(res.status).toBe(400);
    });
  });

  // ── POST /api/validate-session ────────────────────────────

  describe('POST /api/validate-session', () => {
    it('returns valid=true for valid session', async () => {
      validateAndAutoLogin.mockResolvedValueOnce(TEST_USER);

      const res = await request(app)
        .post('/api/validate-session')
        .send({ token: 'good-token' });

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.user.id).toBe(TEST_USER.id);
    });

    it('returns valid=false for invalid session', async () => {
      validateAndAutoLogin.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/validate-session')
        .send({ token: 'bad-token' });

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(false);
    });

    it('rejects missing token', async () => {
      const res = await request(app)
        .post('/api/validate-session')
        .send({});

      expect(res.status).toBe(400);
    });
  });

  // ── POST /api/get-user ────────────────────────────────────

  describe('POST /api/get-user', () => {
    it('returns user and permissions', async () => {
      validateAndAutoLogin.mockResolvedValueOnce(TEST_USER);
      c2_query.mockResolvedValueOnce([{ id: 1, name: 'testuser', email: 'test@example.com' }]); // SELECT user
      c2_query.mockResolvedValueOnce([{ create_team: true, create_project: true, create_page: true }]); // SELECT perms

      const res = await request(app)
        .post('/api/get-user')
        .send({ token: 'tok', userId: 1 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.name).toBe('testuser');
      expect(res.body.permissions).toBeDefined();
    });

    it('rejects mismatched userId', async () => {
      validateAndAutoLogin.mockResolvedValueOnce(TEST_USER);

      const res = await request(app)
        .post('/api/get-user')
        .send({ token: 'tok', userId: 999 });

      expect(res.status).toBe(401);
    });

    it('rejects missing fields', async () => {
      const res = await request(app)
        .post('/api/get-user')
        .send({});

      expect(res.status).toBe(400);
    });
  });

  // ── POST /api/update-account ──────────────────────────────

  describe('POST /api/update-account', () => {
    it('updates name for valid user', async () => {
      validateAndAutoLogin.mockResolvedValueOnce(TEST_USER);
      c2_query.mockResolvedValueOnce([]); // UPDATE user

      const res = await request(app)
        .post('/api/update-account')
        .send({ token: 'tok', userId: 1, name: 'newname' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects update with no fields', async () => {
      validateAndAutoLogin.mockResolvedValueOnce(TEST_USER);

      const res = await request(app)
        .post('/api/update-account')
        .send({ token: 'tok', userId: 1 });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/no fields/i);
    });

    it('rejects weak password on update', async () => {
      validateAndAutoLogin.mockResolvedValueOnce(TEST_USER);

      const res = await request(app)
        .post('/api/update-account')
        .send({ token: 'tok', userId: 1, password: 'short' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/password/i);
    });

    it('rejects invalid email on update', async () => {
      validateAndAutoLogin.mockResolvedValueOnce(TEST_USER);

      const res = await request(app)
        .post('/api/update-account')
        .send({ token: 'tok', userId: 1, email: 'bad' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/email/i);
    });

    it('rejects duplicate email on update', async () => {
      validateAndAutoLogin.mockResolvedValueOnce(TEST_USER);
      c2_query.mockResolvedValueOnce([{ id: 5 }]); // dup email found

      const res = await request(app)
        .post('/api/update-account')
        .send({ token: 'tok', userId: 1, email: 'taken@example.com' });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/already exists/i);
    });

    it('rejects duplicate username on update', async () => {
      validateAndAutoLogin.mockResolvedValueOnce(TEST_USER);
      c2_query.mockResolvedValueOnce([{ id: 5 }]); // dup name found

      const res = await request(app)
        .post('/api/update-account')
        .send({ token: 'tok', userId: 1, name: 'takenuser' });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/taken/i);
    });
  });

  // ── GET /api/users/search ─────────────────────────────────

  describe('GET /api/users/search', () => {
    it('returns users matching query', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([
        { id: 2, name: 'alice', email: 'alice@test.com' },
      ]);

      const res = await request(app)
        .get('/api/users/search?q=ali')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.users).toHaveLength(1);
    });

    it('returns empty for short query', async () => {
      mockAuthenticated();

      const res = await request(app)
        .get('/api/users/search?q=a')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.users).toEqual([]);
    });

    it('requires authentication', async () => {
      mockUnauthenticated();

      const res = await request(app)
        .get('/api/users/search?q=test')
        .set('Authorization', 'Bearer bad-token');

      expect(res.status).toBe(401);
    });
  });

  // ── GET /api/permissions ──────────────────────────────────

  describe('GET /api/permissions', () => {
    it('returns user permissions', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ create_team: true, create_project: true, create_page: true }]);

      const res = await request(app)
        .get('/api/permissions')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.permissions.create_team).toBe(true);
    });

    it('returns defaults when no permissions row exists', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]); // no row found

      const res = await request(app)
        .get('/api/permissions')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.permissions).toBeDefined();
    });
  });

  // ── POST /api/forgot-password ─────────────────────────────

  describe('POST /api/forgot-password', () => {
    it('always returns success (prevents email enumeration)', async () => {
      c2_query.mockResolvedValueOnce([]); // no user found

      const res = await request(app)
        .post('/api/forgot-password')
        .send({ email: 'unknown@test.com' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('sends email when user exists', async () => {
      c2_query
        .mockResolvedValueOnce([{ id: 1 }])   // user found
        .mockResolvedValueOnce([])              // invalidate old tokens
        .mockResolvedValueOnce([]);             // insert token

      const res = await request(app)
        .post('/api/forgot-password')
        .send({ email: 'test@example.com' });

      expect(res.status).toBe(200);
      expect(sendEmail).toHaveBeenCalled();
    });

    it('rejects invalid email format', async () => {
      const res = await request(app)
        .post('/api/forgot-password')
        .send({ email: 'bad' });

      expect(res.status).toBe(400);
    });
  });

  // ── POST /api/reset-password ──────────────────────────────

  describe('POST /api/reset-password', () => {
    it('resets password with valid token', async () => {
      c2_query.mockResolvedValueOnce([{
        id: 1,
        user_id: 1,
        expires_at: new Date(Date.now() + 3600000),
        used: false,
      }]);
      c2_query.mockResolvedValueOnce([]); // UPDATE user password
      c2_query.mockResolvedValueOnce([]); // mark token used
      c2_query.mockResolvedValueOnce([]); // DELETE sessions

      const res = await request(app)
        .post('/api/reset-password')
        .send({ token: 'valid-reset-token', password: 'NewPassword1!' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects expired token', async () => {
      c2_query.mockResolvedValueOnce([{
        id: 1,
        user_id: 1,
        expires_at: new Date(Date.now() - 1000), // expired
        used: false,
      }]);

      const res = await request(app)
        .post('/api/reset-password')
        .send({ token: 'expired-token', password: 'newpassword123' });

      expect(res.status).toBe(400);
    });

    it('rejects short password', async () => {
      const res = await request(app)
        .post('/api/reset-password')
        .send({ token: 'tok', password: 'short' });

      expect(res.status).toBe(400);
    });

    it('rejects missing fields', async () => {
      const res = await request(app)
        .post('/api/reset-password')
        .send({});

      expect(res.status).toBe(400);
    });
  });

  // ── POST /api/2fa/verify ──────────────────────────────────

  describe('POST /api/2fa/verify', () => {
    it('rejects missing fields', async () => {
      const res = await request(app)
        .post('/api/2fa/verify')
        .send({});

      expect(res.status).toBe(400);
    });

    it('rejects expired 2FA token', async () => {
      c2_query.mockResolvedValueOnce([{
        id: 1,
        user_id: 1,
        expires_at: new Date(Date.now() - 1000),
        used: false,
      }]);

      const res = await request(app)
        .post('/api/2fa/verify')
        .send({ twoFactorToken: 'expired', code: '123456' });

      expect(res.status).toBe(401);
    });

    it('verifies email 2FA code and issues session', async () => {
      c2_query
        .mockResolvedValueOnce([{ id: 1, user_id: 5, expires_at: new Date(Date.now() + 600000), used: false }])   // token valid
        .mockResolvedValueOnce([{ two_factor_method: 'email', totp_secret: null }])  // user row
        .mockResolvedValueOnce([{ id: 10, expires_at: new Date(Date.now() + 600000) }])  // code record valid
        .mockResolvedValueOnce([])   // mark code used
        .mockResolvedValueOnce([])   // mark token used
        .mockResolvedValueOnce([{ id: 5, name: 'testuser' }]);  // fetch user
      generateSessionToken.mockResolvedValueOnce('session-tok');

      const res = await request(app)
        .post('/api/2fa/verify')
        .send({ twoFactorToken: 'valid-tok', code: '123456' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBe('session-tok');
    });

    it('rejects invalid email 2FA code', async () => {
      c2_query
        .mockResolvedValueOnce([{ id: 1, user_id: 5, expires_at: new Date(Date.now() + 600000), used: false }])
        .mockResolvedValueOnce([{ two_factor_method: 'email', totp_secret: null }])
        .mockResolvedValueOnce([]);  // no matching code

      const res = await request(app)
        .post('/api/2fa/verify')
        .send({ twoFactorToken: 'valid-tok', code: '000000' });

      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/invalid|expired/i);
    });
  });

  // ── POST /api/login (success paths) ──────────────────────

  describe('POST /api/login (success)', () => {
    it('logs in without 2FA', async () => {
      c2_query.mockResolvedValueOnce([{
        id: 5, name: 'testuser', email: 'test@example.com',
        password_hash: TEST_HASH,
        two_factor_method: 'none', totp_secret: null,
      }]);
      generateSessionToken.mockResolvedValueOnce('session-123');

      const res = await request(app)
        .post('/api/login')
        .send({ username: 'testuser', password: TEST_PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBe('session-123');
      expect(res.body.user.name).toBe('testuser');
    });

    it('triggers email 2FA when enabled', async () => {
      c2_query
        .mockResolvedValueOnce([{
          id: 5, name: 'testuser', email: 'test@example.com',
          password_hash: TEST_HASH,
          two_factor_method: 'email', totp_secret: null,
        }])
        .mockResolvedValueOnce([])   // INSERT password_reset_tokens (2FA token)
        .mockResolvedValueOnce([])   // UPDATE invalidate old codes
        .mockResolvedValueOnce([]);  // INSERT two_factor_codes

      const res = await request(app)
        .post('/api/login')
        .send({ username: 'testuser', password: TEST_PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.requires_2fa).toBe(true);
      expect(res.body.method).toBe('email');
      expect(res.body.twoFactorToken).toBeDefined();
      expect(sendEmail).toHaveBeenCalled();
    });

    it('triggers TOTP 2FA when enabled', async () => {
      c2_query
        .mockResolvedValueOnce([{
          id: 5, name: 'testuser', email: 'test@example.com',
          password_hash: TEST_HASH,
          two_factor_method: 'totp', totp_secret: 'JBSWY3DPEHPK3PXP',
        }])
        .mockResolvedValueOnce([]);  // INSERT password_reset_tokens

      const res = await request(app)
        .post('/api/login')
        .send({ username: 'testuser', password: TEST_PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.requires_2fa).toBe(true);
      expect(res.body.method).toBe('totp');
    });

    it('does not leak totp_secret in login response', async () => {
      c2_query.mockResolvedValueOnce([{
        id: 5, name: 'testuser', email: 'test@example.com',
        password_hash: TEST_HASH,
        two_factor_method: 'none', totp_secret: 'JBSWY3DPEHPK3PXP',
      }]);
      generateSessionToken.mockResolvedValueOnce('session-123');

      const res = await request(app)
        .post('/api/login')
        .send({ username: 'testuser', password: TEST_PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.totp_secret).toBeUndefined();
      expect(res.body.user.password_hash).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain('JBSWY3DPEHPK3PXP');
    });

    it('does not leak totp_secret in 2FA response', async () => {
      c2_query
        .mockResolvedValueOnce([{
          id: 5, name: 'testuser', email: 'test@example.com',
          password_hash: TEST_HASH,
          two_factor_method: 'totp', totp_secret: 'JBSWY3DPEHPK3PXP',
        }])
        .mockResolvedValueOnce([]);  // INSERT password_reset_tokens

      const res = await request(app)
        .post('/api/login')
        .send({ username: 'testuser', password: TEST_PASSWORD });

      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain('JBSWY3DPEHPK3PXP');
    });
  });

  // ── GET /api/permissions/:userId ──────────────────────────

  describe('GET /api/permissions/:userId', () => {
    it('returns own permissions', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ create_team: true, create_project: false, create_page: true }]);

      const res = await request(app)
        .get(`/api/permissions/${TEST_USER.id}`)
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.permissions.create_team).toBe(true);
      expect(res.body.permissions.create_project).toBe(false);
    });

    it('allows org owner to view other user permissions', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ 1: 1 }])  // org ownership link exists
        .mockResolvedValueOnce([{ create_team: true, create_project: true, create_page: true }]);

      const res = await request(app)
        .get('/api/permissions/99')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects non-owner viewing other user permissions', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]);  // no org link

      const res = await request(app)
        .get('/api/permissions/99')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });

    it('rejects invalid userId', async () => {
      mockAuthenticated();

      const res = await request(app)
        .get('/api/permissions/abc')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(400);
    });
  });

  // ── PUT /api/permissions/:userId ──────────────────────────

  describe('PUT /api/permissions/:userId', () => {
    it('updates existing permissions as org owner', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ 1: 1 }])  // org link exists
        .mockResolvedValueOnce([{ id: 10 }]) // existing perms row
        .mockResolvedValueOnce([]);           // UPDATE

      const res = await request(app)
        .put('/api/permissions/99')
        .set('Authorization', 'Bearer valid-token')
        .send({ create_team: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('inserts permissions when none exist', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ 1: 1 }])  // org link
        .mockResolvedValueOnce([])           // no existing row
        .mockResolvedValueOnce([]);          // INSERT

      const res = await request(app)
        .put('/api/permissions/99')
        .set('Authorization', 'Bearer valid-token')
        .send({ create_project: false });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects non-org-owner', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]);  // no org link

      const res = await request(app)
        .put('/api/permissions/99')
        .set('Authorization', 'Bearer valid-token')
        .send({ create_team: true });

      expect(res.status).toBe(403);
    });

    it('rejects with no permission fields', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ 1: 1 }]);  // org link

      const res = await request(app)
        .put('/api/permissions/99')
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/no permission/i);
    });
  });

  // ── POST /api/2fa/enable ──────────────────────────────────

  describe('POST /api/2fa/enable', () => {
    it('enables email 2FA', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([]);  // UPDATE users

      const res = await request(app)
        .post('/api/2fa/enable')
        .set('Authorization', 'Bearer valid-token')
        .send({ method: 'email' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/email/i);
    });

    it('initiates TOTP setup', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([])   // UPDATE users (store totp_secret)
        .mockResolvedValueOnce([]);  // INSERT setup token

      const res = await request(app)
        .post('/api/2fa/enable')
        .set('Authorization', 'Bearer valid-token')
        .send({ method: 'totp' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.setupToken).toBeDefined();
      expect(sendEmail).toHaveBeenCalled();
    });

    it('rejects invalid method', async () => {
      mockAuthenticated();

      const res = await request(app)
        .post('/api/2fa/enable')
        .set('Authorization', 'Bearer valid-token')
        .send({ method: 'sms' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/invalid method/i);
    });

    it('requires authentication', async () => {
      mockUnauthenticated();

      const res = await request(app)
        .post('/api/2fa/enable')
        .set('Authorization', 'Bearer bad-token')
        .send({ method: 'email' });

      expect(res.status).toBe(401);
    });
  });

  // ── POST /api/2fa/totp/confirm ────────────────────────────

  describe('POST /api/2fa/totp/confirm', () => {
    it('rejects missing fields', async () => {
      mockAuthenticated();

      const res = await request(app)
        .post('/api/2fa/totp/confirm')
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(res.status).toBe(400);
    });

    it('rejects expired setup token', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{
        id: 1, user_id: TEST_USER.id,
        expires_at: new Date(Date.now() - 1000), used: false,
      }]);

      const res = await request(app)
        .post('/api/2fa/totp/confirm')
        .set('Authorization', 'Bearer valid-token')
        .send({ setupToken: 'expired-tok', code: '123456' });

      expect(res.status).toBe(401);
    });

    it('rejects when no TOTP setup in progress', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, user_id: TEST_USER.id, expires_at: new Date(Date.now() + 600000), used: false }])
        .mockResolvedValueOnce([{ totp_secret: null }]);  // no secret stored

      const res = await request(app)
        .post('/api/2fa/totp/confirm')
        .set('Authorization', 'Bearer valid-token')
        .send({ setupToken: 'valid-tok', code: '123456' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/no authenticator/i);
    });
  });

  // ── POST /api/2fa/disable ─────────────────────────────────

  describe('POST /api/2fa/disable', () => {
    it('sends verification code when 2FA is enabled', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ email: 'test@example.com', two_factor_method: 'email' }])  // user row
        .mockResolvedValueOnce([])   // invalidate old codes
        .mockResolvedValueOnce([])   // INSERT code
        .mockResolvedValueOnce([]);  // INSERT confirm token

      const res = await request(app)
        .post('/api/2fa/disable')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.confirmToken).toBeDefined();
      expect(sendEmail).toHaveBeenCalled();
    });

    it('returns success when 2FA already disabled', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ email: 'test@example.com', two_factor_method: 'none' }]);

      const res = await request(app)
        .post('/api/2fa/disable')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/already disabled/i);
    });
  });

  // ── POST /api/2fa/disable/confirm ─────────────────────────

  describe('POST /api/2fa/disable/confirm', () => {
    it('disables 2FA with valid token and code', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, user_id: TEST_USER.id, expires_at: new Date(Date.now() + 600000), used: false }])  // confirm token
        .mockResolvedValueOnce([{ id: 10, expires_at: new Date(Date.now() + 600000) }])  // code record
        .mockResolvedValueOnce([])   // mark code used
        .mockResolvedValueOnce([])   // mark token used
        .mockResolvedValueOnce([])   // UPDATE users (disable)
        .mockResolvedValueOnce([]);  // DELETE unused codes

      const res = await request(app)
        .post('/api/2fa/disable/confirm')
        .set('Authorization', 'Bearer valid-token')
        .send({ confirmToken: 'valid-tok', code: '123456' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/disabled/i);
    });

    it('rejects missing fields', async () => {
      mockAuthenticated();

      const res = await request(app)
        .post('/api/2fa/disable/confirm')
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(res.status).toBe(400);
    });

    it('rejects expired confirm token', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{
        id: 1, user_id: TEST_USER.id,
        expires_at: new Date(Date.now() - 1000), used: false,
      }]);

      const res = await request(app)
        .post('/api/2fa/disable/confirm')
        .set('Authorization', 'Bearer valid-token')
        .send({ confirmToken: 'expired', code: '123456' });

      expect(res.status).toBe(401);
    });

    it('rejects invalid verification code', async () => {
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 1, user_id: TEST_USER.id, expires_at: new Date(Date.now() + 600000), used: false }])
        .mockResolvedValueOnce([]);  // no matching code

      const res = await request(app)
        .post('/api/2fa/disable/confirm')
        .set('Authorization', 'Bearer valid-token')
        .send({ confirmToken: 'valid-tok', code: '000000' });

      expect(res.status).toBe(401);
    });
  });

  // ── GET /api/2fa/status ───────────────────────────────────

  describe('GET /api/2fa/status', () => {
    it('returns none when 2FA is disabled', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ two_factor_method: 'none' }]);

      const res = await request(app)
        .get('/api/2fa/status')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.method).toBe('none');
      expect(res.body.enabled).toBe(false);
    });

    it('returns email when email 2FA is enabled', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ two_factor_method: 'email' }]);

      const res = await request(app)
        .get('/api/2fa/status')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.method).toBe('email');
      expect(res.body.enabled).toBe(true);
    });

    it('returns totp when authenticator is enabled', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce([{ two_factor_method: 'totp' }]);

      const res = await request(app)
        .get('/api/2fa/status')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.method).toBe('totp');
      expect(res.body.enabled).toBe(true);
    });

    it('requires authentication', async () => {
      mockUnauthenticated();

      const res = await request(app)
        .get('/api/2fa/status')
        .set('Authorization', 'Bearer bad-token');

      expect(res.status).toBe(401);
    });
  });

  // ── GET /api/check-username/:username ─────────────────────

  describe('GET /api/check-username/:username', () => {
    it('returns available for valid unused username', async () => {
      c2_query.mockResolvedValueOnce([]); // no existing user

      const res = await request(app)
        .get('/api/check-username/newuser');

      expect(res.status).toBe(200);
      expect(res.body.available).toBe(true);
    });

    it('returns unavailable for taken username', async () => {
      c2_query.mockResolvedValueOnce([{ id: 1 }]); // existing user

      const res = await request(app)
        .get('/api/check-username/testuser');

      expect(res.status).toBe(200);
      expect(res.body.available).toBe(false);
      expect(res.body.message).toMatch(/taken/i);
    });

    it('returns unavailable for invalid username format', async () => {
      const res = await request(app)
        .get('/api/check-username/ab'); // too short

      expect(res.status).toBe(200);
      expect(res.body.available).toBe(false);
    });

    it('returns unavailable for username with spaces', async () => {
      const res = await request(app)
        .get('/api/check-username/bad%20user');

      expect(res.status).toBe(200);
      expect(res.body.available).toBe(false);
    });
  });

  // ── POST /api/setup ───────────────────────────────────────

  describe('POST /api/setup', () => {
    it('creates a standalone project', async () => {
      mockAuthenticated();
      c2_query.mockResolvedValueOnce({ insertId: 30 }); // INSERT project

      const res = await request(app)
        .post('/api/setup')
        .set('Authorization', 'Bearer valid-token')
        .send({ projectName: 'Solo Project' });

      expect(res.status).toBe(201);
      expect(res.body.organizationId).toBeNull();
      expect(res.body.teamId).toBeNull();
      expect(res.body.projectId).toBe(30);
    });

    it('rejects when no project name provided', async () => {
      mockAuthenticated();

      const res = await request(app)
        .post('/api/setup')
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(res.status).toBe(400);
    });

    it('requires authentication', async () => {
      mockUnauthenticated();

      const res = await request(app)
        .post('/api/setup')
        .set('Authorization', 'Bearer bad-token')
        .send({ projectName: 'My Project' });

      expect(res.status).toBe(401);
    });
  });
});
