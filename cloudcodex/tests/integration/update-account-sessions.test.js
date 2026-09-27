/**
 * update-account's session rotation, and the email-change code, against a live MySQL server
 *
 * The route tests prove the SQL the route issues; only a real server proves
 * what it leaves behind. A password or email change must leave the user with
 * exactly one session, the fresh one handed to the caller, so every other
 * holder of the old token is signed out. And the emailed-code flow writes a
 * password_reset_tokens row whose purpose and new_email have to satisfy the
 * table's CHECK constraints, which no mock evaluates.
 *
 * Mail is the one thing stubbed, so the code can be read back off the call.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/email.js', () => ({
  sendEmail: vi.fn(async () => ({ messageId: 'it' })),
  verifyEmailConnection: vi.fn(async () => true),
  initMail: vi.fn(async () => ({ enabled: true, reason: null })),
  isMailEnabled: vi.fn(() => true),
  isMailConfigured: vi.fn(() => true),
}));

import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import request from 'supertest';
import app from '../../app.js';
import { c2_query, generateSessionToken } from '../../mysql_connect.js';
import { hashSessionToken } from '../../services/session-token.js';
import { sendEmail } from '../../services/email.js';

const OLD_PASSWORD = 'OldPassw0rd!';
const NEW_PASSWORD = 'NewPassw0rd!';

/**
 * A user with `sessions` live session rows, each minted the way sign-in mints
 * one: one row per sign-in, so each is a separate device. Returns the user id
 * and the tokens.
 * @param { String } name
 * @param { { password?: String|null, extraSessions?: Number, provider?: String } } [opts]
 */
async function userWithSessions(name, { password = OLD_PASSWORD, extraSessions = 1, provider = 'local' } = {}) {
  const hash = password === null ? null : await bcrypt.hash(password, 4);
  const created = await c2_query('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)', [
    name,
    `${name}@example.com`,
    hash,
  ]);
  const userId = created.insertId;
  const tokens = [];
  for (let i = 0; i <= extraSessions; i++) tokens.push(await generateSessionToken({ id: userId }, null, null, { provider }));
  return { userId, tokens };
}

/**
 * Every session id the user holds, sorted in JS. sessions.id is the digest of
 * a token, so compare against `digests(tokens)`, never the tokens.
 */
async function sessionsOf(userId) {
  const rows = await c2_query('SELECT id FROM sessions WHERE user_id = ?', [userId]);
  return rows.map(row => row.id).sort();
}

/** The flow tag on each of the user's sessions. */
async function providersOf(userId) {
  const rows = await c2_query('SELECT auth_provider FROM sessions WHERE user_id = ?', [userId]);
  return rows.map(row => row.auth_provider);
}

/** The stored ids for these tokens, sorted like sessionsOf. */
const digests = (tokens) => tokens.map(hashSessionToken).sort();

/** The status a requireAuth route answers for `token`. */
async function statusFor(token) {
  const res = await request(app).get('/api/2fa/status').set('Authorization', `Bearer ${token}`);
  return res.status;
}

beforeEach(() => {
  sendEmail.mockClear();
});

describe('a password change through update-account, on a real server', () => {
  it('leaves exactly one session, the caller\'s new one, and signs every old token out', async () => {
    const { userId, tokens } = await userWithSessions('pwchange');
    expect(await sessionsOf(userId)).toHaveLength(2);

    const res = await request(app)
      .post('/api/update-account')
      .send({ token: tokens[0], userId, password: NEW_PASSWORD, currentPassword: OLD_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.token).toMatch(/^[A-Za-z0-9]{64}$/);
    expect(tokens).not.toContain(res.body.token);
    expect(await sessionsOf(userId)).toEqual(digests([res.body.token]));
    expect(await providersOf(userId)).toEqual(['local']);

    for (const old of tokens) expect(await statusFor(old)).toBe(401);
    expect(await statusFor(res.body.token)).toBe(200);

    const oldLogin = await request(app).post('/api/login').send({ username: 'pwchange', password: OLD_PASSWORD });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app).post('/api/login').send({ username: 'pwchange', password: NEW_PASSWORD });
    expect(newLogin.status).toBe(200);
    // A sign-in after the change is a row of its own, never the caller's token.
    expect(newLogin.body.token).not.toBe(res.body.token);
    expect(await sessionsOf(userId)).toEqual(digests([res.body.token, newLogin.body.token]));
    expect(await statusFor(res.body.token)).toBe(200);
  });

  it('changes nothing on a wrong current password', async () => {
    const { userId, tokens } = await userWithSessions('pwwrong');
    const [before] = await c2_query('SELECT password_hash FROM users WHERE id = ?', [userId]);

    const res = await request(app)
      .post('/api/update-account')
      .send({ token: tokens[0], userId, password: NEW_PASSWORD, currentPassword: 'not-it' });

    expect(res.status).toBe(401);
    const [after] = await c2_query('SELECT password_hash FROM users WHERE id = ?', [userId]);
    expect(after.password_hash).toBe(before.password_hash);
    expect(await sessionsOf(userId)).toEqual(digests(tokens));
  });
});

