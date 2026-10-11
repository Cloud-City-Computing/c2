/**
 * The boot admin on a hosted instance (AUTH_PROVIDERS without local): created without a password, found by email only
 *
 * With local sign-in off, ensureAdminUser matches ADMIN_EMAIL alone (never the name), creates the admin
 * with no password_hash when none matches, takes a derived username when ADMIN_USERNAME is unset, and never
 * writes a password. A non-admin holding the address is refused, as on a local instance (W6-CDX-32). The
 * seeded starter workspace is named from the admin's row, so an instance with no ADMIN_USERNAME still seeds
 * its General squad.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { c2_query } from '../../mysql_connect.js';
import { ensureAdminUser, bootstrapInstance } from '../../routes/admin.js';
import { resetMocks } from '../helpers.js';

const KEYS = ['AUTH_PROVIDERS', 'ADMIN_USERNAME', 'ADMIN_PASSWORD', 'ADMIN_EMAIL', 'OIDC_ISSUER_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
const EMAIL = 'operator@example.com';

describe('ensureAdminUser on a hosted instance', () => {
  let saved;
  let errorSpy;

  beforeEach(() => {
    resetMocks();
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
    process.env.AUTH_PROVIDERS = 'oidc';
    process.env.OIDC_ISSUER_URL = 'https://id.example.test';
    process.env.ADMIN_EMAIL = EMAIL;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const writes = () => c2_query.mock.calls.filter(([sql]) => /^\s*(UPDATE|INSERT|DELETE|REPLACE)\b/i.test(sql));
  const logLines = () => errorSpy.mock.calls.map((args) => args.join(' '));

  it('matches the admin by ADMIN_EMAIL alone, never by name', async () => {
    process.env.ADMIN_USERNAME = 'opsadmin';
    c2_query.mockResolvedValueOnce([]);   // match by email
    c2_query.mockResolvedValueOnce([]);   // no account holds the name
    c2_query.mockResolvedValueOnce({ insertId: 42 });
    c2_query.mockResolvedValueOnce({ insertId: 1 });

    await ensureAdminUser();

    const [sql, params] = c2_query.mock.calls[0];
    expect(sql).toMatch(/LOWER\(email\) = LOWER\(\?\)/);
    expect(sql).not.toMatch(/name/i);
    expect(params).toEqual([EMAIL]);
  });

  it('creates the admin with no password_hash, and under ADMIN_USERNAME when no account holds it', async () => {
    process.env.ADMIN_USERNAME = 'opsadmin';
    c2_query.mockResolvedValueOnce([]);   // no account matches the email
    c2_query.mockResolvedValueOnce([]);   // no account holds the name
    c2_query.mockResolvedValueOnce({ insertId: 42 });
    c2_query.mockResolvedValueOnce({ insertId: 1 });

    expect(await ensureAdminUser()).toBe(42);

    const insert = c2_query.mock.calls.find(([sql]) => sql.includes('INSERT INTO users'));
    expect(insert[0]).toMatch(/is_admin/);
    expect(insert[0]).not.toMatch(/password_hash/);
    expect(insert[1][0]).toBe('opsadmin');
    expect(insert[1][1]).toBe(EMAIL);
    expect(insert[1]).toHaveLength(2);
    expect(c2_query.mock.calls.some(([sql]) => /password/i.test(sql))).toBe(false);
  });

  it('derives the admin username from ADMIN_EMAIL when ADMIN_USERNAME is unset, and seeds no password', async () => {
    c2_query.mockResolvedValueOnce([]);   // no account matches the email
    c2_query.mockResolvedValueOnce([]);   // deriveUniqueUsername: the derived name is free
    c2_query.mockResolvedValueOnce({ insertId: 42 });
    c2_query.mockResolvedValueOnce({ insertId: 1 });

    expect(await ensureAdminUser()).toBe(42);

    const insert = c2_query.mock.calls.find(([sql]) => sql.includes('INSERT INTO users'));
    expect(insert[1][0]).toBe('operator');
    expect(insert[1][1]).toBe(EMAIL);
  });

  it('syncs an existing admin by email without writing a password', async () => {
    c2_query.mockResolvedValueOnce([{ id: 7, is_admin: 1 }]);
    c2_query.mockResolvedValueOnce({ affectedRows: 1 });

    expect(await ensureAdminUser()).toBe(7);

    expect(writes()).toHaveLength(1);
    expect(writes()[0][0]).toMatch(/^UPDATE users SET email = \? WHERE id = \?$/);
    expect(writes()[0][0]).not.toMatch(/password/i);
    expect(writes()[0][1]).toEqual([EMAIL, 7]);
  });

  it('refuses a non-admin holding the address, writes nothing, and returns null', async () => {
    c2_query.mockResolvedValueOnce([{ id: 9, is_admin: 0 }]);

    expect(await ensureAdminUser()).toBeNull();

    expect(writes()).toEqual([]);
    expect(logLines().join('\n')).toMatch(/refusing to promote/);
  });

  it('does not promote a member who holds ADMIN_USERNAME under another address, and derives the admin a free name', async () => {
    process.env.ADMIN_USERNAME = 'opsadmin';
    // The name clause is gone on a hosted instance, so the match finds no row for this member.
    c2_query.mockResolvedValueOnce([]);                  // no account matches the email
    c2_query.mockResolvedValueOnce([{ id: 9 }]);         // ADMIN_USERNAME is held by a member
    c2_query.mockResolvedValueOnce([]);                  // deriveUniqueUsername: the derived name is free
    c2_query.mockResolvedValueOnce({ insertId: 42 });
    c2_query.mockResolvedValueOnce({ insertId: 1 });

    expect(await ensureAdminUser()).toBe(42);

    expect(writes().some(([sql]) => /UPDATE users/i.test(sql))).toBe(false);
    const insert = c2_query.mock.calls.find(([sql]) => sql.includes('INSERT INTO users'));
    expect(insert[1][0]).toBe('operator');
  });

  it('never logs a password, even the hashed one', async () => {
    process.env.ADMIN_PASSWORD = 'Hosted-Never-Logged-1!';
    c2_query.mockResolvedValueOnce([{ id: 7, is_admin: 1 }]);
    c2_query.mockResolvedValueOnce({ affectedRows: 1 });

    await ensureAdminUser();

    expect(logLines().join('\n')).not.toMatch(/Hosted-Never-Logged/);
  });
});

describe('bootstrapInstance names the seeded workspace from the admin row', () => {
  let saved;

  beforeEach(() => {
    resetMocks();
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
    process.env.AUTH_PROVIDERS = 'oidc';
    process.env.ADMIN_EMAIL = EMAIL;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('seeds a workspace named for the admin row, with ADMIN_USERNAME unset, and the General squad', async () => {
    c2_query.mockResolvedValueOnce([{ workspaces: 0, archives: 0, logs: 0, admin_name: 'operator' }]);
    c2_query.mockResolvedValueOnce({ insertId: 11 }); // workspace
    c2_query.mockResolvedValueOnce({ insertId: 22 }); // squad
    c2_query.mockResolvedValueOnce({ insertId: 33 }); // squad owner
    c2_query.mockResolvedValueOnce({ insertId: 44 }); // archive
    c2_query.mockResolvedValueOnce({ insertId: 55 }); // welcome log

    expect(await bootstrapInstance(5)).toBe(true);

    const count = c2_query.mock.calls[0];
    expect(count[0]).toMatch(/FROM users WHERE id = \?/);
    expect(count[1]).toEqual([5]);
    const workspace = c2_query.mock.calls.find(([sql]) => sql.includes('INSERT INTO workspaces'));
    expect(workspace[1][0]).toBe("operator's Workspace");
    const squad = c2_query.mock.calls.find(([sql]) => sql.includes('INSERT INTO squads'));
    expect(squad[1][1]).toBe('General');
  });
});
