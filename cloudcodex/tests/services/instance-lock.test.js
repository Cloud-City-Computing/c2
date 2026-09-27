/**
 * Cloud Codex - Tests for services/instance-lock.js, the single-writer lock
 *
 * A fake connection stands in for MySQL here; tests/integration/lifecycle.test.js
 * proves the same module against a real server, across real processes.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { acquireInstanceLock } from '../../services/instance-lock.js';

const originalFlag = process.env.C2_INSTANCE_LOCK;

/**
 * A mysql2-shaped promise connection. `answers` is what GET_LOCK's SELECT
 * returns; `SELECT 1` (the keepalive) resolves unless `pingFails` is set.
 */
function fakeConnection({ got = 1, holder = 17, pingFails = false } = {}) {
  const conn = new EventEmitter();
  conn.state = { pingFails };
  conn.query = vi.fn(async (sql) => {
    if (/GET_LOCK/.test(sql)) return [[{ got, holder }], []];
    if (conn.state.pingFails) throw new Error('Connection lost: The server closed the connection.');
    return [[{ 1: 1 }], []];
  });
  conn.end = vi.fn(async () => {});
  conn.destroy = vi.fn();
  return conn;
}

let log;

beforeEach(() => {
  delete process.env.C2_INSTANCE_LOCK;
  log = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  if (originalFlag === undefined) delete process.env.C2_INSTANCE_LOCK;
  else process.env.C2_INSTANCE_LOCK = originalFlag;
});

describe('acquireInstanceLock: taking the lock', () => {
  it('holds a lock named for the schema on a connection of its own', async () => {
    const conn = fakeConnection({ got: 1, holder: 17 });
    const connect = vi.fn(async () => conn);

    const lock = await acquireInstanceLock({ connect, log });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(lock).toMatchObject({ held: true, disabled: false, connectionId: 17 });
    const [sql] = conn.query.mock.calls[0];
    // Named server-side from DATABASE(), with a zero wait: a second process
    // refuses at once rather than queueing behind the first.
    expect(sql).toMatch(/^SELECT GET_LOCK\(.*CONCAT\('cloudcodex-instance:', DATABASE\(\)\).*, 0\) AS got/);
    // MySQL caps a lock name at 64 characters, so a schema name too long to
    // fit after the prefix is named by a digest instead
    // (tests/integration/lifecycle.test.js proves both on a live server).
    expect(sql).toContain('CHAR_LENGTH(DATABASE()) <= 44');
    expect(sql).toContain("CONCAT('cloudcodex-instance#', LEFT(SHA2(DATABASE(), 256), 40))");
    // Distinct from the migration runner's lock, so `npm run migrate` in a
    // one-off container never contends with the running app.
    expect(sql).not.toContain('cloudcodex_migrate');
    expect(conn.end).not.toHaveBeenCalled();
    await lock.release();
  });

  it('refuses, naming the holder and the escape, when another process holds it', async () => {
    const conn = fakeConnection({ got: 0, holder: 4242 });

    const attempt = acquireInstanceLock({ connect: async () => conn, log });

    await expect(attempt).rejects.toThrow(/MySQL connection 4242/);
    await expect(attempt).rejects.toThrow(/C2_INSTANCE_LOCK=0/);
    expect(conn.end).toHaveBeenCalledTimes(1);
  });

  it('says the attempt errored, not that someone holds it, when GET_LOCK answers NULL', async () => {
    const conn = fakeConnection({ got: null, holder: null });

    const attempt = acquireInstanceLock({ connect: async () => conn, log });

    await expect(attempt).rejects.toThrow(/returned NULL/);
    await expect(attempt).rejects.not.toThrow(/Another Cloud Codex process/);
    expect(conn.end).toHaveBeenCalledTimes(1);
  });

  it('names the lock when the connection cannot be opened at all', async () => {
    const attempt = acquireInstanceLock({ connect: async () => { throw new Error('ECONNREFUSED 127.0.0.1:3306'); }, log });

    await expect(attempt).rejects.toThrow(/instance lock.*ECONNREFUSED/s);
  });

  it('destroys the connection and rethrows when the lock query itself fails', async () => {
    const conn = fakeConnection();
    conn.query = vi.fn(async () => { throw new Error('ER_ACCESS_DENIED'); });

    await expect(acquireInstanceLock({ connect: async () => conn, log })).rejects.toThrow(/ER_ACCESS_DENIED/);
    expect(conn.destroy).toHaveBeenCalled();
  });
});

