/**
 * POST /api/update-account and POST /api/update-account/confirm-email
 *
 * update-account used to let any holder of a session change the account's
 * email and password with nothing but the session, and a password change kept
 * the caller's own session alive while it deleted the rest. Sessions are one
 * per user today (generateSessionToken hands every sign-in the same live
 * token), so "the caller's own session" was also every other holder's: a
 * stolen session survived the owner changing their password.
 *
 * The rules pinned here:
 *   - an email or password change needs the current password, checked the
 *     way POST /api/login checks it; a wrong or missing one changes nothing;
 *   - a name change needs nothing extra;
 *   - an account with no password (made by an external sign-in) confirms an
 *     email change with a code sent to its CURRENT address, and only when mail
 *     is on; it sets a first password through Forgot password, not here;
 *   - after a password or email change EVERY session of the user is deleted,
 *     the caller's included, and the caller gets a freshly generated one;
 *   - after an email change a notice goes to the OLD address when mail is on.
 *
 * The c2_query mock is routed on the SQL (fakeAccount below) instead of
 * queueing results in call order, so each test states the account it starts
 * from and reads back what the route did to it, including what happened to a
 * second holder of the account's sessions.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import app from '../../app.js';
import { c2_query, validateAndAutoLogin, generateSessionToken, withTransaction } from '../../mysql_connect.js';
import { sendEmail, isMailEnabled } from '../../services/email.js';
import { resetMocks, TEST_USER, expectOwnerPredicatesBindIds } from '../helpers.js';

const CURRENT_PASSWORD = 'password123';
const CURRENT_HASH = bcrypt.hashSync(CURRENT_PASSWORD, 1);
const NEW_PASSWORD = 'NewPassw0rd!';
const NEW_EMAIL = 'new@example.com';

/** The caller's session token, and a second holder's. */
const CALLER = 'caller-token';
const OTHER_HOLDER = 'other-holder-token';

/**
 * An in-memory account behind the database mocks: one user, its sessions, and
 * the rows the emailed-code flow writes. Any SQL it does not recognise throws,
 * so a query the route starts issuing cannot pass by being ignored.
 * @param {{ passwordHash?: string|null, takenEmails?: string[], takenNames?: string[], sessions?: string[] }} [opts]
 */
