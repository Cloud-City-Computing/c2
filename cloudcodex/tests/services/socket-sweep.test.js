/**
 * The periodic re-check of open WebSocket sessions (services/socket-sweep.js)
 *
 * Auth is read once, on a socket's first message, so a session ended afterwards, by a deactivation or a
 * hand-run delete, would keep its socket. The sweep reads the digests the open sockets carry, asks the
 * database which of them still hold a live session for an active user (and, on a hosted instance, an OIDC
 * session), and closes the rest with 4004. The lookup is batched, and a failed sweep is logged, never thrown.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { c2_query } from '../../mysql_connect.js';
import { liveSessionDigests, sweepSocketSessions, startSocketSweep } from '../../services/socket-sweep.js';
import { resetMocks } from '../helpers.js';

const KEYS = ['AUTH_PROVIDERS', 'OIDC_ISSUER_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];

describe('liveSessionDigests', () => {
  let saved;

  beforeEach(() => {
    resetMocks();
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('answers the digests with a live session for an active user, and asks nothing for an empty set', async () => {
    c2_query.mockResolvedValueOnce([{ id: 'a' }, { id: 'c' }]);
    expect(await liveSessionDigests(['a', 'b', 'c'])).toEqual(new Set(['a', 'c']));
    const [sql, params] = c2_query.mock.calls[0];
    expect(sql).toMatch(/s\.expires_at > NOW\(\)/);
    expect(sql).toMatch(/u\.deactivated_at IS NULL/);
    expect(sql).toMatch(/IN \(\?,\?,\?\)/);
    expect(params).toEqual(['a', 'b', 'c']);

    c2_query.mockClear();
    expect(await liveSessionDigests([])).toEqual(new Set());
    expect(c2_query).not.toHaveBeenCalled();
  });

  it('batches a large set, so no single statement carries an unbounded placeholder list', async () => {
    const digests = Array.from({ length: 1200 }, (_, i) => `d${i}`);
    c2_query.mockResolvedValue([]);
    await liveSessionDigests(digests, { chunkSize: 500 });
    expect(c2_query).toHaveBeenCalledTimes(3);
    expect(c2_query.mock.calls[0][1]).toHaveLength(500);
    expect(c2_query.mock.calls[2][1]).toHaveLength(200);
  });

  it('keeps only OIDC sessions on a hosted instance', async () => {
    process.env.AUTH_PROVIDERS = 'oidc';
    process.env.OIDC_ISSUER_URL = 'https://id.example.test';
    c2_query.mockResolvedValueOnce([]);
    await liveSessionDigests(['a']);
    expect(c2_query.mock.calls[0][0]).toMatch(/s\.auth_provider = 'oidc'/);
  });
});

describe('sweepSocketSessions', () => {
  it('closes exactly the open sockets whose session is no longer live, and reports the count', async () => {
    const closeSessions = vi.fn(() => 2);
    const live = vi.fn(async () => new Set(['a']));
    const closed = await sweepSocketSessions({ openDigests: () => new Set(['a', 'b', 'c']), closeSessions, live });
    expect(live).toHaveBeenCalledWith(new Set(['a', 'b', 'c']));
    expect(closeSessions).toHaveBeenCalledWith(new Set(['b', 'c']));
    expect(closed).toBe(2);
  });

  it('closes nothing and asks nothing when no socket is authenticated', async () => {
    const closeSessions = vi.fn(() => 0);
    const live = vi.fn(async () => new Set());
    expect(await sweepSocketSessions({ openDigests: () => new Set(), closeSessions, live })).toBe(0);
    expect(live).not.toHaveBeenCalled();
    expect(closeSessions).not.toHaveBeenCalled();
  });
});

describe('startSocketSweep', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('runs the sweep every interval until stopped', async () => {
    const sweep = vi.fn(async () => 0);
    const stop = startSocketSweep({ sweep, intervalMs: 60_000 });

    await vi.advanceTimersByTimeAsync(59_999);
    expect(sweep).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(sweep).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sweep).toHaveBeenCalledTimes(3);

    stop();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(sweep).toHaveBeenCalledTimes(3);
  });

  it('logs a failed sweep and keeps running, rather than throwing out of the timer', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sweep = vi.fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue(0);
    const stop = startSocketSweep({ sweep, intervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sweep).toHaveBeenCalledTimes(2);
    expect(errorSpy.mock.calls.flat().join(' ')).toMatch(/socket session sweep failed/);
    stop();
  });
});
