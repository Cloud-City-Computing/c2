/**
 * Bounded graceful shutdown for the Cloud Codex process
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

/** Docker's default grace is 10 s; the compose files give 20, so this finishes first. */
export const SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * Stop in an order that loses nothing: refuse new work, flush what is pending,
 * close the sockets, release the database. Bounded, because a supervisor sends
 * SIGKILL after its grace period whether or not this finished.
 *
 * Every step runs even when an earlier one throws, because each one releases
 * something the next process needs: a flush that fails for one document must
 * not leave the instance lock held or the pool open. A step's failure is
 * logged, not fatal; only the bound turns a signal's exit code non-zero, since
 * that is the case where a step may not have run at all. The last line says
 * `stopped cleanly` only when every step ran and every pending document was
 * written, because that line is what an operator is told to look for.
 *
 * @param {Object} deps
 * @param {{ close: Function }} deps.server - the HTTP server; close() stops new connections
 * @param {{ shuttingDown: boolean }} deps.readiness - /readyz answers 503 once this is set
 * @param {() => Promise<{ saved: number, failed: number } | void>} deps.flushPendingSaves - writes every debounced collab save now
 * @param {(code: number, reason: string) => void} deps.closeSockets - closes both WebSocket servers
 * @param {() => Promise<void>} deps.releaseLock - ends the instance lock's connection
 * @param {() => Promise<void>} deps.endPool - ends the shared MySQL pool
 * @param {(code: number) => void} deps.exit - process.exit, injected for tests
 * @param {(line: string) => void} deps.log
 * @param {number} [deps.timeoutMs]
 * @returns {(cause: string, options?: { code?: number }) => Promise<void>} the handler; a second call is
 *   ignored. `cause` names what stopped it (a signal, or `the lost instance lock`), and `code` is the exit
 *   code once every step has run: 0 for a signal, 1 for a stop the process was forced into.
 */
export function createShutdown({ server, readiness, flushPendingSaves, closeSockets, releaseLock,
                                 endPool, exit, log, timeoutMs = SHUTDOWN_TIMEOUT_MS }) {
  let started = false;
  let exited = false;
  const exitOnce = (code) => {
    if (exited) return;
    exited = true;
    exit(code);
  };

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  return async function shutdown(cause, { code = 0 } = {}) {
    if (started) return;
    started = true;
    readiness.shuttingDown = true;              // /readyz answers 503 from here on
    const timer = setTimeout(() => {
      log(`shutdown timed out after ${timeoutMs} ms`);
      exitOnce(1);
    }, timeoutMs);
    timer.unref?.();

    let failedSteps = 0;
    const run = async (name, fn) => {
      try {
        return await fn();
      } catch (err) {
        failedSteps++;
        log(`shutdown: ${name} failed: ${err?.message ?? err}`);
        return undefined;
      }
    };

    await run('closing the HTTP server', () => server.close());   // stop accepting connections
    const flushed = await run('flushing pending saves', () => flushPendingSaves());
    const unsaved = flushed?.failed ?? 0;
    if (flushed && flushed.saved + unsaved > 0) {
      log(`shutdown: wrote ${plural(flushed.saved, 'pending document')}${unsaved ? `, ${unsaved} failed` : ''}`);
    }
    await run('closing the WebSocket servers', () => closeSockets(1001, 'Server shutting down'));
    await run('releasing the instance lock', () => releaseLock());
    await run('ending the database pool', () => endPool());

    clearTimeout(timer);
    if (exited) return;
    const problems = [];
    if (unsaved) problems.push(`${plural(unsaved, 'document')} not saved`);
    if (failedSteps) problems.push(plural(failedSteps, 'failed step'));
    if (code === 0 && problems.length === 0) {
      log(`stopped cleanly on ${cause}`);
    } else {
      log(`stopped on ${cause}${problems.length ? ` with ${problems.join(' and ')}` : ''}`);
    }
    exitOnce(code);
  };
}
