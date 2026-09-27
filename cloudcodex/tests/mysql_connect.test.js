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

// A dedicated connection double for withTransaction: a real mysql2 pooled
// connection exposes execute/beginTransaction/commit/rollback/release, all
// distinct from the pool-level execute() that c2_query uses.
const connectionExecuteMock = vi.fn();
const beginTransactionMock = vi.fn();
const commitMock = vi.fn();
const rollbackMock = vi.fn();
const releaseMock = vi.fn();
const getConnectionMock = vi.fn(async () => ({
  execute: connectionExecuteMock,
  beginTransaction: beginTransactionMock,
  commit: commitMock,
  rollback: rollbackMock,
  release: releaseMock,
}));

vi.mock('mysql2/promise', () => ({
  default: { createPool: () => ({ execute: executeMock, getConnection: getConnectionMock }) },
}));

// Ensure the env vars exist so the require-vars guard at module load does
// not call process.exit(1).
process.env.DB_USER = process.env.DB_USER || 'test_user';
process.env.DB_PASS = process.env.DB_PASS || 'test_pass';

const {
  c2_query,
  generateSessionToken,
  validateAndAutoLogin,
  getSessionProvider,
  touchSession,
  withTransaction,
} = await import('../mysql_connect.js');
const { hashSessionToken } = await import('../services/session-token.js');

