/**
 * An account linked to an issuer has the doors its instance offers, and no more (CDX-SA-2, Task 2.3)
 *
 * On a live MySQL server, an account with a user_identities row:
 *   - with local sign-in on (the default), can request a reset link, reset its password, sign in with
 *     that password, and have an admin reset its two-factor. Nothing refuses it for being linked: the
 *     suite's issuer-managed refusals were removed with suite mode.
 *   - on an OIDC-only instance (AUTH_PROVIDERS=oidc), has no local password door: forgot-password,
 *     reset-password and login are 404 (requireLocalSignIn). The admin two-factor reset is an admin
 *     route, not a sign-in door, and is not gated by sign-in mode.
 * The suite variables are removed: setting them changes nothing here.
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
const ISSUER = 'https://id.doors.test';
const SUITE_KEYS = ['SUITE_COMMAND_WORKSPACE_URL', 'SUITE_NAME', 'SUITE_PREFERENCE_DOMAIN', 'OIDC_ACCOUNT_URL'];

const tag = randomBytes(4).toString('hex');
let linked;
let adminId;
let adminToken;
let adminOidcToken;

/** A user with a local password hash, and optionally a linked issuer identity (a user_identities row). */
async function makeUser(name, { isLinked }) {
  const hash = await bcrypt.hash(OLD_PASSWORD, 4);
  const created = await c2_query(
    'INSERT INTO users (name, email, password_hash, is_admin) VALUES (?, ?, ?, ?)',
    [`${name}_${tag}`, `${name}_${tag}@example.com`, hash, name.startsWith('admin') ? 1 : 0]
  );
  const id = created.insertId;
  if (isLinked) {
    await c2_query(
      'INSERT INTO user_identities (user_id, issuer, subject, email_at_link) VALUES (?, ?, ?, ?)',
      [id, ISSUER, `sub-${name}-${tag}`, `${name}_${tag}@example.com`]
    );
  }
  return { id, name: `${name}_${tag}`, email: `${name}_${tag}@example.com` };
}

const passwordHashOf = async (id) => (await c2_query('SELECT password_hash FROM users WHERE id = ?', [id]))[0].password_hash;
const resetTokensOf = async (id) => (await c2_query(
  'SELECT COUNT(*) AS n FROM password_reset_tokens WHERE user_id = ? AND purpose = ?', [id, TOKEN_PURPOSE.PASSWORD_RESET]
))[0].n;
const methodOf = async (id) => (await c2_query('SELECT two_factor_method FROM users WHERE id = ?', [id]))[0].two_factor_method;

/** A live reset token for the user, minted the way POST /api/forgot-password mints one. */
async function liveResetToken(userId) {
  const token = randomBytes(32).toString('hex');
  await c2_query(
    'INSERT INTO password_reset_tokens (user_id, token, purpose, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))',
    [userId, token, TOKEN_PURPOSE.PASSWORD_RESET]
  );
  return token;
}

const savedEnv = {};
beforeAll(async () => {
  for (const k of [...SUITE_KEYS, 'AUTH_PROVIDERS']) savedEnv[k] = process.env[k];
  linked = await makeUser('linked', { isLinked: true });
  const admin = await makeUser('admin_doors', { isLinked: true });
  adminId = admin.id;
  adminToken = await generateSessionToken({ id: adminId }, null, null, { provider: 'local' });
  // On an OIDC-only instance a local session is refused at validation, so the admin signs in through the issuer.
  const [identity] = await c2_query('SELECT id FROM user_identities WHERE user_id = ?', [adminId]);
  adminOidcToken = await generateSessionToken({ id: adminId }, null, null, { provider: 'oidc', identityId: identity.id, ttlHours: 24 });
});

beforeEach(() => {
  vi.clearAllMocks();
  // The suite variables are removed, so setting them must change nothing.
  Object.assign(process.env, {
    SUITE_COMMAND_WORKSPACE_URL: 'https://command.doors.test/w/1',
    SUITE_NAME: 'Example Suite',
    SUITE_PREFERENCE_DOMAIN: 'doors.test',
    OIDC_ACCOUNT_URL: 'https://id.doors.test/ui/console/users/me',
  });
  delete process.env.AUTH_PROVIDERS;
});

afterAll(() => {
  for (const k of [...SUITE_KEYS, 'AUTH_PROVIDERS']) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('with local sign-in on, an account linked to an issuer keeps every door', () => {
  it('is mailed a reset link when it asks for one', async () => {
    const res = await request(app).post('/api/forgot-password').send({ email: linked.email });
    expect(res.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(await resetTokensOf(linked.id)).toBe(1);
  });

  it('resets its password with that link, and signs in with the new password', async () => {
    const token = await liveResetToken(linked.id);
    const before = await passwordHashOf(linked.id);
    const reset = await request(app).post('/api/reset-password').send({ token, password: NEW_PASSWORD });
    expect(reset.status).toBe(200);
    expect(await passwordHashOf(linked.id)).not.toBe(before);

    const login = await request(app).post('/api/login').send({ username: linked.name, password: NEW_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.token).toEqual(expect.any(String));
  });

  it('has its two-factor reset by an admin', async () => {
    await c2_query("UPDATE users SET two_factor_method = 'totp' WHERE id = ?", [linked.id]);
    const res = await request(app).post(`/api/admin/users/${linked.id}/2fa/reset`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(await methodOf(linked.id)).toBe('none');
  });
});

describe('on an OIDC-only instance, the issuer is the only sign-in door', () => {
  beforeEach(() => {
    process.env.AUTH_PROVIDERS = 'oidc';
  });

  it('answers forgot-password, reset-password and login with 404, and mails nothing', async () => {
    const token = await liveResetToken(linked.id);
    const forgot = await request(app).post('/api/forgot-password').send({ email: linked.email });
    const reset = await request(app).post('/api/reset-password').send({ token, password: NEW_PASSWORD });
    const login = await request(app).post('/api/login').send({ username: linked.name, password: OLD_PASSWORD });
    expect(forgot.status).toBe(404);
    expect(reset.status).toBe(404);
    expect(login.status).toBe(404);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('still lets an admin reset a linked account two-factor (an admin route, not a sign-in door)', async () => {
    await c2_query("UPDATE users SET two_factor_method = 'totp' WHERE id = ?", [linked.id]);
    const res = await request(app).post(`/api/admin/users/${linked.id}/2fa/reset`).set('Authorization', `Bearer ${adminOidcToken}`);
    expect(res.status).toBe(200);
  });
});
