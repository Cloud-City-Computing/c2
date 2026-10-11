/**
 * A deactivated user cannot sign in with a password, even with the right one
 *
 * POST /api/login checks the password first, then refuses a deactivated account with a named 403 before it
 * mints a session or a two-factor challenge. The refusal writes nothing.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import app from '../../app.js';
import { c2_query, generateSessionToken } from '../../mysql_connect.js';
import { resetMocks } from '../helpers.js';

const PASSWORD = 'password123';
const HASH = bcrypt.hashSync(PASSWORD, 1);

describe('POST /api/login for a deactivated user', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('refuses a correct password with 403 and mints no session', async () => {
    c2_query.mockResolvedValueOnce([{
      id: 4, name: 'alice', email: 'alice@test.com', avatar_url: null, password_hash: HASH,
      two_factor_method: 'none', totp_secret: null, is_admin: 0, deactivated_at: new Date('2026-10-01T00:00:00Z'),
    }]);

    const res = await request(app).post('/api/login').send({ username: 'alice', password: PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/deactivated/);
    expect(res.body.token).toBeUndefined();
    expect(generateSessionToken).not.toHaveBeenCalled();
    expect(c2_query).toHaveBeenCalledTimes(1);
  });

  it('keeps the vague 401 for a wrong password, which does not reveal the account is deactivated', async () => {
    c2_query.mockResolvedValueOnce([{
      id: 4, name: 'alice', email: 'alice@test.com', avatar_url: null, password_hash: HASH,
      two_factor_method: 'none', totp_secret: null, is_admin: 0, deactivated_at: new Date('2026-10-01T00:00:00Z'),
    }]);

    const res = await request(app).post('/api/login').send({ username: 'alice', password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid credentials');
  });

  it('does not echo deactivated_at in the user it returns to an active user', async () => {
    c2_query.mockResolvedValueOnce([{
      id: 5, name: 'bob', email: 'bob@test.com', avatar_url: null, password_hash: HASH,
      two_factor_method: 'none', totp_secret: null, is_admin: 0, deactivated_at: null,
    }]);

    const res = await request(app).post('/api/login').send({ username: 'bob', password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user).not.toHaveProperty('deactivated_at');
    expect(res.body.user).not.toHaveProperty('password_hash');
  });
});