beforeEach(() => {
  executeMock.mockReset();
  getConnectionMock.mockClear();
  connectionExecuteMock.mockReset();
  beginTransactionMock.mockReset();
  commitMock.mockReset();
  rollbackMock.mockReset();
  releaseMock.mockReset();
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

  // One row per sign-in (W6-CDX-2). These replace the two reuse tests
  // ("reuses an existing non-expired session and updates metadata", "refreshes
  // an expired session in place with a new random token"): a second device no
  // longer gets the first device's token, so there is no row to reuse.
  it('issues exactly one statement, an INSERT binding the digest, and returns the raw token', async () => {
    executeMock.mockResolvedValueOnce([{ insertId: 99 }, []]);

    const token = await generateSessionToken(user);

    expect(token).toMatch(/^[A-Za-z0-9]{64}$/);
    expect(executeMock).toHaveBeenCalledTimes(1);
    const [sql, params] = executeMock.mock.calls[0];
    expect(sql).toMatch(/^\s*INSERT INTO sessions/i);
    expect(params).toEqual([7, hashSessionToken(token), 'local', null, null]);
    // What the database holds is never what the browser presents.
    expect(params[1]).not.toBe(token);
  });

  it('binds the ip and user agent it is given', async () => {
    executeMock.mockResolvedValueOnce([{ insertId: 99 }, []]);

    const token = await generateSessionToken(user, '1.2.3.4', 'agent');

    expect(executeMock.mock.calls[0][1]).toEqual([7, hashSessionToken(token), 'local', '1.2.3.4', 'agent']);
  });

  it('gives two sign-ins for the same user two tokens and two rows', async () => {
    executeMock
      .mockResolvedValueOnce([{ insertId: 1 }, []])
      .mockResolvedValueOnce([{ insertId: 2 }, []]);

    const first = await generateSessionToken(user);
    const second = await generateSessionToken(user);

    expect(first).not.toBe(second);
    expect(executeMock).toHaveBeenCalledTimes(2);
    for (const [sql] of executeMock.mock.calls) expect(sql).toMatch(/^\s*INSERT INTO sessions/i);
    expect(executeMock.mock.calls[0][1][1]).toBe(hashSessionToken(first));
    expect(executeMock.mock.calls[1][1][1]).toBe(hashSessionToken(second));
  });

  it('records the flow that minted the session', async () => {
    executeMock.mockResolvedValueOnce([{ insertId: 99 }, []]);

    const token = await generateSessionToken(user, null, null, { provider: 'google' });

    expect(executeMock.mock.calls[0][1]).toEqual([7, hashSessionToken(token), 'google', null, null]);
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

  // Request bodies are JSON, so a token can arrive as a number, an object or
  // an array. Hashing one would throw and turn a plain "not signed in" into a
  // 500; binding it raw never matched a row either. No session, no query.
  it.each([[123], [{}], [['a']], [''], [null], [undefined]])(
    'returns null without querying for a token that is not a non-empty string (%j)',
    async (token) => {
      expect(await validateAndAutoLogin(token)).toBeNull();
      expect(executeMock).not.toHaveBeenCalled();
    }
  );

  it('looks the session up by the digest of the token, never the token', async () => {
    executeMock.mockResolvedValueOnce([[], []]);

    await validateAndAutoLogin('raw');

    const [sql, params] = executeMock.mock.calls[0];
    expect(sql).toMatch(/FROM sessions WHERE id = \?/i);
    expect(params).toEqual([hashSessionToken('raw')]);
  });

  it('returns null when the user row is gone (orphaned session)', async () => {
    const future = new Date(Date.now() + 60_000);
    executeMock
      .mockResolvedValueOnce([[{ user_id: 999, expires_at: future }], []])
      .mockResolvedValueOnce([[], []]);
    expect(await validateAndAutoLogin('orphan')).toBeNull();
  });
});

describe('getSessionProvider', () => {
  it('reads the flow that minted the session, by the digest of the token', async () => {
    executeMock.mockResolvedValueOnce([[{ auth_provider: 'google' }], []]);

    expect(await getSessionProvider('raw')).toBe('google');

    const [sql, params] = executeMock.mock.calls[0];
    expect(sql).toMatch(/SELECT auth_provider FROM sessions WHERE id = \? LIMIT 1/i);
    expect(params).toEqual([hashSessionToken('raw')]);
  });

  it('answers \'local\' for a session that is gone', async () => {
    executeMock.mockResolvedValueOnce([[], []]);
    expect(await getSessionProvider('gone')).toBe('local');
  });

  it.each([undefined, null, '', 123, {}])('answers \'local\' without querying for %j', async (token) => {
    expect(await getSessionProvider(token)).toBe('local');
    expect(executeMock).not.toHaveBeenCalled();
  });
});

describe('touchSession', () => {
  it('returns early without querying when token is empty', async () => {
    await touchSession(undefined);
    await touchSession(null);
    await touchSession('');
    await touchSession(123);
    await touchSession({});
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('updates last_active_at for the session', async () => {
    executeMock.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    await touchSession('tok');
    const [sql, params] = executeMock.mock.calls[0];
    expect(sql).toMatch(/UPDATE sessions SET last_active_at = NOW\(\)/i);
    expect(params).toEqual([hashSessionToken('tok')]);
  });
});

describe('withTransaction', () => {
  it('begins, runs fn against a query executor bound to the dedicated connection, commits, and releases on success', async () => {
    connectionExecuteMock.mockResolvedValueOnce([{ insertId: 5 }, []]);
    const fn = vi.fn(async query => query('INSERT INTO x (a) VALUES (?)', [1]));

    const result = await withTransaction(fn);

    expect(getConnectionMock).toHaveBeenCalledTimes(1);
    expect(beginTransactionMock).toHaveBeenCalledTimes(1);
    // The query executor fn receives must go through the dedicated
    // connection's execute, never the pool-level execute c2_query uses —
    // otherwise a write could land on a different pooled connection and
    // fall outside the transaction.
    expect(connectionExecuteMock).toHaveBeenCalledWith('INSERT INTO x (a) VALUES (?)', [1]);
    expect(executeMock).not.toHaveBeenCalled();
    expect(result).toEqual({ insertId: 5 });
    expect(commitMock).toHaveBeenCalledTimes(1);
    expect(rollbackMock).not.toHaveBeenCalled();
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('rolls back, releases, and rethrows without committing when fn throws', async () => {
    const err = new Error('archive insert failed');
    const fn = vi.fn(async () => {
      throw err;
    });

    await expect(withTransaction(fn)).rejects.toThrow('archive insert failed');

    expect(beginTransactionMock).toHaveBeenCalledTimes(1);
    expect(commitMock).not.toHaveBeenCalled();
    expect(rollbackMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the original error and logs the rollback failure when rollback itself throws', async () => {
    const err = new Error('write failed');
    const fn = vi.fn(async () => {
      throw err;
    });
    rollbackMock.mockRejectedValueOnce(new Error('connection already closed'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      // The caller must learn which statement broke. A rollback failure that
      // replaced 'write failed' with 'connection already closed' would hide
      // the only actionable fact.
      await expect(withTransaction(fn)).rejects.toThrow('write failed');

      // The rollback failure is still surfaced, just not as the thrown error.
      const logged = errorSpy.mock.calls.flat().map(String).join(' ');
      expect(logged).toMatch(/transaction rollback failed/i);
      expect(logged).toMatch(/connection already closed/);

      expect(releaseMock).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
