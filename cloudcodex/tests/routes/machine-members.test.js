import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { c2_query } from '../../mysql_connect.js';
import { closeSocketsForSessions as closeCollab } from '../../services/collab.js';
import { closeSocketsForSessions as closeInbox } from '../../services/user-channel.js';
import { mockAuthenticated, mockUnauthenticated, resetMocks } from '../helpers.js';

/**
 * W6-CDX-9 - PUT /api/machine/members and DELETE /api/machine/members/:email
 *
 * The membership sync from Cloud Command (W6-CMD-7). Machine-only (requireMachine): a session never
 * reaches these, whatever its role. Members are found by address here because the wire carries an
 * address, but nothing is keyed on it as an identity: the effects land on the user row, and sign-in
 * keys on (issuer, subject) and refuses a deactivated row.
 */

vi.mock('../../services/collab.js', () => ({
  getAllPresence: vi.fn(() => ({})),
  getActiveDocCount: vi.fn(() => 0),
  closeSocketsForSessions: vi.fn(() => 0),
}));
vi.mock('../../services/user-channel.js', async (importOriginal) => ({
  ...(await importOriginal()),
  closeSocketsForSessions: vi.fn(() => 0),
}));

const SERVICE_TOKEN = 'cloud-command-service-token-membership-00';
const SERVICE_ROW = { id: 9, name: 'cloud-command', email: 'svc@example.com', is_admin: 0 };
const BOOT_EMAIL = 'ops@cloudcitycomputing.com';
const HEX64 = /^[0-9a-f]{64}$/;

/** The writes a test made, as [sql, params] with whitespace squashed. */
const writes = () =>
  c2_query.mock.calls
    .map(([sql, params]) => [sql.replace(/\s+/g, ' ').trim(), params])
    .filter(([sql]) => /^(INSERT|UPDATE|DELETE)\b/i.test(sql));

/** The row(s) the address lookup returns: one user, or several for the ambiguity refusal. */
const matched = (...rows) => rows;

