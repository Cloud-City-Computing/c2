import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { c2_query, validateAndAutoLogin, generateSessionToken } from '../../mysql_connect.js';
import { sendEmail } from '../../services/email.js';
import { mockAuthenticated, mockUnauthenticated, resetMocks, TEST_USER } from '../helpers.js';

describe('Auth Routes', () => {
  beforeEach(() => {
    resetMocks();
  });

  // ── POST /api/create-account ──────────────────────────────

  describe('POST /api/create-account', () => {
    it('creates account with valid input', async () => {
      c2_query.mockResolvedValueOnce([]);             // SELECT duplicate email check
      c2_query.mockResolvedValueOnce({ insertId: 10 }); // INSERT user
      generateSessionToken.mockResolvedValueOnce('new-token');
      c2_query.mockResolvedValueOnce([]); // INSERT permissions

      const res = await request(app)
        .post('/api/create-account')
        .send({ username: 'newuser', password: 'password123', email: 'new@test.com' });

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

    it('rejects invalid email', async () => {
      const res = await request(app)
        .post('/api/create-account')
        .send({ username: 'user', password: 'password123', email: 'not-an-email' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/email/i);
    });

    it('rejects short password', async () => {
      const res = await request(app)
        .post('/api/create-account')
        .send({ username: 'user', password: 'short', email: 'ok@test.com' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/8 characters/);
    });

    it('rejects duplicate email', async () => {
      c2_query.mockResolvedValueOnce([{ id: 5 }]); // SELECT duplicate email check — found existing

      const res = await request(app)
        .post('/api/create-account')
        .send({ username: 'newuser', password: 'password123', email: 'existing@test.com' });

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

    it('rejects short password on update', async () => {
      validateAndAutoLogin.mockResolvedValueOnce(TEST_USER);

      const res = await request(app)
        .post('/api/update-account')
        .send({ token: 'tok', userId: 1, password: 'short' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/8 characters/);
    });

    it('rejects invalid email on update', async () => {
      validateAndAutoLogin.mockResolvedValueOnce(TEST_USER);

      const res = await request(app)
        .post('/api/update-account')
        .send({ token: 'tok', userId: 1, email: 'bad' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/email/i);
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
        .send({ token: 'valid-reset-token', password: 'newpassword123' });

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
  });
});
