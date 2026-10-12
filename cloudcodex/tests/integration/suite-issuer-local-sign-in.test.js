/**
 * Suite mode: an issuer-linked account cannot take a local route around the issuer (W6-CDX-42, K6, security)
 *
 * On a live MySQL server, with suite mode on, an account with a user_identities row signs in only through its
 * issuer. The password routes must not give it a session from email control alone:
 *   - POST /api/forgot-password answers the generic response and sends no mail;
 *   - POST /api/reset-password refuses with managed_by_issuer and writes nothing;
 *   - POST /api/login refuses with managed_by_issuer even when the password is right and a local hash exists;
 *   - POST /api/admin/users/:id/2fa/reset refuses for an issuer-linked target.
 * Controls: a local account keeps every one of these; suite mode off changes nothing.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import request from 'supertest';

vi.mock('../../services/email.js', () => ({
  sendEmail: vi.fn(async () => ({ messageId: 'it' })),
  verifyEmailConnection: vi.fn(async () => true),
  initMail: vi.fn(async () => ({ enabled: true, reason: null })),
  isMailEnabled: vi.fn(() => true),
  isMailConfigured: vi.fn(() => true),
}));

import app from '../../app.js';
import { c2_query, generateSessionToken } from '../../mysql_connect.js';
import { sendEmail } from '../../services/email.js';
import { TOKEN_PURPOSE } from '../../routes/helpers/shared.js';

const OLD_PASSWORD = 'OldPassw0rd!';
const NEW_PASSWORD = 'NewPassw0rd!';
const SUITE_ENV = { SUITE_COMMAND_WORKSPACE_URL: 'https://command.suite.test/w/ws-1', SUITE_NAME: 'Example Suite' };
const ISSUER = 'https://id.suite.test';
const GENERIC = 'If an account with that email exists, a reset link has been sent.';
const REFUSAL = { success: false, code: 'managed_by_issuer' };

const tag = randomBytes(4).toString('hex');
let issuerUser;
let localUser;
let adminUser;
let adminToken;

/** A user with a local password hash, and optionally a linked issuer identity (a user_identities row). */
async function makeUser(name, { linked }) {
  const hash = await bcrypt.hash(OLD_PASSWORD, 4);
  const created = await c2_query(
    'INSERT INTO users (name, email, password_hash, is_admin) VALUES (?, ?, ?, ?)',
    [`${name}_${tag}`, `${name}_${tag}@example.com`, hash, name.startsWith('admin') ? 1 : 0]
  );
  const id = created.insertId;
  if (linked) {
    await c2_query(
      'INSERT INTO user_identities (user_id, issuer, subject, email_at_link) VALUES (?, ?, ?, ?)',
      [id, ISSUER, `sub-${name}-${tag}`, `${name}_${tag}@example.com`]
    );
  }
  return { id, name: `${name}_${tag}`, email: `${name}_${tag}@example.com`, hash };
}

const passwordHashOf = async (id) => (await c2_query('SELECT password_hash FROM users WHERE id = ?', [id]))[0].password_hash;
const sessionsOf = async (id) => (await c2_query('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?', [id]))[0].n;
const resetTokensOf = async (id) => (await c2_query(
  'SELECT COUNT(*) AS n FROM password_reset_tokens WHERE user_id = ? AND purpose = ?', [id, TOKEN_PURPOSE.PASSWORD_RESET]
))[0].n;

/** A live reset token for the user, minted the way POST /api/forgot-password mints one. */
async function liveResetToken(userId) {
  const token = randomBytes(32).toString('hex');
  await c2_query(
    'INSERT INTO password_reset_tokens (user_id, token, purpose, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))',
    [userId, token, TOKEN_PURPOSE.PASSWORD_RESET]
  );
  return token;
}

const setSuite = (on) => {
  if (on) Object.assign(process.env, SUITE_ENV);
  else { delete process.env.SUITE_COMMAND_WORKSPACE_URL; delete process.env.SUITE_NAME; }
};