describe('the machine membership routes (W6-CDX-9)', () => {
  beforeEach(() => {
    resetMocks();
    process.env.SERVICE_TOKEN = SERVICE_TOKEN;
    process.env.SERVICE_TOKEN_USER = 'svc@example.com';
    process.env.ADMIN_EMAIL = BOOT_EMAIL;
    delete process.env.AUTH_PROVIDERS;
    mockUnauthenticated();
    closeCollab.mockClear();
    closeInbox.mockClear();
  });

  afterEach(() => {
    delete process.env.SERVICE_TOKEN;
    delete process.env.SERVICE_TOKEN_USER;
    delete process.env.ADMIN_EMAIL;
  });

  const put = (body, token = SERVICE_TOKEN) =>
    request(app).put('/api/machine/members').set('Authorization', `Bearer ${token}`).send(body);
  const del = (email, token = SERVICE_TOKEN) =>
    request(app).delete(`/api/machine/members/${encodeURIComponent(email)}`).set('Authorization', `Bearer ${token}`);

  describe('PUT: an address nobody holds gets an invitation', () => {
    it('an owner (admin) gets an invitation that grants admin, names General, and can write', async () => {
      c2_query
        .mockResolvedValueOnce([SERVICE_ROW])   // principal
        .mockResolvedValueOnce([])              // address lookup: no user, no identity
        .mockResolvedValueOnce([])              // open invitation: none
        .mockResolvedValueOnce([{ id: 4 }])     // General squad
        .mockResolvedValueOnce({ insertId: 30 }); // INSERT user_invitations

      const res = await put({ email: 'owner@example.com', role: 'admin' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      const [sql, params] = writes().at(-1);
      expect(sql).toMatch(/^INSERT INTO user_invitations/);
      // email, token, invited_by, grants_admin, squad_id, can_write
      expect(params[0]).toBe('owner@example.com');
      expect(params[1]).toMatch(HEX64);
      expect(params[2]).toBe(SERVICE_ROW.id);
      expect(params[3]).toBe(true);
      expect(params[4]).toBe(4);
      expect(params[5]).toBe(true);
    });

    it('a member gets an invitation that does not grant admin', async () => {
      c2_query
        .mockResolvedValueOnce([SERVICE_ROW])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 4 }])
        .mockResolvedValueOnce({ insertId: 31 });

      await put({ email: 'member@example.com', role: 'member' });

      const [, params] = writes().at(-1);
      expect(params[3]).toBe(false);
      expect(params[4]).toBe(4);
    });

    it('with General gone, inserts one with a NULL squad and can_write false, and nothing is placed', async () => {
      c2_query
        .mockResolvedValueOnce([SERVICE_ROW])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])              // no General squad
        .mockResolvedValueOnce({ insertId: 32 });

      const res = await put({ email: 'late@example.com', role: 'member' });

      expect(res.status).toBe(200);
      const [, params] = writes().at(-1);
      expect(params[4]).toBeNull();
      expect(params[5]).toBe(false);
    });

    it('an open invitation with no squad is refreshed and names General', async () => {
      c2_query
        .mockResolvedValueOnce([SERVICE_ROW])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 3, squad_id: null }])
        .mockResolvedValueOnce([{ id: 4 }])
        .mockResolvedValueOnce({ affectedRows: 1 });

      await put({ email: 'open@example.com', role: 'admin' });

      const [sql, params] = writes().at(-1);
      expect(sql).toMatch(/^UPDATE user_invitations/);
      expect(sql).toMatch(/squad_id = COALESCE\(squad_id, \?\)/);
      // grants_admin, invited_by, squad, can_write, invitation id
      expect(params).toEqual([true, SERVICE_ROW.id, 4, true, 3]);
    });

    it('an open invitation that already names a squad keeps it, and looks for no General squad', async () => {
      c2_query
        .mockResolvedValueOnce([SERVICE_ROW])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 3, squad_id: 7 }])
        .mockResolvedValueOnce({ affectedRows: 1 });

      await put({ email: 'kept@example.com', role: 'member' });

      const calls = c2_query.mock.calls.map(([sql]) => sql);
      expect(calls.some(sql => /FROM squads/.test(sql))).toBe(false);
      const [, params] = writes().at(-1);
      expect(params).toEqual([false, SERVICE_ROW.id, null, false, 3]);
    });
  });

  describe('PUT: an address with a user gets its admin flag, and nothing else', () => {
    it('sets is_admin for an existing user and issues no invitation or squad query', async () => {
      c2_query
        .mockResolvedValueOnce([SERVICE_ROW])
        .mockResolvedValueOnce(matched({ id: 21, email: 'ada@example.com', is_admin: 0, deactivated_at: null }))
        .mockResolvedValueOnce({ affectedRows: 1 });

      const res = await put({ email: 'ada@example.com', role: 'admin' });

      expect(res.status).toBe(200);
      const calls = c2_query.mock.calls.map(([sql]) => sql);
      expect(calls.some(sql => /user_invitations/.test(sql))).toBe(false);
      expect(calls.some(sql => /FROM squads/.test(sql))).toBe(false);
      expect(writes()).toEqual([[expect.stringMatching(/^UPDATE users SET is_admin = \? WHERE id = \?$/), [true, 21]]]);
    });

    it('a re-role from admin to member writes is_admin FALSE', async () => {
      c2_query
        .mockResolvedValueOnce([SERVICE_ROW])
        .mockResolvedValueOnce(matched({ id: 21, email: 'ada@example.com', is_admin: 1, deactivated_at: null }))
        .mockResolvedValueOnce({ affectedRows: 1 });

      await put({ email: 'ada@example.com', role: 'member' });

      expect(writes().at(-1)[1]).toEqual([false, 21]);
    });

    it('an ownership transfer writes exactly the two is_admin values, and nothing for the boot admin', async () => {
      // The new owner first (admin), then the old owner (member), as W6-CMD-7 orders them.
      c2_query
        .mockResolvedValueOnce([SERVICE_ROW])
        .mockResolvedValueOnce(matched({ id: 21, email: 'new@example.com', is_admin: 0, deactivated_at: null }))
        .mockResolvedValueOnce({ affectedRows: 1 })
        .mockResolvedValueOnce([SERVICE_ROW])
        .mockResolvedValueOnce(matched({ id: 22, email: 'old@example.com', is_admin: 1, deactivated_at: null }))
        .mockResolvedValueOnce({ affectedRows: 1 });

      await put({ email: 'new@example.com', role: 'admin' });
      await put({ email: 'old@example.com', role: 'member' });

      const changed = writes().map(([, params]) => params);
      expect(changed).toEqual([[true, 21], [false, 22]]);
      // The boot admin's row (id 1) is never written by the sync.
      expect(changed.some(params => params.includes(1))).toBe(false);
    });

    it('re-admits a deactivated user only when the request says reactivate', async () => {
      c2_query
        .mockResolvedValueOnce([SERVICE_ROW])
        .mockResolvedValueOnce(matched({ id: 21, email: 'back@example.com', is_admin: 0, deactivated_at: new Date() }))
        .mockResolvedValueOnce({ affectedRows: 1 });

      const res = await put({ email: 'back@example.com', role: 'member', reactivate: true });

      expect(res.status).toBe(200);
      const [sql, params] = writes().at(-1);
      expect(sql).toMatch(/deactivated_at = NULL/);
      expect(params).toEqual([false, 21]);
    });

    it('refuses a deactivated user without reactivate as 409 account_deactivated, and writes nothing', async () => {
      c2_query
        .mockResolvedValueOnce([SERVICE_ROW])
        .mockResolvedValueOnce(matched({ id: 21, email: 'gone@example.com', is_admin: 0, deactivated_at: new Date() }));

      const res = await put({ email: 'gone@example.com', role: 'member' });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.reason).toBe('account_deactivated');
      expect(writes()).toEqual([]);
    });

    it('refuses an address that matches two accounts as 409 ambiguous, and writes nothing', async () => {
      c2_query
        .mockResolvedValueOnce([SERVICE_ROW])
        .mockResolvedValueOnce(matched(
          { id: 21, email: 'shared@example.com', is_admin: 0, deactivated_at: null },
          { id: 22, email: 'other@example.com', is_admin: 0, deactivated_at: null },
        ));

      const res = await put({ email: 'shared@example.com', role: 'admin' });

      expect(res.status).toBe(409);
      expect(res.body.reason).toBe('ambiguous_address');
      expect(writes()).toEqual([]);
    });
  });

  describe('the boot admin and the machine principal are never the sync\'s to change', () => {
    it('ADMIN_EMAIL gets 409 from PUT, in any letter case, and issues no write', async () => {
      c2_query.mockResolvedValue([SERVICE_ROW]);
      const res = await put({ email: 'OPS@cloudcitycomputing.com', role: 'member' });

      expect(res.status).toBe(409);
      expect(writes()).toEqual([]);
    });

    it('ADMIN_EMAIL gets 409 from DELETE, and issues no write', async () => {
      c2_query.mockResolvedValue([SERVICE_ROW]);
      const res = await del(BOOT_EMAIL);

      expect(res.status).toBe(409);
      expect(writes()).toEqual([]);
      expect(closeCollab).not.toHaveBeenCalled();
    });

    it('an address whose account is the machine principal itself is 409 on DELETE, and nothing is written', async () => {
      c2_query
        .mockResolvedValueOnce([SERVICE_ROW])
        .mockResolvedValueOnce(matched({ id: SERVICE_ROW.id, email: SERVICE_ROW.email, is_admin: 0, deactivated_at: null }));

      const res = await del(SERVICE_ROW.email);

      expect(res.status).toBe(409);
      expect(writes()).toEqual([]);
    });

    it('an address that a boot-admin identity answers to resolves to the boot admin row, and is 409', async () => {
      // The boot admin signed in through an issuer alias: the address is not ADMIN_EMAIL, but the
      // identity recorded it as its last sign-in address, so the lookup returns the boot row itself.
      c2_query
        .mockResolvedValueOnce([SERVICE_ROW])
        .mockResolvedValueOnce(matched({ id: 1, email: BOOT_EMAIL, is_admin: 1, deactivated_at: null }));

      const res = await put({ email: 'alias@example.com', role: 'member' });

      expect(res.status).toBe(409);
      expect(writes()).toEqual([]);
    });
  });

  describe('input and authentication', () => {
    it('a bad email or role is 400', async () => {
      c2_query.mockResolvedValue([SERVICE_ROW]);

      expect((await put({ email: 'not-an-email', role: 'member' })).status).toBe(400);
      expect((await put({ email: 'ok@example.com', role: 'owner' })).status).toBe(400);
      expect((await put({ email: 'ok@example.com' })).status).toBe(400);
      expect((await del('not-an-email')).status).toBe(400);
      expect(writes()).toEqual([]);
    });

    it('a logged-in session gets the same 401 an anonymous caller gets', async () => {
      // The principal row is queued and unused on the passing path: a route that fell through to a
      // session would find an authenticated user and answer 200 (the C2-5 false-green guard).
      c2_query.mockResolvedValueOnce([SERVICE_ROW]);
      mockAuthenticated({ id: 5, name: 'member', email: 'member@example.com', is_admin: 1 });

      const res = await put({ email: 'x@example.com', role: 'admin' }, 'a-real-session-token');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ success: false, message: 'Authentication required' });
      expect(writes()).toEqual([]);
    });

    it('an anonymous caller gets 401 and no write', async () => {
      const res = await request(app).put('/api/machine/members').send({ email: 'x@example.com', role: 'member' });
      expect(res.status).toBe(401);
      expect(writes()).toEqual([]);
    });
  });

  describe('DELETE: removal ends the member here', () => {
    it('expires invitations, deactivates, deletes the sessions, and closes both socket sets with exactly those digests', async () => {
      c2_query
        .mockResolvedValueOnce([SERVICE_ROW])
        .mockResolvedValueOnce(matched({ id: 21, email: 'leaver@example.com', is_admin: 1, deactivated_at: null }))
        .mockResolvedValueOnce({ affectedRows: 0 })         // expire open invitations
        .mockResolvedValueOnce({ affectedRows: 1 })         // deactivate
        .mockResolvedValueOnce([{ id: 'digest-a' }, { id: 'digest-b' }])
        .mockResolvedValueOnce({ affectedRows: 2 });        // delete sessions

      const res = await del('leaver@example.com');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      const sqls = writes().map(([sql]) => sql);
      expect(sqls.some(sql => /UPDATE user_invitations SET expires_at = NOW\(\)/.test(sql))).toBe(true);
      const deactivate = writes().find(([sql]) => /UPDATE users/.test(sql));
      expect(deactivate[0]).toMatch(/deactivated_at = COALESCE\(deactivated_at, NOW\(\)\), is_admin = FALSE/);
      expect(deactivate[1]).toEqual([21]);
      expect(closeCollab).toHaveBeenCalledWith(['digest-a', 'digest-b']);
      expect(closeInbox).toHaveBeenCalledWith(['digest-a', 'digest-b']);
    });

    it('an unknown address answers the same success, and only expires any invitation', async () => {
      c2_query
        .mockResolvedValueOnce([SERVICE_ROW])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce({ affectedRows: 0 });

      const res = await del('nobody@example.com');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(writes().map(([sql]) => sql)).toEqual([expect.stringMatching(/^UPDATE user_invitations/)]);
      expect(closeCollab).toHaveBeenCalledWith([]);
      expect(closeInbox).toHaveBeenCalledWith([]);
    });

    it('refuses a removal that matches two accounts as 409, before any write', async () => {
      c2_query
        .mockResolvedValueOnce([SERVICE_ROW])
        .mockResolvedValueOnce(matched({ id: 21, email: 'a@example.com', is_admin: 0, deactivated_at: null }, { id: 22, email: 'b@example.com', is_admin: 0, deactivated_at: null }));

      const res = await del('a@example.com');

      expect(res.status).toBe(409);
      expect(writes()).toEqual([]);
    });
  });
});