describe('an email change through update-account, on a real server', () => {
  it('with the current password: writes the address and leaves exactly the caller\'s new session', async () => {
    const { userId, tokens } = await userWithSessions('emchange');

    const res = await request(app)
      .post('/api/update-account')
      .send({ token: tokens[0], userId, email: 'emchange-new@example.com', currentPassword: OLD_PASSWORD });

    expect(res.status).toBe(200);
    const [row] = await c2_query('SELECT email FROM users WHERE id = ?', [userId]);
    expect(row.email).toBe('emchange-new@example.com');
    expect(await sessionsOf(userId)).toEqual(digests([res.body.token]));
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].to).toBe('emchange@example.com');
  });

  it('with no password: the code goes to the current address, and confirming it leaves one session', async () => {
    // An account with no password was made by an external sign-in, so its
    // sessions carry that flow's tag, and the replacement must keep it.
    const { userId, tokens } = await userWithSessions('emnopass', { password: null, provider: 'google' });

    const start = await request(app)
      .post('/api/update-account')
      .send({ token: tokens[0], userId, email: 'emnopass-new@example.com' });

    expect(start.status).toBe(200);
    expect(start.body.requires_email_code).toBe(true);
    const [minted] = await c2_query(
      'SELECT purpose, new_email, used FROM password_reset_tokens WHERE token = ?',
      [start.body.confirmToken]
    );
    expect(minted).toEqual({ purpose: 'email_change', new_email: 'emnopass-new@example.com', used: 0 });
    expect(sendEmail.mock.calls[0][0].to).toBe('emnopass@example.com');
    const [{ code }] = await c2_query(
      'SELECT code FROM two_factor_codes WHERE user_id = ? AND used = FALSE',
      [userId]
    );
    expect(sendEmail.mock.calls[0][0].text).toContain(code);
    // Nothing has changed yet.
    expect((await c2_query('SELECT email FROM users WHERE id = ?', [userId]))[0].email).toBe('emnopass@example.com');
    expect(await sessionsOf(userId)).toEqual(digests(tokens));

    const done = await request(app)
      .post('/api/update-account/confirm-email')
      .set('Authorization', `Bearer ${tokens[0]}`)
      .send({ confirmToken: start.body.confirmToken, code });

    expect(done.status).toBe(200);
    expect((await c2_query('SELECT email FROM users WHERE id = ?', [userId]))[0].email).toBe('emnopass-new@example.com');
    expect(await sessionsOf(userId)).toEqual(digests([done.body.token]));
    expect(await providersOf(userId)).toEqual(['google']);
    for (const old of tokens) expect(await statusFor(old)).toBe(401);
    // The notice went to the address the account had before.
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(sendEmail.mock.calls[1][0].to).toBe('emnopass@example.com');
  });
});

describe('password_reset_tokens.new_email', () => {
  /** The mysql2 error an INSERT raises, or null when it succeeded. */
  async function insertError(userId, purpose, newEmail) {
    try {
      await c2_query(
        `INSERT INTO password_reset_tokens (user_id, token, purpose, new_email, expires_at)
         VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
        [userId, randomBytes(32).toString('hex'), purpose, newEmail]
      );
      return null;
    } catch (err) {
      return err;
    }
  }

  it('is required on an email_change row and refused on every other purpose', async () => {
    const { userId } = await userWithSessions('tokcheck', { extraSessions: 0 });
    expect(await insertError(userId, 'email_change', 'a@example.com')).toBeNull();
    expect(await insertError(userId, 'password_reset', null)).toBeNull();

    const missing = await insertError(userId, 'email_change', null);
    expect(missing?.errno).toBe(3819);
    expect(missing.sqlMessage).toContain('chk_password_reset_tokens_new_email');

    const stray = await insertError(userId, 'password_reset', 'a@example.com');
    expect(stray?.errno).toBe(3819);
    expect(stray.sqlMessage).toContain('chk_password_reset_tokens_new_email');
  });
});
