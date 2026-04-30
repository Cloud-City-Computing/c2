/**
 * Cloud Codex — Tests for mysql_connect.js
 *
 * Bypasses the global mock (in tests/setup.js) by re-importing the real
 * module with `mysql2/promise` mocked at its boundary. We never connect
 * to a real database.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.unmock('../mysql_connect.js');

const executeMock = vi.fn();
vi.mock('mysql2/promise', () => ({
  default: { createPool: () => ({ execute: executeMock }) },
}));

// Ensure the env vars exist so the require-vars guard at module load does
// not call process.exit(1).
process.env.DB_USER = process.env.DB_USER || 'test_user';
process.env.DB_PASS = process.env.DB_PASS || 'test_pass';

const {
  c2_query,
  generateSessionToken,
  validateAndAutoLogin,
  touchSession,
} = await import('../mysql_connect.js');

beforeEach(() => {
  executeMock.mockReset();
});

describe('c2_query', () => {
  it('forwards sql and params to pool.execute and returns rows', async () => {
    executeMock.mockResolvedValueOnce([[{ id: 1 }, { id: 2 }], []]);
    const rows = await c2_query('SELECT * FROM x WHERE id = ?', [42]);
    expect(executeMock).toHaveBeenCalledWith('SELECT * FROM x WHERE id = ?', [42]);
    expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('parameterizes — never interpolates into SQL', async () => {
    executeMock.mockResolvedValueOnce([[], []]);
    await c2_query('SELECT * FROM users WHERE name = ?', ["Robert'); DROP TABLE--"]);
    const [, params] = executeMock.mock.calls[0];
    // The malicious value must arrive as a parameter, not inlined into SQL.
    expect(params[0]).toBe("Robert'); DROP TABLE--");
    expect(executeMock.mock.calls[0][0]).not.toContain('Robert');
  });
});

describe('generateSessionToken', () => {
  const user = { id: 7 };

  it('reuses an existing non-expired session and updates metadata', async () => {
    const future = new Date(Date.now() + 60_000);
    executeMock
      .mockResolvedValueOnce([[{ id: 'existing-token', expires_at: future }], []]) // SELECT
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);                            // UPDATE

    const token = await generateSessionToken(user, '1.2.3.4', 'agent');
    expect(token).toBe('existing-token');

    const updateCall = executeMock.mock.calls[1];
    expect(updateCall[0]).toMatch(/UPDATE sessions SET ip_address/i);
    expect(updateCall[1]).toEqual(['1.2.3.4', 'agent', 'existing-token']);
  });

  it('refreshes an expired session in place with a new random token', async () => {
    const past = new Date(Date.now() - 1000);
    executeMock
      .mockResolvedValueOnce([[{ id: 'expired-token', expires_at: past }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    const token = await generateSessionToken(user, '1.1.1.1', 'agent');
    expect(token).not.toBe('expired-token');
    expect(token).toMatch(/^[A-Za-z0-9]{64}$/);

    const updateCall = executeMock.mock.calls[1];
    expect(updateCall[0]).toMatch(/UPDATE sessions SET id = \?/i);
    expect(updateCall[1][0]).toBe(token);
  });

  it('inserts a new session when none exists', async () => {
    executeMock
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ insertId: 99 }, []]);

    const token = await generateSessionToken(user);
    expect(token).toMatch(/^[A-Za-z0-9]{64}$/);
    const insertCall = executeMock.mock.calls[1];
    expect(insertCall[0]).toMatch(/INSERT INTO sessions/i);
    expect(insertCall[1]).toEqual([7, token, null, null]);
  });
});

describe('validateAndAutoLogin', () => {
  it('returns null when the session does not exist', async () => {
    executeMock.mockResolvedValueOnce([[], []]);
    expect(await validateAndAutoLogin('missing')).toBeNull();
  });

  it('returns null when the session has expired', async () => {
    const past = new Date(Date.now() - 1000);
    executeMock.mockResolvedValueOnce([[{ user_id: 1, expires_at: past }], []]);
    expect(await validateAndAutoLogin('expired')).toBeNull();
  });

  it('returns the user when the session is valid', async () => {
    const future = new Date(Date.now() + 60_000);
    executeMock
      .mockResolvedValueOnce([[{ user_id: 1, expires_at: future }], []])
      .mockResolvedValueOnce([[{ id: 1, name: 'Alice', email: 'a@b.c', avatar_url: null, is_admin: 0 }], []]);

    const user = await validateAndAutoLogin('valid');
    expect(user).toEqual({ id: 1, name: 'Alice', email: 'a@b.c', avatar_url: null, is_admin: 0 });
  });

  it('returns null when the user row is gone (orphaned session)', async () => {
    const future = new Date(Date.now() + 60_000);
    executeMock
      .mockResolvedValueOnce([[{ user_id: 999, expires_at: future }], []])
      .mockResolvedValueOnce([[], []]);
    expect(await validateAndAutoLogin('orphan')).toBeNull();
  });
});

describe('touchSession', () => {
  it('returns early without querying when token is empty', async () => {
    await touchSession(undefined);
    await touchSession(null);
    await touchSession('');
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('updates last_active_at for the session', async () => {
    executeMock.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    await touchSession('tok');
    const [sql, params] = executeMock.mock.calls[0];
    expect(sql).toMatch(/UPDATE sessions SET last_active_at = NOW\(\)/i);
    expect(params).toEqual(['tok']);
  });
});
