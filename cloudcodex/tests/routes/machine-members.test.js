import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { c2_query } from '../../mysql_connect.js';
import { closeSocketsForSessions as closeCollab } from '../../services/collab.js';
import { closeSocketsForSessions as closeInbox } from '../../services/user-channel.js';
import { mockAuthenticated, mockUnauthenticated, resetMocks } from '../helpers.js';

/**
 * W6-CDX-9 - PUT /api/machine/members, DELETE /api/machine/members, DELETE /api/machine/members/:email
 *
 * The membership sync from Cloud Command (W6-CMD-7). Machine-only (requireMachine). A subject (issuer and
 * subject) is the identity when the sync has one; the address finds an account only when no identity exists
 * yet, and never one that holds a different identity at that issuer.
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
const ISSUER = 'https://id.example.test';
const HEX64 = /^[0-9a-f]{64}$/;

const writes = () =>
  c2_query.mock.calls
    .map(([sql, params]) => [sql.replace(/\s+/g, ' ').trim(), params])
    .filter(([sql]) => /^(INSERT|UPDATE|DELETE)\b/i.test(sql));
const reads = (re) => c2_query.mock.calls.map(([sql]) => sql.replace(/\s+/g, ' ')).filter((sql) => re.test(sql));

/**
 * Answer each query by its text. Rules are [pattern, value-or-function]; the first match wins, and a query no
 * rule matches answers []. Writes answer { affectedRows: 1 } so a conditional write reads as applied.
 */
function answer(rules) {
  c2_query.mockImplementation(async (sql, params) => {
    const flat = sql.replace(/\s+/g, ' ').trim();
    for (const [pattern, value] of rules) {
      if (pattern.test(flat)) return typeof value === 'function' ? value(params, flat) : value;
    }
    if (/^(INSERT|UPDATE|DELETE)\b/i.test(flat)) return { affectedRows: 1, insertId: 500 };
    return [];
  });
}