describe('acquireInstanceLock: the escape', () => {
  it('takes no lock and opens no connection when C2_INSTANCE_LOCK=0, and says what that risks', async () => {
    process.env.C2_INSTANCE_LOCK = '0';
    const connect = vi.fn();

    const lock = await acquireInstanceLock({ connect, log });

    expect(connect).not.toHaveBeenCalled();
    expect(lock).toMatchObject({ held: false, disabled: true });
    await expect(lock.release()).resolves.toBeUndefined();
    expect(log.mock.calls.flat().join(' ')).toMatch(/C2_INSTANCE_LOCK=0.*diverge/s);
  });

  it.each(['1', '', 'false', 'off'])('keeps the lock on for C2_INSTANCE_LOCK=%j: only 0 turns it off', async (value) => {
    process.env.C2_INSTANCE_LOCK = value;
    const connect = vi.fn(async () => fakeConnection());

    const lock = await acquireInstanceLock({ connect, log });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(lock.held).toBe(true);
    await lock.release();
  });
});

describe('acquireInstanceLock: for the life of the process', () => {
  it('release ends the connection, stops the keepalive, and reports the lock as no longer held', async () => {
    vi.useFakeTimers();
    const conn = fakeConnection();
    const lock = await acquireInstanceLock({ connect: async () => conn, log, pingMs: 1_000 });

    await lock.release();
    expect(conn.end).toHaveBeenCalledTimes(1);
    expect(lock.held).toBe(false);

    const queriesAtRelease = conn.query.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(conn.query.mock.calls.length).toBe(queriesAtRelease);
  });

  it('keeps the connection alive with a periodic SELECT 1', async () => {
    vi.useFakeTimers();
    const conn = fakeConnection();
    const lock = await acquireInstanceLock({ connect: async () => conn, log, pingMs: 1_000 });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(conn.query.mock.calls.map(([sql]) => sql)).toContain('SELECT 1');
    expect(lock.held).toBe(true);
    await lock.release();
  });

  it('reports the lock lost the moment its connection errors, without crashing the process', async () => {
    const conn = fakeConnection();
    const lock = await acquireInstanceLock({ connect: async () => conn, log, pingMs: 1_000 });

    // An 'error' with no listener would throw here, which is what an
    // unhandled connection error does to a real process.
    expect(() => conn.emit('error', new Error('PROTOCOL_CONNECTION_LOST'))).not.toThrow();
    expect(lock.held).toBe(false);
    await lock.release();
  });

  it('reports the lock lost when the keepalive fails', async () => {
    vi.useFakeTimers();
    const conn = fakeConnection();
    // Every reconnect fails too, so the loss is what the test sees.
    let first = true;
    const connect = vi.fn(async () => {
      if (first) { first = false; return conn; }
      throw new Error('ECONNREFUSED');
    });
    const lock = await acquireInstanceLock({ connect, log, pingMs: 1_000 });

    conn.state.pingFails = true;
    await vi.advanceTimersByTimeAsync(1_000);

    expect(lock.held).toBe(false);
    await lock.release();
  });

  it('takes the lock back on a new connection after MySQL comes back', async () => {
    vi.useFakeTimers();
    const first = fakeConnection({ holder: 17 });
    const second = fakeConnection({ holder: 18 });
    const connect = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const lock = await acquireInstanceLock({ connect, log, pingMs: 1_000 });

    first.emit('error', new Error('PROTOCOL_CONNECTION_LOST'));
    expect(lock.held).toBe(false);

    await vi.advanceTimersByTimeAsync(1_000);

    expect(connect).toHaveBeenCalledTimes(2);
    expect(lock.held).toBe(true);
    expect(lock.connectionId).toBe(18);
    expect(first.destroy).toHaveBeenCalled();
    await lock.release();
    expect(second.end).toHaveBeenCalled();
  });

  it('when another process took it meanwhile, says who holds it once, hands over to onSuperseded, and tries no more', async () => {
    vi.useFakeTimers();
    const first = fakeConnection({ holder: 17 });
    const connect = vi.fn()
      .mockResolvedValueOnce(first)
      .mockImplementation(async () => fakeConnection({ got: 0, holder: 99 }));
    const onSuperseded = vi.fn();
    const lock = await acquireInstanceLock({ connect, log, onSuperseded, pingMs: 1_000, retakeMs: 500 });

    first.emit('error', new Error('PROTOCOL_CONNECTION_LOST'));
    await vi.advanceTimersByTimeAsync(10_000);

    expect(lock.held).toBe(false);
    // Two live writers on one schema is what the lock exists to prevent, so
    // the process that lost it must stop rather than serve on: it is told once.
    expect(onSuperseded).toHaveBeenCalledTimes(1);
    expect(onSuperseded.mock.calls[0][0].message).toMatch(/MySQL connection 99/);
    expect(connect).toHaveBeenCalledTimes(2);
    const holderLines = log.mock.calls.flat().filter((line) => /MySQL connection 99/.test(line));
    expect(holderLines).toHaveLength(1);
    await lock.release();
  });

  it('tries to take it back within retakeMs of losing it, not at the next keepalive', async () => {
    vi.useFakeTimers();
    const first = fakeConnection({ holder: 17 });
    const second = fakeConnection({ holder: 18 });
    const connect = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const lock = await acquireInstanceLock({ connect, log, pingMs: 60_000, retakeMs: 1_000 });

    first.emit('error', new Error('PROTOCOL_CONNECTION_LOST'));
    await vi.advanceTimersByTimeAsync(999);
    expect(connect).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(lock).toMatchObject({ held: true, connectionId: 18 });
    await lock.release();
  });

  it('retakes every second by default', async () => {
    vi.useFakeTimers();
    const first = fakeConnection({ holder: 17 });
    const connect = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(fakeConnection({ holder: 18 }));
    const lock = await acquireInstanceLock({ connect, log });

    first.emit('error', new Error('PROTOCOL_CONNECTION_LOST'));
    await vi.advanceTimersByTimeAsync(1_000);

    expect(lock.held).toBe(true);
    await lock.release();
  });

  it('keeps retrying while MySQL is down, says why once, and never calls onSuperseded', async () => {
    vi.useFakeTimers();
    const first = fakeConnection({ holder: 17 });
    const refused = () => { throw new Error('ECONNREFUSED 127.0.0.1:3306'); };
    const connect = vi.fn()
      .mockResolvedValueOnce(first)
      .mockImplementationOnce(refused)
      .mockImplementationOnce(refused)
      .mockResolvedValueOnce(fakeConnection({ holder: 21 }));
    const onSuperseded = vi.fn();
    const lock = await acquireInstanceLock({ connect, log, onSuperseded, pingMs: 60_000, retakeMs: 1_000 });

    first.emit('error', new Error('PROTOCOL_CONNECTION_LOST'));
    await vi.advanceTimersByTimeAsync(3_000);

    expect(connect).toHaveBeenCalledTimes(4);
    expect(lock).toMatchObject({ held: true, connectionId: 21 });
    expect(onSuperseded).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().filter((line) => /ECONNREFUSED/.test(line))).toHaveLength(1);
    await lock.release();
  });
});