beforeAll(async () => {
  issuerUser = await makeUser('iss', { linked: true });
  localUser = await makeUser('loc', { linked: false });
  adminUser = await makeUser('admin_iss', { linked: false });
  adminToken = await generateSessionToken({ id: adminUser.id }, null, null, { provider: 'local' });
});

beforeEach(() => {
  vi.clearAllMocks();
  setSuite(true);
});

afterAll(() => setSuite(false));

describe('suite mode, forgot-password: no mail to an issuer-linked account', () => {
  it('answers the same generic response as for an unknown address, and sends nothing', async () => {
    const linked = await request(app).post('/api/forgot-password').send({ email: issuerUser.email });
    const unknown = await request(app).post('/api/forgot-password').send({ email: `nobody_${tag}@example.com` });
    expect(linked.status).toBe(200);
    expect(linked.body).toEqual(unknown.body);
    expect(linked.body.message).toBe(GENERIC);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await resetTokensOf(issuerUser.id)).toBe(0);
  });

  it('control: a local account is mailed a reset link in suite mode', async () => {
    const res = await request(app).post('/api/forgot-password').send({ email: localUser.email });
    expect(res.body.message).toBe(GENERIC);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(await resetTokensOf(localUser.id)).toBe(1);
  });
});

describe('suite mode, reset-password: a live token cannot set a local password', () => {
  it('refuses with managed_by_issuer and writes nothing', async () => {
    const token = await liveResetToken(issuerUser.id);
    const before = await passwordHashOf(issuerUser.id);
    const res = await request(app).post('/api/reset-password').send({ token, password: NEW_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject(REFUSAL);
    expect(await passwordHashOf(issuerUser.id)).toBe(before);
    const [row] = await c2_query('SELECT used FROM password_reset_tokens WHERE token = ?', [token]);
    expect(row.used).toBeFalsy();
  });

  it('control: a local account resets its password in suite mode', async () => {
    const token = await liveResetToken(localUser.id);
    const res = await request(app).post('/api/reset-password').send({ token, password: NEW_PASSWORD });
    expect(res.status).toBe(200);
    expect(await passwordHashOf(localUser.id)).not.toBe(localUser.hash);
  });
});

describe('suite mode, login: an issuer-linked account gets no session from its password', () => {
  it('refuses the right password, with a local hash still on the row, and mints no session', async () => {
    const res = await request(app).post('/api/login').send({ username: issuerUser.name, password: OLD_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject(REFUSAL);
    expect(res.body.message).toMatch(/sign-in provider/i);
    expect(res.body.token).toBeUndefined();
    expect(await sessionsOf(issuerUser.id)).toBe(0);
  });

  it('control: a local account signs in with the same password in suite mode', async () => {
    const res = await request(app).post('/api/login').send({ username: localUser.name, password: NEW_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
  });

  it('suite mode off: the issuer-linked account signs in as before', async () => {
    // Its own account: the reset test above must not be able to change this one's password.
    const offUser = await makeUser('off', { linked: true });
    setSuite(false);
    const res = await request(app).post('/api/login').send({ username: offUser.name, password: OLD_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
  });
});

describe('suite mode, admin 2FA reset: an issuer-linked target is refused', () => {
  async function enrollTotp(userId) {
    await c2_query("UPDATE users SET two_factor_method = 'totp' WHERE id = ?", [userId]);
  }
  const reset = (id) => request(app).post(`/api/admin/users/${id}/2fa/reset`).set('Authorization', `Bearer ${adminToken}`);
  const methodOf = async (id) => (await c2_query('SELECT two_factor_method FROM users WHERE id = ?', [id]))[0].two_factor_method;

  it('refuses for an issuer-linked target and clears nothing', async () => {
    await enrollTotp(issuerUser.id);
    const res = await reset(issuerUser.id);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject(REFUSAL);
    expect(await methodOf(issuerUser.id)).toBe('totp');
  });

  it('control: a local target is reset as before', async () => {
    await enrollTotp(localUser.id);
    const res = await reset(localUser.id);
    expect(res.status).toBe(200);
    expect(await methodOf(localUser.id)).toBe('none');
  });
});