const PRINCIPAL = [/FROM users WHERE email = \? AND deactivated_at IS NULL/, [SERVICE_ROW]];
/** A holder answer for the address lookup (users.email, or an identity's last sign-in address). */
const holders = (...rows) => [/UNION SELECT u\.id/, rows];
const identityHit = (row) => [/JOIN users u ON u\.id = ui\.user_id WHERE ui\.issuer/, row ? [row] : []];
const issuerLink = (subject) => [/SELECT subject FROM user_identities WHERE user_id/, subject ? [{ subject }] : []];
const openInvitation = (row) => [/SELECT id, squad_id FROM user_invitations/, row ? [row] : []];
const general = (id) => [/SELECT s\.id FROM squads s/, id === null ? [] : [{ id }]];
const memberOfGeneral = (yes) => [/SELECT id FROM squad_members WHERE squad_id/, yes ? [{ id: 1 }] : []];
const digests = (...ids) => [/SELECT id FROM sessions WHERE user_id/, ids.map((id) => ({ id }))];

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
  const delBySubject = (query, token = SERVICE_TOKEN) =>
    request(app).delete('/api/machine/members').query(query).set('Authorization', `Bearer ${token}`);

  describe('PUT: an address nobody holds gets an invitation', () => {
    it('an owner (admin) gets an invitation that grants admin, names General, and can write', async () => {
      answer([PRINCIPAL, holders(), openInvitation(null), general(4)]);

      const res = await put({ email: 'owner@example.com', role: 'admin' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      const [sql, params] = writes().at(-1);
      expect(sql).toMatch(/^INSERT INTO user_invitations/);
      // email, token, invited_by, grants_admin, squad_id, can_write
      expect(params[0]).toBe('owner@example.com');
      expect(params[1]).toMatch(HEX64);
      expect(params[2]).toBe(SERVICE_ROW.id);
      expect(params.slice(3)).toEqual([true, 4, true]);
    });

    it('a member gets an invitation that does not grant admin', async () => {
      answer([PRINCIPAL, holders(), openInvitation(null), general(4)]);
      await put({ email: 'member@example.com', role: 'member' });
      expect(writes().at(-1)[1].slice(3)).toEqual([false, 4, true]);
    });

    it('with General gone, inserts one with a NULL squad and can_write false', async () => {
      answer([PRINCIPAL, holders(), openInvitation(null), general(null)]);
      const res = await put({ email: 'late@example.com', role: 'member' });
      expect(res.status).toBe(200);
      expect(writes().at(-1)[1].slice(3)).toEqual([false, null, false]);
    });

    it('an open invitation with no squad is refreshed and names General', async () => {
      answer([PRINCIPAL, holders(), openInvitation({ id: 3, squad_id: null }), general(4)]);
      await put({ email: 'open@example.com', role: 'admin' });
      const [sql, params] = writes().at(-1);
      expect(sql).toMatch(/^UPDATE user_invitations/);
      expect(sql).toMatch(/squad_id = COALESCE\(squad_id, \?\)/);
      expect(params).toEqual([true, SERVICE_ROW.id, 4, true, 3]);
    });

    it('an open invitation that already names a squad keeps it, and looks for no General squad', async () => {
      answer([PRINCIPAL, holders(), openInvitation({ id: 3, squad_id: 7 })]);
      await put({ email: 'kept@example.com', role: 'member' });
      expect(reads(/FROM squads/)).toEqual([]);
      expect(writes().at(-1)[1]).toEqual([false, SERVICE_ROW.id, null, false, 3]);
    });
  });

  describe('PUT: an existing account gets its admin flag, and a place in General (D-S)', () => {
    const ada = { id: 21, email: 'ada@example.com', is_admin: 0, deactivated_at: null };

    it('sets is_admin and places the account in General with read and write, when it is not there', async () => {
      answer([PRINCIPAL, holders(ada), general(4), memberOfGeneral(false)]);

      expect((await put({ email: 'ada@example.com', role: 'admin' })).status).toBe(200);

      expect(writes().map(([, p]) => p)).toEqual([
        [true, 21],
        [4, 21, 'member', true, true, false, false, false, false, false],
      ]);
      expect(writes()[0][0]).toBe('UPDATE users SET is_admin = ? WHERE id = ?');
      expect(writes()[1][0]).toMatch(/^INSERT INTO squad_members/);
      expect(reads(/user_invitations/)).toEqual([]);
    });

    it('leaves an existing General membership exactly as it is (idempotent)', async () => {
      answer([PRINCIPAL, holders(ada), general(4), memberOfGeneral(true)]);
      await put({ email: 'ada@example.com', role: 'member' });
      expect(writes().map(([sql]) => sql)).toEqual(['UPDATE users SET is_admin = ? WHERE id = ?']);
    });

    it('places nothing when General is gone', async () => {
      answer([PRINCIPAL, holders(ada), general(null)]);
      await put({ email: 'ada@example.com', role: 'member' });
      expect(writes().map(([sql]) => sql)).toEqual(['UPDATE users SET is_admin = ? WHERE id = ?']);
    });

    it('a re-role from admin to member writes is_admin FALSE', async () => {
      answer([PRINCIPAL, holders({ ...ada, is_admin: 1 }), general(4), memberOfGeneral(true)]);
      await put({ email: 'ada@example.com', role: 'member' });
      expect(writes()[0][1]).toEqual([false, 21]);
    });

    it('an ownership transfer writes exactly the two is_admin values, and nothing for the boot admin', async () => {
      const newOwner = { id: 21, email: 'new@example.com', is_admin: 0, deactivated_at: null };
      const oldOwner = { id: 22, email: 'old@example.com', is_admin: 1, deactivated_at: null };
      answer([PRINCIPAL, [/UNION SELECT u\.id/, (params) => (params[0] === 'new@example.com' ? [newOwner] : [oldOwner])], general(4), memberOfGeneral(true)]);

      await put({ email: 'new@example.com', role: 'admin' });
      await put({ email: 'old@example.com', role: 'member' });

      const adminWrites = writes().filter(([sql]) => /is_admin = \?/.test(sql)).map(([, p]) => p);
      expect(adminWrites).toEqual([[true, 21], [false, 22]]);
      expect(adminWrites.some((p) => p.includes(1))).toBe(false);
    });

    it('re-admits a deactivated user only when the request says reactivate', async () => {
      answer([PRINCIPAL, holders({ ...ada, deactivated_at: new Date() }), general(4), memberOfGeneral(true)]);
      const res = await put({ email: 'ada@example.com', role: 'member', reactivate: true });
      expect(res.status).toBe(200);
      expect(writes()[0][0]).toMatch(/deactivated_at = NULL/);
      expect(writes()[0][1]).toEqual([false, 21]);
    });

    it('refuses a deactivated user without reactivate as 409 account_deactivated, and writes nothing', async () => {
      answer([PRINCIPAL, holders({ ...ada, deactivated_at: new Date() })]);
      const res = await put({ email: 'ada@example.com', role: 'member' });
      expect(res.status).toBe(409);
      expect(res.body.reason).toBe('account_deactivated');
      expect(writes()).toEqual([]);
    });

    it('refuses an address that matches two accounts as 409 ambiguous, and writes nothing', async () => {
      answer([PRINCIPAL, holders(ada, { ...ada, id: 22 })]);
      const res = await put({ email: 'ada@example.com', role: 'admin' });
      expect(res.status).toBe(409);
      expect(res.body.reason).toBe('ambiguous_address');
      expect(writes()).toEqual([]);
    });
  });

  describe('a subject (issuer and subject) is the identity when the sync has one', () => {
    const ada = { id: 21, email: 'ada@example.com', is_admin: 0, deactivated_at: null };

    it('PUT by subject updates the identity\'s account, and never looks the address up', async () => {
      answer([PRINCIPAL, identityHit(ada), general(4), memberOfGeneral(true)]);

      const res = await put({ email: 'renamed@example.com', role: 'admin', issuer: ISSUER, subject: 'sub-ada' });

      expect(res.status).toBe(200);
      expect(writes()[0][1]).toEqual([true, 21]);
      expect(reads(/UNION SELECT u\.id/)).toEqual([]);
    });

    it('PUT by subject with no identity and no account holding the address invites it', async () => {
      answer([PRINCIPAL, identityHit(null), holders(), openInvitation(null), general(4)]);
      const res = await put({ email: 'new@example.com', role: 'member', issuer: ISSUER, subject: 'sub-new' });
      expect(res.status).toBe(200);
      expect(writes().at(-1)[0]).toMatch(/^INSERT INTO user_invitations/);
    });

    it('PUT by subject refuses an address held by an account with a DIFFERENT identity at this issuer, as 409', async () => {
      answer([PRINCIPAL, identityHit(null), holders(ada), issuerLink('sub-someone-else')]);
      const res = await put({ email: 'ada@example.com', role: 'admin', issuer: ISSUER, subject: 'sub-new' });
      expect(res.status).toBe(409);
      expect(res.body.reason).toBe('identity_conflict');
      expect(writes()).toEqual([]);
    });

    it('PUT by subject with no identity updates an account holding the address that has no identity at this issuer', async () => {
      answer([PRINCIPAL, identityHit(null), holders(ada), issuerLink(null), general(4), memberOfGeneral(true)]);
      const res = await put({ email: 'ada@example.com', role: 'admin', issuer: ISSUER, subject: 'sub-ada' });
      expect(res.status).toBe(200);
      expect(writes()[0][1]).toEqual([true, 21]);
    });

    it('an issuer without its subject (or the reverse) is 400, and nothing is looked up', async () => {
      answer([PRINCIPAL]);
      expect((await put({ email: 'x@example.com', role: 'member', issuer: ISSUER })).status).toBe(400);
      expect((await put({ email: 'x@example.com', role: 'member', subject: 'sub' })).status).toBe(400);
      expect(writes()).toEqual([]);
    });

    it('DELETE by subject deactivates the identity\'s account, deletes its sessions, and closes its sockets', async () => {
      answer([PRINCIPAL, identityHit(ada), digests('d1', 'd2')]);
      const res = await delBySubject({ issuer: ISSUER, subject: 'sub-ada' });
      expect(res.status).toBe(200);
      expect(writes().map(([sql]) => sql)).toEqual([
        'UPDATE users SET deactivated_at = COALESCE(deactivated_at, NOW()), is_admin = FALSE WHERE id = ?',
        'DELETE FROM sessions WHERE user_id = ?',
      ]);
      expect(closeCollab).toHaveBeenCalledWith(['d1', 'd2']);
      expect(closeInbox).toHaveBeenCalledWith(['d1', 'd2']);
    });

    it('DELETE by subject with no identity is the same success, and writes nothing', async () => {
      answer([PRINCIPAL, identityHit(null)]);
      const res = await delBySubject({ issuer: ISSUER, subject: 'sub-nobody' });
      expect(res.status).toBe(200);
      expect(writes()).toEqual([]);
    });

    it('DELETE by the address route, with the subject in the query, removes only the identity\'s account', async () => {
      answer([PRINCIPAL, identityHit(ada), digests('d1')]);
      const res = await request(app)
        .delete('/api/machine/members/someone-else%40example.com')
        .query({ issuer: ISSUER, subject: 'sub-ada' })
        .set('Authorization', `Bearer ${SERVICE_TOKEN}`);
      expect(res.status).toBe(200);
      expect(writes().find(([sql]) => /UPDATE users/.test(sql))[1]).toEqual([21]);
      expect(reads(/UNION SELECT u\.id/)).toEqual([]);
    });

    it('DELETE with neither a subject nor an address is 400', async () => {
      answer([PRINCIPAL]);
      const res = await request(app).delete('/api/machine/members').set('Authorization', `Bearer ${SERVICE_TOKEN}`);
      expect(res.status).toBe(400);
      expect(writes()).toEqual([]);
    });
  });

  describe('the boot admin and the machine principal are never the sync\'s to change', () => {
    it('ADMIN_EMAIL gets 409 from PUT, in any letter case, and issues no write', async () => {
      answer([PRINCIPAL]);
      const res = await put({ email: 'OPS@cloudcitycomputing.com', role: 'member' });
      expect(res.status).toBe(409);
      expect(writes()).toEqual([]);
    });

    it('ADMIN_EMAIL gets 409 from DELETE, and issues no write', async () => {
      answer([PRINCIPAL]);
      expect((await del(BOOT_EMAIL)).status).toBe(409);
      expect(writes()).toEqual([]);
      expect(closeCollab).not.toHaveBeenCalled();
    });

    it('an address whose account is the machine principal itself is 409 on DELETE, and nothing is written', async () => {
      answer([PRINCIPAL, holders({ id: SERVICE_ROW.id, email: SERVICE_ROW.email, is_admin: 0, deactivated_at: null })]);
      expect((await del(SERVICE_ROW.email)).status).toBe(409);
      expect(writes()).toEqual([]);
    });

    it('an identity whose account is the boot admin is 409, even under another address', async () => {
      answer([PRINCIPAL, identityHit({ id: 1, email: BOOT_EMAIL, is_admin: 1, deactivated_at: null })]);
      const res = await put({ email: 'alias@example.com', role: 'member', issuer: ISSUER, subject: 'sub-boot' });
      expect(res.status).toBe(409);
      expect(writes()).toEqual([]);
    });

    it('an address that resolves to the boot admin row is 409', async () => {
      answer([PRINCIPAL, holders({ id: 1, email: BOOT_EMAIL, is_admin: 1, deactivated_at: null })]);
      const res = await put({ email: 'alias@example.com', role: 'member' });
      expect(res.status).toBe(409);
      expect(writes()).toEqual([]);
    });
  });

  describe('input and authentication', () => {
    it('a bad email or role is 400', async () => {
      answer([PRINCIPAL]);
      expect((await put({ email: 'not-an-email', role: 'member' })).status).toBe(400);
      expect((await put({ email: 'ok@example.com', role: 'owner' })).status).toBe(400);
      expect((await put({ email: 'ok@example.com' })).status).toBe(400);
      expect((await del('not-an-email')).status).toBe(400);
      expect(writes()).toEqual([]);
    });

    it('a logged-in session gets the same 401 an anonymous caller gets', async () => {
      // The principal row is queued and unused on the passing path: a route that fell through to a session would answer 200.
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

  describe('DELETE by address: removal ends the member here', () => {
    it('expires invitations, deactivates, deletes the sessions, and closes both socket sets with exactly those digests', async () => {
      answer([PRINCIPAL, holders({ id: 21, email: 'leaver@example.com', is_admin: 1, deactivated_at: null }), digests('digest-a', 'digest-b')]);
      const res = await del('leaver@example.com');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      const sqls = writes().map(([sql]) => sql);
      expect(sqls[0]).toMatch(/^UPDATE user_invitations SET expires_at = NOW\(\)/);
      const deactivate = writes().find(([sql]) => /UPDATE users/.test(sql));
      expect(deactivate[0]).toMatch(/deactivated_at = COALESCE\(deactivated_at, NOW\(\)\), is_admin = FALSE/);
      expect(deactivate[1]).toEqual([21]);
      expect(closeCollab).toHaveBeenCalledWith(['digest-a', 'digest-b']);
      expect(closeInbox).toHaveBeenCalledWith(['digest-a', 'digest-b']);
    });

    it('an unknown address answers the same success, and only expires any invitation', async () => {
      answer([PRINCIPAL]);
      const res = await del('nobody@example.com');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(writes().map(([sql]) => sql)).toEqual([expect.stringMatching(/^UPDATE user_invitations/)]);
      expect(closeCollab).toHaveBeenCalledWith([]);
    });

    it('refuses a removal that matches two accounts as 409, before any write', async () => {
      answer([PRINCIPAL, holders({ id: 21, email: 'a@example.com', is_admin: 0, deactivated_at: null }, { id: 22, email: 'b@example.com', is_admin: 0, deactivated_at: null })]);
      expect((await del('a@example.com')).status).toBe(409);
      expect(writes()).toEqual([]);
    });
  });
});
