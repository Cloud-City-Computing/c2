/**
 * The membership sync, end to end on a real server (W6-CDX-9)
 *
 * The route tests pin the queries; this file proves what MySQL does with them. A hosted boot seeds the
 * starter workspace and its General squad. The sync admits an owner (admin) and a member; both sign in
 * through an issuer, the owner is an admin, the member is not, and both land in General with read and
 * write. Ownership moves. A removed member's sessions end and their sign-in is refused, and what they
 * wrote keeps its author. The address the issuer reports now still finds the member for removal.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import app from '../../app.js';
import { c2_query, generateSessionToken, validateAndAutoLogin } from '../../mysql_connect.js';
import { ensureAdminUser, bootstrapInstance } from '../../routes/admin.js';
import { resolveIdentity } from '../../services/identity.js';

const ISSUER = 'https://id.example.test';
const POLICY = { linkByVerifiedEmail: true, autoCreate: false };
const originalEnv = { ...process.env };

let tag;
let adminEmail;
let serviceEmail;
let token;
let errorSpy;

const claims = (subject, email) => ({
  provider: 'oidc', issuer: ISSUER, subject, email, emailVerified: true, name: 'Test',
});
const put = (email, role, extra = {}) =>
  request(app).put('/api/machine/members').set('Authorization', `Bearer ${token}`).send({ email, role, ...extra });
const del = (email) =>
  request(app).delete(`/api/machine/members/${encodeURIComponent(email)}`).set('Authorization', `Bearer ${token}`);
const userByEmail = async (email) =>
  (await c2_query('SELECT id, is_admin, deactivated_at FROM users WHERE email = ?', [email]))[0];
const generalSquad = async () =>
  (await c2_query(
    `SELECT s.id FROM squads s JOIN workspaces w ON w.id = s.workspace_id JOIN users u ON u.id = w.owner_id
      WHERE s.name = 'General' AND u.email = ?`,
    [adminEmail]
  ))[0];

beforeAll(async () => {
  tag = randomBytes(4).toString('hex');
  adminEmail = `ops${tag}@example.com`;
  serviceEmail = `svc${tag}@example.com`;
  token = randomBytes(24).toString('hex');
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  for (const k of ['AUTH_PROVIDERS', 'ADMIN_USERNAME', 'ADMIN_PASSWORD', 'ADMIN_EMAIL', 'SERVICE_TOKEN', 'SERVICE_TOKEN_USER']) {
    delete process.env[k];
  }
  process.env.AUTH_PROVIDERS = 'oidc';
  process.env.ADMIN_EMAIL = adminEmail;
  process.env.SERVICE_TOKEN = token;
  process.env.SERVICE_TOKEN_USER = serviceEmail;

  await c2_query('INSERT INTO users (name, email) VALUES (?, ?)', [`svc${tag}`, serviceEmail]);
  const adminId = await ensureAdminUser();
  expect(await bootstrapInstance(adminId)).toBe(true);
});

afterAll(() => {
  errorSpy.mockRestore();
  process.env = { ...originalEnv };
});

describe('the membership sync, on a real server', () => {
  const ownerEmail = () => `owner${tag}@example.com`;
  const memberEmail = () => `member${tag}@example.com`;
  let owner;
  let member;
  let ownerSession;

  it('admits an owner and a member; both sign in; the owner is an admin, the member is not, both are General members', async () => {
    expect((await put(ownerEmail(), 'admin')).status).toBe(200);
    expect((await put(memberEmail(), 'member')).status).toBe(200);
    // The same request again changes nothing: one invitation per address.
    expect((await put(ownerEmail(), 'admin')).status).toBe(200);
    const [{ invitations }] = await c2_query('SELECT COUNT(*) AS invitations FROM user_invitations WHERE email = ?', [ownerEmail()]);
    expect(Number(invitations)).toBe(1);

    const ownerIn = await resolveIdentity(claims(`owner-${tag}`, ownerEmail()), POLICY);
    const memberIn = await resolveIdentity(claims(`member-${tag}`, memberEmail()), POLICY);
    expect(ownerIn).toMatchObject({ ok: true, created: true });
    expect(memberIn).toMatchObject({ ok: true, created: true });

    owner = { ...(await userByEmail(ownerEmail())), identityId: ownerIn.identityId };
    member = { ...(await userByEmail(memberEmail())), identityId: memberIn.identityId };
    expect(Boolean(owner.is_admin)).toBe(true);
    expect(Boolean(member.is_admin)).toBe(false);

    const general = await generalSquad();
    const rows = await c2_query(
      'SELECT user_id, can_read, can_write FROM squad_members WHERE squad_id = ? AND user_id IN (?, ?)',
      [general.id, owner.id, member.id]
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(Boolean(row.can_read)).toBe(true);
      expect(Boolean(row.can_write)).toBe(true);
    }
  });

  it('lets the member read the seeded welcome document through their session', async () => {
    const [welcome] = await c2_query(
      `SELECT l.id FROM logs l JOIN archives a ON a.id = l.archive_id
        WHERE a.squad_id = ? ORDER BY l.id LIMIT 1`,
      [(await generalSquad()).id]
    );
    expect(welcome).toBeDefined();
    const memberToken = await generateSessionToken({ id: member.id }, null, null, {
      provider: 'oidc', identityId: member.identityId, ttlHours: 24,
    });

    const res = await request(app)
      .get(`/api/document?doc_id=${welcome.id}`)
      .set('Authorization', `Bearer ${memberToken}`);
    expect(res.status).toBe(200);
  });

  it('moves ownership: the new owner is an admin, the old one is not, and the boot admin is untouched', async () => {
    const newOwner = memberEmail();
    expect((await put(newOwner, 'admin')).status).toBe(200);
    expect((await put(ownerEmail(), 'member')).status).toBe(200);

    expect(Boolean((await userByEmail(newOwner)).is_admin)).toBe(true);
    expect(Boolean((await userByEmail(ownerEmail())).is_admin)).toBe(false);
    expect(Boolean((await userByEmail(adminEmail)).is_admin)).toBe(true);
  });

  it('after General is renamed, an admission names no squad; a removal ends the sessions, refuses sign-in, and keeps authorship', async () => {
    await c2_query("UPDATE squads SET name = 'General (renamed)' WHERE id = ?", [(await generalSquad()).id]);
    // The renamed squad is no longer General, so the add-by-email path must not reach for it: the invitation names none.
    const late = `late${tag}@example.com`;
    expect((await put(late, 'member')).status).toBe(200);
    const [invite] = await c2_query('SELECT squad_id FROM user_invitations WHERE email = ?', [late]);
    expect(invite.squad_id).toBeNull();
    await c2_query("UPDATE squads SET name = 'General' WHERE name = 'General (renamed)'");

    // The old owner (now a member) keeps a session and wrote a document.
    ownerSession = await generateSessionToken({ id: owner.id }, null, null, {
      provider: 'oidc', identityId: owner.identityId, ttlHours: 24,
    });
    expect(await validateAndAutoLogin(ownerSession)).not.toBeNull();
    const [archive] = await c2_query('SELECT id FROM archives WHERE squad_id = ? LIMIT 1', [(await generalSquad()).id]);
    const written = await c2_query(
      'INSERT INTO logs (archive_id, title, html_content, created_by, updated_by) VALUES (?, ?, ?, ?, ?)',
      [archive.id, `by the old owner ${tag}`, '<p>kept</p>', owner.id, owner.id]
    );

    // The issuer now reports a new address for this person. Sign-in follows it onto the identity, and
    // the removal, asked for by that new address, must still find them.
    const renamed = `renamed${tag}@example.com`;
    expect(await resolveIdentity(claims(`owner-${tag}`, renamed), POLICY)).toMatchObject({ ok: true, userId: owner.id });

    const res = await del(renamed);
    expect(res.status).toBe(200);
    const after = await userByEmail(ownerEmail());
    expect(after.deactivated_at).not.toBeNull();
    expect(Boolean(after.is_admin)).toBe(false);
    expect(await validateAndAutoLogin(ownerSession)).toBeNull();
    const [{ sessions }] = await c2_query('SELECT COUNT(*) AS sessions FROM sessions WHERE user_id = ?', [owner.id]);
    expect(Number(sessions)).toBe(0);
    expect(await resolveIdentity(claims(`owner-${tag}`, renamed), POLICY)).toEqual({ ok: false, reason: 'account_deactivated' });

    const [log] = await c2_query('SELECT created_by FROM logs WHERE id = ?', [written.insertId]);
    expect(log.created_by).toBe(owner.id);

    // Removal again changes nothing, and re-admission without reactivate is refused.
    const first = (await userByEmail(ownerEmail())).deactivated_at;
    expect((await del(renamed)).status).toBe(200);
    expect((await userByEmail(ownerEmail())).deactivated_at).toEqual(first);
    const refused = await put(ownerEmail(), 'member');
    expect(refused.status).toBe(409);
    expect(refused.body.reason).toBe('account_deactivated');
    expect((await put(ownerEmail(), 'member', { reactivate: true })).status).toBe(200);
    expect((await userByEmail(ownerEmail())).deactivated_at).toBeNull();
  });

  it('refuses the boot admin address, in either direction, and leaves the boot admin an admin', async () => {
    expect((await put(adminEmail, 'member')).status).toBe(409);
    expect((await del(adminEmail)).status).toBe(409);
    const boot = await userByEmail(adminEmail);
    expect(Boolean(boot.is_admin)).toBe(true);
    expect(boot.deactivated_at).toBeNull();
  });
});