function fakeAccount({ passwordHash = CURRENT_HASH, takenEmails = [], takenNames = [], sessions = [CALLER, OTHER_HOLDER] } = {}) {
  const state = {
    user: { ...TEST_USER, password_hash: passwordHash },
    sessions: new Set(sessions),
    codes: [],
    tokens: [],
    sql: [],
  };
  const sessionUser = () => ({ id: state.user.id, name: state.user.name, email: state.user.email, avatar_url: null, is_admin: 0 });

  validateAndAutoLogin.mockImplementation(async (token) => (state.sessions.has(token) ? sessionUser() : null));

  let minted = 0;
  generateSessionToken.mockImplementation(async (user) => {
    expect(user.id).toBe(state.user.id);
    minted += 1;
    const token = `fresh-token-${minted}`;
    state.sessions.add(token);
    return token;
  });

  c2_query.mockImplementation(async (rawSql, params = []) => {
    const sql = rawSql.replace(/\s+/g, ' ').trim();
    state.sql.push(sql);
    let m;

    if (/^SELECT password_hash FROM users WHERE id = \? LIMIT 1$/.test(sql)) {
      return params[0] === state.user.id ? [{ password_hash: state.user.password_hash }] : [];
    }
    if (/^SELECT id FROM users WHERE LOWER\(name\) = LOWER\(\?\) AND id != \? LIMIT 1$/.test(sql)) {
      return takenNames.includes(String(params[0]).toLowerCase()) ? [{ id: 5 }] : [];
    }
    if (/^SELECT id FROM users WHERE email = \? AND id != \? LIMIT 1$/.test(sql)) {
      return takenEmails.includes(params[0]) ? [{ id: 5 }] : [];
    }
    if ((m = /^UPDATE users SET (.+) WHERE id = \?$/.exec(sql))) {
      const columns = m[1].split(',').map(part => part.trim().replace(/ = \?$/, ''));
      expect(params[params.length - 1]).toBe(state.user.id);
      columns.forEach((column, i) => { state.user[column] = params[i]; });
      return { affectedRows: 1 };
    }
    if ((m = /^DELETE FROM sessions WHERE user_id = \?( AND id != \?)?$/.exec(sql))) {
      if (params[0] === state.user.id) {
        for (const token of [...state.sessions]) {
          if (!(m[1] && token === params[1])) state.sessions.delete(token);
        }
      }
      return { affectedRows: 1 };
    }
    if (/^UPDATE two_factor_codes SET used = TRUE WHERE user_id = \? AND used = FALSE$/.test(sql)) {
      state.codes.forEach(c => { c.used = true; });
      return { affectedRows: 1 };
    }
    if (/^INSERT INTO two_factor_codes \(user_id, code, expires_at\) VALUES \(\?, \?, DATE_ADD\(NOW\(\), INTERVAL 10 MINUTE\)\)$/.test(sql)) {
      state.codes.push({ id: state.codes.length + 1, user_id: params[0], code: params[1], used: false, expires_at: new Date(Date.now() + 600000) });
      return { insertId: state.codes.length };
    }
    if (/^SELECT id, expires_at FROM two_factor_codes WHERE user_id = \? AND code = \? AND used = FALSE ORDER BY created_at DESC LIMIT 1$/.test(sql)) {
      return state.codes.filter(c => c.user_id === params[0] && c.code === params[1] && !c.used).slice(-1);
    }
    if (/^UPDATE two_factor_codes SET used = TRUE WHERE id = \?$/.test(sql)) {
      state.codes.filter(c => c.id === params[0]).forEach(c => { c.used = true; });
      return { affectedRows: 1 };
    }
    if (/^UPDATE password_reset_tokens SET used = TRUE WHERE user_id = \? AND purpose = \? AND used = FALSE$/.test(sql)) {
      state.tokens.filter(t => t.user_id === params[0] && t.purpose === params[1]).forEach(t => { t.used = true; });
      return { affectedRows: 1 };
    }
    if (/^INSERT INTO password_reset_tokens \(user_id, token, purpose, new_email, expires_at\) VALUES \(\?, \?, \?, \?, DATE_ADD\(NOW\(\), INTERVAL 10 MINUTE\)\)$/.test(sql)) {
      state.tokens.push({ id: state.tokens.length + 1, user_id: params[0], token: params[1], purpose: params[2], new_email: params[3], used: false, expires_at: new Date(Date.now() + 600000) });
      return { insertId: state.tokens.length };
    }
    if (/^SELECT id, user_id, new_email, expires_at, used FROM password_reset_tokens WHERE token = \? AND purpose = \? LIMIT 1$/.test(sql)) {
      return state.tokens.filter(t => t.token === params[0] && t.purpose === params[1]);
    }
    if (/^UPDATE password_reset_tokens SET used = TRUE WHERE id = \?$/.test(sql)) {
      state.tokens.filter(t => t.id === params[0]).forEach(t => { t.used = true; });
      return { affectedRows: 1 };
    }
    // requireAuth's own probe route, GET /api/2fa/status.
    if (/^SELECT two_factor_method FROM users WHERE id = \? LIMIT 1$/.test(sql)) {
      return [{ two_factor_method: 'none' }];
    }
    throw new Error(`fakeAccount: unexpected SQL: ${sql}`);
  });

  return state;
}

/** Every write the route issued against users, sessions, codes or tokens. */
const writesTo = (state, table) =>
  state.sql.filter(sql => new RegExp(`^(UPDATE|INSERT INTO|DELETE FROM) ${table}\\b`).test(sql));

/** Whether a session token still authenticates, through a requireAuth route. */
async function stillSignedIn(token) {
  const res = await request(app).get('/api/2fa/status').set('Authorization', `Bearer ${token}`);
  return res.status === 200;
}

const update = (body) => request(app).post('/api/update-account').send({ token: CALLER, userId: TEST_USER.id, ...body });

