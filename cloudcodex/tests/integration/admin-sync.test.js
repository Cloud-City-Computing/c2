/**
 * The boot admin sync against a live MySQL server: it creates or syncs, and never promotes
 *
 * ensureAdminUser matches ADMIN_USERNAME by name OR ADMIN_EMAIL by email, and
 * users.name and users.email are each UNIQUE, so the two can match two
 * different rows. That is exactly the takeover shape (GHSA-w8q3-r34w-3pjh):
 * the admin renames, or changes address, and a member takes the name or the
 * address the admin let go. Which row the server hands back first is the
 * server's business, and so is how LOWER(name) and the email collation
 * compare, so only a real server can prove that the next boot leaves that
 * member exactly as it was: not an admin, with its own password, email and
 * sessions. Each takeover runs twice, once with the member's row older than
 * the admin's and once newer, because a lookup that only ever looked at the
 * first row would pass one order and fail the other.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import { c2_query } from '../../mysql_connect.js';
import { ensureAdminUser } from '../../routes/admin.js';

const ENV_PASSWORD = 'Env-Admin-Passw0rd!';
const MEMBER_PASSWORD = 'Member-Passw0rd!';

const originalEnv = { ...process.env };
let errorSpy;
let tag;

beforeEach(() => {
  // users.name is VARCHAR(32); a short random tag keeps every test's rows
  // apart in the schema the whole file shares.
  tag = randomBytes(4).toString('hex');
  process.env.ADMIN_USERNAME = `adm${tag}`;
  process.env.ADMIN_EMAIL = `adm${tag}@example.com`;
  process.env.ADMIN_PASSWORD = ENV_PASSWORD;
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  process.env = { ...originalEnv };
});

/** Every line logged during the test. */
const logLines = () => errorSpy.mock.calls.map((args) => args.join(' '));

/**
 * A member (never an admin) with its own password and two live sessions.
 * @param { String } name
 * @returns { Promise<Number> } the user id
 */
async function insertMember(name) {
  const hash = await bcrypt.hash(MEMBER_PASSWORD, 4);
  const created = await c2_query(
    'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
    [name, `${name}@example.com`, hash]
  );
  for (let i = 0; i < 2; i++) {
    await c2_query(
      'INSERT INTO sessions (user_id, id, created_at, expires_at) VALUES (?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 7 DAY))',
      [created.insertId, randomBytes(32).toString('hex')]
    );
  }
  return created.insertId;
}

/** The columns a sync could write, for one user. */
async function userRow(id) {
  const [row] = await c2_query('SELECT id, name, email, password_hash, is_admin FROM users WHERE id = ?', [id]);
  return row;
}

/** Every session the user holds, as rows, in a stable order. */
async function sessionsOf(id) {
  return c2_query('SELECT id, user_id, created_at, expires_at FROM sessions WHERE user_id = ? ORDER BY id', [id]);
}

/**
 * The state before the second boot: a member and the admin, created in
 * `order`, the admin by a real first-boot ensureAdminUser().
 * @param { 'member older' | 'admin older' } order
 */
async function memberAndAdmin(order) {
  let memberId;
  if (order === 'member older') memberId = await insertMember(`mem${tag}`);
  const adminId = await ensureAdminUser();
  if (order === 'admin older') memberId = await insertMember(`mem${tag}`);
  expect(adminId).toEqual(expect.any(Number));
  expect((await userRow(adminId)).is_admin).toBe(1);
  expect(memberId > adminId).toBe(order === 'admin older');
  errorSpy.mockClear();
  return { memberId, adminId };
}

