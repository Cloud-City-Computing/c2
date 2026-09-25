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
import { sendEmail } from '../../services/email.js';

const OLD_PASSWORD = 'OldPassw0rd!';
const NEW_PASSWORD = 'NewPassw0rd!';

/**
 * A user with `sessions` live session rows: the first minted the way sign-in
 * mints one, the rest inserted directly, as a second device's row will be once
 * sessions are per sign-in. Returns the user id and the tokens.
 * @param { String } name
 * @param { { password?: String|null, extraSessions?: Number } } [opts]
 */
async function userWithSessions(name, { password = OLD_PASSWORD, extraSessions = 1 } = {}) {
  const hash = password === null ? null : await bcrypt.hash(password, 4);
  const created = await c2_query('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)', [
    name,
    `${name}@example.com`,
    hash,
  ]);
  const userId = created.insertId;
  const tokens = [await generateSessionToken({ id: userId })];
  for (let i = 0; i < extraSessions; i++) {
    const token = randomBytes(32).toString('hex');
    await c2_query(
      'INSERT INTO sessions (user_id, id, created_at, expires_at) VALUES (?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 7 DAY))',
      [userId, token]
    );
    tokens.push(token);
  }
  return { userId, tokens };
}

/** Every session id the user holds, sorted in JS (the column's collation ignores case). */
async function sessionsOf(userId) {
  const rows = await c2_query('SELECT id FROM sessions WHERE user_id = ?', [userId]);
  return rows.map(row => row.id).sort();
}

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
    expect(await sessionsOf(userId)).toEqual([res.body.token]);

    for (const old of tokens) expect(await statusFor(old)).toBe(401);
    expect(await statusFor(res.body.token)).toBe(200);

    const oldLogin = await request(app).post('/api/login').send({ username: 'pwchange', password: OLD_PASSWORD });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app).post('/api/login').send({ username: 'pwchange', password: NEW_PASSWORD });
    expect(newLogin.status).toBe(200);
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
    expect(await sessionsOf(userId)).toEqual([...tokens].sort());
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
    expect(await sessionsOf(userId)).toEqual([res.body.token]);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].to).toBe('emchange@example.com');
  });

  it('with no password: the code goes to the current address, and confirming it leaves one session', async () => {
    const { userId, tokens } = await userWithSessions('emnopass', { password: null });

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
    expect(await sessionsOf(userId)).toEqual([...tokens].sort());

    const done = await request(app)
      .post('/api/update-account/confirm-email')
      .set('Authorization', `Bearer ${tokens[0]}`)
      .send({ confirmToken: start.body.confirmToken, code });

    expect(done.status).toBe(200);
    expect((await c2_query('SELECT email FROM users WHERE id = ?', [userId]))[0].email).toBe('emnopass-new@example.com');
    expect(await sessionsOf(userId)).toEqual([done.body.token]);
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
