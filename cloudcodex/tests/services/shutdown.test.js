/**
 * Cloud Codex - Tests for services/shutdown.js, the bounded graceful stop
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createShutdown } from '../../services/shutdown.js';

let calls;
let deps;

/** A dependency that records its name in `calls` when it runs. */
const step = (name, impl = async () => {}) => vi.fn((...args) => {
  calls.push(name);
  return impl(...args);
});

beforeEach(() => {
  vi.useFakeTimers();
  calls = [];
  deps = {
    server: { close: step('server.close', () => {}) },
    readiness: { shuttingDown: false },
    flushPendingSaves: step('flushPendingSaves'),
    closeSockets: step('closeSockets', () => {}),
    releaseLock: step('releaseLock'),
    endPool: step('endPool'),
    exit: step('exit', () => {}),
    log: vi.fn(),
  };
});

afterEach(() => {
  vi.useRealTimers();
});

const logged = () => deps.log.mock.calls.map(([line]) => line).join('\n');

describe('createShutdown', () => {
  it('refuses new work, flushes, closes the sockets, releases the lock, ends the pool, then exits 0', async () => {
    await createShutdown(deps)('SIGTERM');

    expect(calls).toEqual([
      'server.close',
      'flushPendingSaves',
      'closeSockets',
      'releaseLock',
      'endPool',
      'exit',
    ]);
    expect(deps.closeSockets).toHaveBeenCalledWith(1001, 'Server shutting down');
    expect(deps.exit).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(0);
    expect(logged()).toMatch(/stopped cleanly on SIGTERM/);
  });

  it('marks readiness as shutting down before it stops accepting connections', async () => {
    let flagAtClose;
    deps.server.close = vi.fn(() => { flagAtClose = deps.readiness.shuttingDown; });

    const done = createShutdown(deps)('SIGINT');
    // Synchronously, before the first await: a probe that lands during the
    // flush already reads 503.
    expect(deps.readiness.shuttingDown).toBe(true);
    await done;

    expect(flagAtClose).toBe(true);
  });

  it('still releases the database and exits 0 when the flush rejects', async () => {
    deps.flushPendingSaves = step('flushPendingSaves', async () => { throw new Error('disk on fire'); });

    await createShutdown(deps)('SIGTERM');

    expect(calls).toEqual(['server.close', 'flushPendingSaves', 'closeSockets', 'releaseLock', 'endPool', 'exit']);
    expect(deps.exit).toHaveBeenCalledWith(0);
    expect(logged()).toMatch(/disk on fire/);
  });

  it('carries on past any step that throws, synchronously or not', async () => {
    deps.closeSockets = step('closeSockets', () => { throw new Error('socket boom'); });
    deps.releaseLock = step('releaseLock', async () => { throw new Error('lock boom'); });

    await createShutdown(deps)('SIGTERM');

    expect(calls).toEqual(['server.close', 'flushPendingSaves', 'closeSockets', 'releaseLock', 'endPool', 'exit']);
    expect(deps.exit).toHaveBeenCalledWith(0);
    expect(logged()).toMatch(/socket boom/);
    expect(logged()).toMatch(/lock boom/);
  });

  it('exits 1 at exactly timeoutMs when a step never finishes', async () => {
    deps.flushPendingSaves = step('flushPendingSaves', () => new Promise(() => {}));
    deps.timeoutMs = 10_000;

    createShutdown(deps)('SIGTERM');

    await vi.advanceTimersByTimeAsync(9_999);
    expect(deps.exit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(deps.exit).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(1);
    expect(logged()).toMatch(/timed out after 10000 ms/);
    expect(deps.endPool).not.toHaveBeenCalled();
  });

  it('bounds itself at ten seconds by default', async () => {
    deps.flushPendingSaves = step('flushPendingSaves', () => new Promise(() => {}));

    createShutdown(deps)('SIGTERM');

    await vi.advanceTimersByTimeAsync(9_999);
    expect(deps.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(deps.exit).toHaveBeenCalledWith(1);
  });

  it('exits once, with 1, when a slow step finishes after the bound', async () => {
    let finishFlush;
    deps.flushPendingSaves = step('flushPendingSaves', () => new Promise((resolve) => { finishFlush = resolve; }));
    deps.timeoutMs = 1_000;

    const done = createShutdown(deps)('SIGTERM');
    await vi.advanceTimersByTimeAsync(1_000);
    finishFlush();
    await done;

    expect(deps.exit).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(1);
  });

  it('does not leave its timer running after a clean stop', async () => {
    await createShutdown(deps)('SIGTERM');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores a second signal while the first is in progress', async () => {
    let finishFlush;
    deps.flushPendingSaves = step('flushPendingSaves', () => new Promise((resolve) => { finishFlush = resolve; }));

    const shutdown = createShutdown(deps);
    const first = shutdown('SIGTERM');
    const second = shutdown('SIGINT');
    finishFlush();
    await Promise.all([first, second]);

    expect(deps.server.close).toHaveBeenCalledTimes(1);
    expect(deps.flushPendingSaves).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledTimes(1);
    expect(logged()).toMatch(/stopped cleanly on SIGTERM/);
    expect(logged()).not.toMatch(/SIGINT/);
  });
});