describe('acquireInstanceLock: the retake guards', () => {
  it('a late error from the connection it replaced does not mark the new lock lost', async () => {
    vi.useFakeTimers();
    const first = fakeConnection({ holder: 17 });
    const second = fakeConnection({ holder: 18 });
    const connect = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const lock = await acquireInstanceLock({ connect, log, pingMs: 60_000, retakeMs: 1_000 });

    first.emit('error', new Error('PROTOCOL_CONNECTION_LOST'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(lock.connectionId).toBe(18);

    // The destroyed socket reports once more, after the retake.
    first.emit('error', new Error('read ECONNRESET'));
    expect(lock.held).toBe(true);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(second.destroy).not.toHaveBeenCalled();
    await lock.release();
  });

  it('a release while a retake is in flight ends the connection that retake opens', async () => {
    vi.useFakeTimers();
    const first = fakeConnection({ holder: 17 });
    const second = fakeConnection({ holder: 18 });
    let answer;
    const connect = vi.fn()
      .mockResolvedValueOnce(first)
      .mockImplementationOnce(() => new Promise((resolve) => { answer = () => resolve(second); }));
    const lock = await acquireInstanceLock({ connect, log, pingMs: 60_000, retakeMs: 1_000 });

    first.emit('error', new Error('PROTOCOL_CONNECTION_LOST'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(connect).toHaveBeenCalledTimes(2);

    await lock.release();
    answer();
    await vi.advanceTimersByTimeAsync(0);

    // Otherwise a connection nobody will ever end holds GET_LOCK after the
    // shutdown said it released it.
    expect(second.end).toHaveBeenCalledTimes(1);
    expect(lock.held).toBe(false);
  });

  it('overlapping attempts open one connection, not one per tick', async () => {
    vi.useFakeTimers();
    const first = fakeConnection({ holder: 17 });
    const connect = vi.fn()
      .mockResolvedValueOnce(first)
      .mockImplementationOnce(() => new Promise(() => {}));   // a connect that never answers
    const lock = await acquireInstanceLock({ connect, log, pingMs: 1_000, retakeMs: 1_000 });

    first.emit('error', new Error('PROTOCOL_CONNECTION_LOST'));
    await vi.advanceTimersByTimeAsync(10_000);

    expect(connect).toHaveBeenCalledTimes(2);
    await lock.release();
  });
});