/** Run the second boot and prove it changed nothing for either account. */
async function expectRefusedAndUntouched({ memberId, adminId }) {
  const member = await userRow(memberId);
  const memberSessions = await sessionsOf(memberId);
  const admin = await userRow(adminId);
  expect(memberSessions).toHaveLength(2);

  let result;
  let thrown = null;
  try {
    result = await ensureAdminUser();
  } catch (err) {
    thrown = err;
  }

  // The member first: still not an admin, still their own password, email and
  // sessions. This is the takeover.
  const memberAfter = await userRow(memberId);
  expect(memberAfter.is_admin).toBe(0);
  expect(memberAfter).toEqual(member);
  expect(await bcrypt.compare(MEMBER_PASSWORD, memberAfter.password_hash)).toBe(true);
  expect(await sessionsOf(memberId)).toEqual(memberSessions);

  // Then the refusal itself: no error, no id, nothing written to the admin's
  // row either, and one line saying why.
  expect(thrown).toBeNull();
  expect(result).toBeNull();
  expect(await userRow(adminId)).toEqual(admin);
  const lines = logLines();
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain(
    `admin sync: adm${tag} / adm${tag}@example.com matches an existing non-admin account (user ${memberId}), ` +
    'refusing to promote it. Promote it in the admin console if that is intended.'
  );
  expect(lines[0]).not.toContain(ENV_PASSWORD);
}

// The admin lets go of one identifier (or both), and the member takes the one
// named. Where the admin keeps the other identifier, two rows match; where it
// let go of both, the member's is the only row that matches.
const TAKEOVERS = [
  ['the admin renames and a member takes the freed name', { adminLetsGo: ['name'], memberTakes: 'name' }],
  ['the admin changes email and a member takes the freed address', { adminLetsGo: ['email'], memberTakes: 'email' }],
  ['the admin renames and changes email, and a member takes the freed name', { adminLetsGo: ['name', 'email'], memberTakes: 'name' }],
  ['the admin renames and changes email, and a member takes the freed address', { adminLetsGo: ['name', 'email'], memberTakes: 'email' }],
];

describe.each(['member older', 'admin older'])('the admin sync on a real server (%s)', (order) => {
  it.each(TAKEOVERS)('%s: the member is not promoted', async (_label, { adminLetsGo, memberTakes }) => {
    const ids = await memberAndAdmin(order);
    // Through the table, as the account page's update-account writes them.
    if (adminLetsGo.includes('name')) {
      await c2_query('UPDATE users SET name = ? WHERE id = ?', [`boss${tag}`, ids.adminId]);
    }
    if (adminLetsGo.includes('email')) {
      await c2_query('UPDATE users SET email = ? WHERE id = ?', [`boss${tag}@example.com`, ids.adminId]);
    }
    if (memberTakes === 'name') {
      await c2_query('UPDATE users SET name = ? WHERE id = ?', [`adm${tag}`, ids.memberId]);
    } else {
      await c2_query('UPDATE users SET email = ? WHERE id = ?', [`adm${tag}@example.com`, ids.memberId]);
    }

    await expectRefusedAndUntouched(ids);
  });
});

describe('the admin sync keeps .env authoritative for the admin itself', () => {
  it('resets an existing admin\'s email and password at every boot', async () => {
    const adminId = await ensureAdminUser();
    expect(logLines()).toEqual([expect.stringContaining(`admin sync: created adm${tag} / adm${tag}@example.com`)]);
    const otherHash = await bcrypt.hash('Changed-In-The-App1', 4);
    await c2_query('UPDATE users SET email = ?, password_hash = ? WHERE id = ?', [
      `moved${tag}@example.com`,
      otherHash,
      adminId,
    ]);
    errorSpy.mockClear();

    expect(await ensureAdminUser()).toBe(adminId);

    const row = await userRow(adminId);
    expect(row.is_admin).toBe(1);
    expect(row.email).toBe(`adm${tag}@example.com`);
    expect(await bcrypt.compare(ENV_PASSWORD, row.password_hash)).toBe(true);
    expect(logLines()).toEqual([
      expect.stringContaining(`admin sync: synced adm${tag} / adm${tag}@example.com (user ${adminId})`),
    ]);
    expect(logLines()[0]).not.toContain(ENV_PASSWORD);
  });
});