describe('POST /api/update-account', () => {
  afterEach(() => expectOwnerPredicatesBindIds());

  beforeEach(() => {
    resetMocks();
    isMailEnabled.mockReturnValue(true);
  });

  describe('the session checks it has always made', () => {
    it('rejects a missing token or userId', async () => {
      fakeAccount();
      const res = await request(app).post('/api/update-account').send({ name: 'someone' });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, message: 'Token and userId are required' });
    });

    it('rejects a session that belongs to another user', async () => {
      fakeAccount();
      const res = await request(app).post('/api/update-account').send({ token: CALLER, userId: 2, name: 'someone' });
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('rejects an empty update', async () => {
      fakeAccount();
      const res = await update({});
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/no fields/i);
    });

    it('rejects an invalid email, a weak password and a taken username, as before', async () => {
      const state = fakeAccount({ takenNames: ['takenuser'] });

      const badEmail = await update({ email: 'bad', currentPassword: CURRENT_PASSWORD });
      expect(badEmail.status).toBe(400);
      expect(badEmail.body.message).toMatch(/email/i);

      const weak = await update({ password: 'short', currentPassword: CURRENT_PASSWORD });
      expect(weak.status).toBe(400);
      expect(weak.body.message).toMatch(/password does not meet/i);

      const taken = await update({ name: 'takenuser' });
      expect(taken.status).toBe(409);
      expect(taken.body.message).toMatch(/taken/i);

      expect(writesTo(state, 'users')).toEqual([]);
      expect(writesTo(state, 'sessions')).toEqual([]);
    });
  });

  describe('a name change', () => {
    it('needs no current password, and leaves every session alone', async () => {
      const state = fakeAccount();

      const res = await update({ name: 'renamed' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(state.user.name).toBe('renamed');
      expect(state.sql).not.toContain('SELECT password_hash FROM users WHERE id = ? LIMIT 1');
      expect(writesTo(state, 'sessions')).toEqual([]);
      expect(generateSessionToken).not.toHaveBeenCalled();
      expect(await stillSignedIn(CALLER)).toBe(true);
      expect(await stillSignedIn(OTHER_HOLDER)).toBe(true);
    });

    it('needs nothing extra when the body repeats the unchanged email, as the account panel sends it', async () => {
      const state = fakeAccount();

      const res = await update({ name: 'renamed', email: TEST_USER.email });

      expect(res.status).toBe(200);
      expect(state.user).toMatchObject({ name: 'renamed', email: TEST_USER.email });
      expect(writesTo(state, 'users')).toEqual(['UPDATE users SET name = ? WHERE id = ?']);
      expect(writesTo(state, 'sessions')).toEqual([]);
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('answers success and writes nothing when the only field sent is the unchanged email', async () => {
      const state = fakeAccount();

      const res = await update({ email: TEST_USER.email });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(state.sql.filter(sql => !sql.startsWith('SELECT'))).toEqual([]);
    });
  });

  describe('refusals: a wrong or missing current password changes nothing', () => {
    const cases = [
      ['an email change with no current password', { email: NEW_EMAIL }, 400, /current password/i],
      ['an email change with an empty current password', { email: NEW_EMAIL, currentPassword: '' }, 400, /current password/i],
      ['an email change with a current password that is not a string', { email: NEW_EMAIL, currentPassword: 12345678 }, 400, /current password/i],
      ['an email change with the wrong current password', { email: NEW_EMAIL, currentPassword: 'not-the-password' }, 401, /current password is incorrect/i],
      ['a password change with no current password', { password: NEW_PASSWORD }, 400, /current password/i],
      ['a password change with the wrong current password', { password: NEW_PASSWORD, currentPassword: 'not-the-password' }, 401, /current password is incorrect/i],
      ['a name and email change with the wrong current password', { name: 'renamed', email: NEW_EMAIL, currentPassword: 'nope' }, 401, /current password is incorrect/i],
    ];

    it.each(cases)('refuses %s', async (_label, body, status, message) => {
      const state = fakeAccount();

      const res = await update(body);

      expect(res.status).toBe(status);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(message);
      expect(res.body.token).toBeUndefined();
      expect(state.user).toMatchObject({ name: TEST_USER.name, email: TEST_USER.email, password_hash: CURRENT_HASH });
      expect(writesTo(state, 'users')).toEqual([]);
      expect(writesTo(state, 'sessions')).toEqual([]);
      expect(generateSessionToken).not.toHaveBeenCalled();
      expect(sendEmail).not.toHaveBeenCalled();
      expect(await stillSignedIn(CALLER)).toBe(true);
    });

    it('checks the current password before saying whether the new email is taken', async () => {
      // Otherwise a session alone is an oracle for which addresses have accounts.
      const state = fakeAccount({ takenEmails: ['taken@example.com'] });

      const res = await update({ email: 'taken@example.com', currentPassword: 'wrong' });

      expect(res.status).toBe(401);
      expect(state.sql).not.toContain('SELECT id FROM users WHERE email = ? AND id != ? LIMIT 1');
    });

    it('still refuses a taken email once the current password is right', async () => {
      const state = fakeAccount({ takenEmails: ['taken@example.com'] });

      const res = await update({ email: 'taken@example.com', currentPassword: CURRENT_PASSWORD });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/already exists/i);
      expect(writesTo(state, 'users')).toEqual([]);
      expect(writesTo(state, 'sessions')).toEqual([]);
    });
  });

  describe('a password change with the right current password', () => {
    it('stores the new hash, deletes EVERY session of the user, and hands the caller a fresh token', async () => {
      const state = fakeAccount();

      const res = await update({ password: NEW_PASSWORD, currentPassword: CURRENT_PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, token: 'fresh-token-1' });
      expect(await bcrypt.compare(NEW_PASSWORD, state.user.password_hash)).toBe(true);

      // Every session of the user, the caller's included: no "keep this one".
      expect(writesTo(state, 'sessions')).toEqual(['DELETE FROM sessions WHERE user_id = ?']);
      const del = c2_query.mock.calls.find(([sql]) => /DELETE FROM sessions/.test(sql));
      expect(del[1]).toEqual([TEST_USER.id]);
      expect(state.sessions).toEqual(new Set(['fresh-token-1']));

      // The fresh token is minted only after the delete.
      const deleteOrder = c2_query.mock.invocationCallOrder[c2_query.mock.calls.indexOf(del)];
      expect(generateSessionToken.mock.invocationCallOrder[0]).toBeGreaterThan(deleteOrder);
      expect(generateSessionToken).toHaveBeenCalledTimes(1);
    });

    it('signs out a second holder of the old session, and the caller keeps working on the new token', async () => {
      fakeAccount();

      const res = await update({ password: NEW_PASSWORD, currentPassword: CURRENT_PASSWORD });

      expect(res.status).toBe(200);
      expect(await stillSignedIn(OTHER_HOLDER)).toBe(false);
      expect(await stillSignedIn(CALLER)).toBe(false);
      expect(await stillSignedIn(res.body.token)).toBe(true);
    });

    it('writes the password and deletes the sessions in one transaction', async () => {
      const state = fakeAccount();
      const inTransaction = [];
      withTransaction.mockImplementation(async (fn) => fn(async (sql, params) => {
        inTransaction.push(sql.replace(/\s+/g, ' ').trim());
        return c2_query(sql, params);
      }));

      await update({ password: NEW_PASSWORD, currentPassword: CURRENT_PASSWORD });

      expect(inTransaction).toEqual(['UPDATE users SET password_hash = ? WHERE id = ?', 'DELETE FROM sessions WHERE user_id = ?']);
      expect(state.sessions).toEqual(new Set(['fresh-token-1']));
    });

    it('mints no token when the transaction fails, so the caller is not handed a session for a change that did not land', async () => {
      fakeAccount();
      withTransaction.mockRejectedValueOnce(new Error('deadlock'));

      const res = await update({ password: NEW_PASSWORD, currentPassword: CURRENT_PASSWORD });

      expect(res.status).toBe(500);
      expect(generateSessionToken).not.toHaveBeenCalled();
    });

    it('sends no email-change notice', async () => {
      fakeAccount();
      await update({ password: NEW_PASSWORD, currentPassword: CURRENT_PASSWORD });
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('refuses an account with no password, pointing at Forgot password, and changes nothing', async () => {
      const state = fakeAccount({ passwordHash: null });

      const res = await update({ password: NEW_PASSWORD, currentPassword: 'anything' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/no password/i);
      expect(res.body.message).toMatch(/Forgot password/);
      expect(state.user.password_hash).toBeNull();
      expect(writesTo(state, 'users')).toEqual([]);
      expect(writesTo(state, 'sessions')).toEqual([]);
      expect(writesTo(state, 'two_factor_codes')).toEqual([]);
      expect(sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('an email change with the right current password', () => {
    it('writes the email, rotates every session, and sends a notice to the OLD address', async () => {
      const state = fakeAccount();

      const res = await update({ email: NEW_EMAIL, currentPassword: CURRENT_PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, token: 'fresh-token-1' });
      expect(state.user.email).toBe(NEW_EMAIL);
      expect(writesTo(state, 'sessions')).toEqual(['DELETE FROM sessions WHERE user_id = ?']);
      expect(state.sessions).toEqual(new Set(['fresh-token-1']));
      expect(await stillSignedIn(OTHER_HOLDER)).toBe(false);

      expect(sendEmail).toHaveBeenCalledTimes(1);
      const [notice] = sendEmail.mock.calls[0];
      expect(notice.to).toBe(TEST_USER.email);
      expect(notice.text).toContain(NEW_EMAIL);
      expect(notice.html).toContain(NEW_EMAIL);
    });

    it('rotates the sessions but sends no notice when mail is disabled', async () => {
      const state = fakeAccount();
      isMailEnabled.mockReturnValue(false);

      const res = await update({ email: NEW_EMAIL, currentPassword: CURRENT_PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.token).toBe('fresh-token-1');
      expect(state.user.email).toBe(NEW_EMAIL);
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('still succeeds when the notice fails to send, because the change has already landed', async () => {
      const state = fakeAccount();
      sendEmail.mockRejectedValueOnce(new Error('smtp down'));

      const res = await update({ email: NEW_EMAIL, currentPassword: CURRENT_PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.token).toBe('fresh-token-1');
      expect(state.user.email).toBe(NEW_EMAIL);
    });

    it('applies a name, email and password change together with one rotation', async () => {
      const state = fakeAccount();

      const res = await update({ name: 'renamed', email: NEW_EMAIL, password: NEW_PASSWORD, currentPassword: CURRENT_PASSWORD });

      expect(res.status).toBe(200);
      expect(state.user).toMatchObject({ name: 'renamed', email: NEW_EMAIL });
      expect(await bcrypt.compare(NEW_PASSWORD, state.user.password_hash)).toBe(true);
      expect(generateSessionToken).toHaveBeenCalledTimes(1);
      expect(state.sessions).toEqual(new Set(['fresh-token-1']));
      expect(sendEmail.mock.calls[0][0].to).toBe(TEST_USER.email);
    });
  });

  describe('an email change on an account with no password', () => {
    it('sends a code to the CURRENT address and changes nothing yet', async () => {
      const state = fakeAccount({ passwordHash: null });

      const res = await update({ email: NEW_EMAIL });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.requires_email_code).toBe(true);
      expect(res.body.confirmToken).toMatch(/^[0-9a-f]{64}$/);
      expect(res.body.token).toBeUndefined();

      // The token is purpose-bound and carries the address it confirms.
      expect(state.tokens).toHaveLength(1);
      expect(state.tokens[0]).toMatchObject({ user_id: TEST_USER.id, token: res.body.confirmToken, purpose: 'email_change', new_email: NEW_EMAIL });
      expect(state.codes).toHaveLength(1);

      expect(sendEmail).toHaveBeenCalledTimes(1);
      const [mail] = sendEmail.mock.calls[0];
      expect(mail.to).toBe(TEST_USER.email);
      expect(mail.text).toContain(state.codes[0].code);
      expect(mail.text).toContain(NEW_EMAIL);

      expect(state.user.email).toBe(TEST_USER.email);
      expect(writesTo(state, 'users')).toEqual([]);
      expect(writesTo(state, 'sessions')).toEqual([]);
      expect(generateSessionToken).not.toHaveBeenCalled();
    });

    it('ignores a current password sent anyway: the account has none to check it against', async () => {
      const state = fakeAccount({ passwordHash: null });

      const res = await update({ email: NEW_EMAIL, currentPassword: 'whatever' });

      expect(res.status).toBe(200);
      expect(res.body.requires_email_code).toBe(true);
      expect(state.user.email).toBe(TEST_USER.email);
    });

    it('invalidates earlier unused codes and earlier email-change tokens, scoped to that purpose', async () => {
      const state = fakeAccount({ passwordHash: null });

      const first = await update({ email: 'first@example.com' });
      const second = await update({ email: NEW_EMAIL });

      expect(state.codes.map(c => c.used)).toEqual([true, false]);
      expect(state.tokens.map(t => [t.token, t.used])).toEqual([[first.body.confirmToken, true], [second.body.confirmToken, false]]);
      const invalidate = c2_query.mock.calls.find(([sql]) => /^UPDATE password_reset_tokens SET used = TRUE WHERE user_id = \? AND purpose = \?/.test(sql.replace(/\s+/g, ' ').trim()));
      expect(invalidate[1]).toEqual([TEST_USER.id, 'email_change']);
    });

    it('applies a name change in the same request straight away, and leaves the email pending', async () => {
      const state = fakeAccount({ passwordHash: null });

      const res = await update({ name: 'renamed', email: NEW_EMAIL });

      expect(res.status).toBe(200);
      expect(res.body.requires_email_code).toBe(true);
      expect(state.user).toMatchObject({ name: 'renamed', email: TEST_USER.email });
      expect(writesTo(state, 'sessions')).toEqual([]);
    });

    it('refuses a taken address before sending any code', async () => {
      const state = fakeAccount({ passwordHash: null, takenEmails: [NEW_EMAIL] });

      const res = await update({ email: NEW_EMAIL });

      expect(res.status).toBe(409);
      expect(state.codes).toEqual([]);
      expect(state.tokens).toEqual([]);
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('refuses with a sentence saying why, and mints nothing, when mail is disabled', async () => {
      const state = fakeAccount({ passwordHash: null });
      isMailEnabled.mockReturnValue(false);

      const res = await update({ name: 'renamed', email: NEW_EMAIL });

      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/no password/i);
      expect(res.body.message).toMatch(/cannot send email/i);
      expect(res.body.confirmToken).toBeUndefined();
      expect(state.user).toMatchObject({ name: TEST_USER.name, email: TEST_USER.email });
      expect(writesTo(state, 'users')).toEqual([]);
      expect(writesTo(state, 'two_factor_codes')).toEqual([]);
      expect(writesTo(state, 'password_reset_tokens')).toEqual([]);
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('answers 500 and changes nothing when the code email fails to send', async () => {
      const state = fakeAccount({ passwordHash: null });
      sendEmail.mockRejectedValueOnce(new Error('smtp down'));

      const res = await update({ name: 'renamed', email: NEW_EMAIL });

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.confirmToken).toBeUndefined();
      expect(state.user).toMatchObject({ name: TEST_USER.name, email: TEST_USER.email });
    });
  });
});

describe('POST /api/update-account/confirm-email', () => {
  afterEach(() => expectOwnerPredicatesBindIds());

  beforeEach(() => {
    resetMocks();
    isMailEnabled.mockReturnValue(true);
  });

  /** Start an email change on a password-less account; returns the token and the emailed code. */
  async function startChange(state, email = NEW_EMAIL) {
    const res = await update({ email });
    expect(res.body.requires_email_code).toBe(true);
    return { confirmToken: res.body.confirmToken, code: state.codes[state.codes.length - 1].code };
  }

  const confirm = (body, token = CALLER) =>
    request(app).post('/api/update-account/confirm-email').set('Authorization', `Bearer ${token}`).send(body);

  it('changes the email, rotates every session, and sends a notice to the OLD address', async () => {
    const state = fakeAccount({ passwordHash: null });
    const { confirmToken, code } = await startChange(state);
    sendEmail.mockClear();

    const res = await confirm({ confirmToken, code });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, token: 'fresh-token-1', email: NEW_EMAIL });
    expect(state.user.email).toBe(NEW_EMAIL);
    expect(state.codes[0].used).toBe(true);
    expect(state.tokens[0].used).toBe(true);
    expect(writesTo(state, 'sessions')).toEqual(['DELETE FROM sessions WHERE user_id = ?']);
    expect(state.sessions).toEqual(new Set(['fresh-token-1']));
    expect(await stillSignedIn(OTHER_HOLDER)).toBe(false);
    expect(await stillSignedIn('fresh-token-1')).toBe(true);

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].to).toBe(TEST_USER.email);
    expect(sendEmail.mock.calls[0][0].text).toContain(NEW_EMAIL);
  });

  it('cannot be replayed: the same token and code a second time are refused', async () => {
    const state = fakeAccount({ passwordHash: null, sessions: [CALLER] });
    const { confirmToken, code } = await startChange(state);

    const first = await confirm({ confirmToken, code });
    const again = await confirm({ confirmToken, code }, first.body.token);

    expect(again.status).toBe(401);
    expect(generateSessionToken).toHaveBeenCalledTimes(1);
  });

  it('writes the email and deletes the sessions in one transaction', async () => {
    const state = fakeAccount({ passwordHash: null });
    const { confirmToken, code } = await startChange(state);
    const inTransaction = [];
    withTransaction.mockImplementation(async (fn) => fn(async (sql, params) => {
      inTransaction.push(sql.replace(/\s+/g, ' ').trim());
      return c2_query(sql, params);
    }));

    await confirm({ confirmToken, code });

    expect(inTransaction).toContain('UPDATE users SET email = ? WHERE id = ?');
    expect(inTransaction).toContain('DELETE FROM sessions WHERE user_id = ?');
  });

  it('sends no notice when mail has been disabled since the code went out', async () => {
    const state = fakeAccount({ passwordHash: null });
    const { confirmToken, code } = await startChange(state);
    sendEmail.mockClear();
    isMailEnabled.mockReturnValue(false);

    const res = await confirm({ confirmToken, code });

    expect(res.status).toBe(200);
    expect(state.user.email).toBe(NEW_EMAIL);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('still succeeds when the notice fails to send', async () => {
    const state = fakeAccount({ passwordHash: null });
    const { confirmToken, code } = await startChange(state);
    sendEmail.mockRejectedValueOnce(new Error('smtp down'));

    const res = await confirm({ confirmToken, code });

    expect(res.status).toBe(200);
    expect(state.user.email).toBe(NEW_EMAIL);
  });

  it('requires a session', async () => {
    const state = fakeAccount({ passwordHash: null });
    const { confirmToken, code } = await startChange(state);

    const res = await request(app).post('/api/update-account/confirm-email').send({ confirmToken, code });

    expect(res.status).toBe(401);
    expect(state.user.email).toBe(TEST_USER.email);
  });

  it('rejects a missing token or code', async () => {
    fakeAccount({ passwordHash: null });
    const res = await confirm({ confirmToken: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('rejects a wrong code and changes nothing', async () => {
    const state = fakeAccount({ passwordHash: null });
    const { confirmToken, code } = await startChange(state);

    const res = await confirm({ confirmToken, code: code === '000000' ? '111111' : '000000' });

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/invalid or expired verification code/i);
    expect(state.user.email).toBe(TEST_USER.email);
    expect(writesTo(state, 'sessions')).toEqual([]);
    expect(generateSessionToken).not.toHaveBeenCalled();
  });

  it('refuses a token minted by any other flow, binding the email_change purpose', async () => {
    const state = fakeAccount({ passwordHash: null });
    state.tokens.push({ id: 1, user_id: TEST_USER.id, token: 'reset-token', purpose: 'password_reset', new_email: null, used: false, expires_at: new Date(Date.now() + 600000) });

    const res = await confirm({ confirmToken: 'reset-token', code: '123456' });

    expect(res.status).toBe(401);
    const lookup = c2_query.mock.calls.find(([sql]) => /FROM password_reset_tokens WHERE token = \?/.test(sql));
    expect(lookup[1]).toEqual(['reset-token', 'email_change']);
    expect(state.user.email).toBe(TEST_USER.email);
  });

  it.each([
    ['used', { used: true }],
    ['expired', { expires_at: new Date(Date.now() - 1000) }],
    ['another user\'s', { user_id: 2 }],
  ])('refuses a %s token and changes nothing', async (_label, override) => {
    const state = fakeAccount({ passwordHash: null });
    const { confirmToken, code } = await startChange(state);
    Object.assign(state.tokens[0], override);

    const res = await confirm({ confirmToken, code });

    expect(res.status).toBe(401);
    expect(state.user.email).toBe(TEST_USER.email);
    expect(writesTo(state, 'sessions')).toEqual([]);
  });

  it('refuses an address another account took after the code went out', async () => {
    const taken = [];
    const state = fakeAccount({ passwordHash: null, takenEmails: taken });
    const { confirmToken, code } = await startChange(state);
    taken.push(NEW_EMAIL);

    const res = await confirm({ confirmToken, code });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already exists/i);
    expect(state.user.email).toBe(TEST_USER.email);
    expect(writesTo(state, 'sessions')).toEqual([]);
  });
});
