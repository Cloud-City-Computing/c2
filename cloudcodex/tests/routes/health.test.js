/**
 * Cloud Codex - Tests for routes/health.js, the liveness and readiness probes
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { c2_query } from '../../mysql_connect.js';
import { listMigrationFiles, MIGRATIONS_DIR } from '../../scripts/migrate.js';
import { readiness, notReadyReason } from '../../routes/health.js';
import { resetMocks } from '../helpers.js';

vi.mock('../../scripts/migrate.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, listMigrationFiles: vi.fn(actual.listMigrationFiles) };
});

const actualMigrate = await vi.importActual('../../scripts/migrate.js');
const ALL_FILES = actualMigrate.listMigrationFiles(MIGRATIONS_DIR);

/**
 * Answer the two queries /readyz may issue. `select1` is 'ok', 'fail' or
 * 'hang'; `applied` is the filenames schema_migrations holds, or an Error to
 * throw instead (a database nobody has adopted has no such table).
 */
function database({ select1 = 'ok', applied = ALL_FILES } = {}) {
  c2_query.mockImplementation(async (sql) => {
    if (sql === 'SELECT 1') {
      if (select1 === 'fail') throw new Error('connect ECONNREFUSED');
      if (select1 === 'hang') return new Promise(() => {});
      return [{ 1: 1 }];
    }
    if (/schema_migrations/.test(sql)) {
      if (applied instanceof Error) throw applied;
      return applied.map((filename) => ({ filename, checksum: 'c'.repeat(64) }));
    }
    throw new Error(`unexpected query: ${sql}`);
  });
}

const queriesMatching = (pattern) => c2_query.mock.calls.filter(([sql]) => pattern.test(sql)).length;

beforeEach(() => {
  resetMocks();
  listMigrationFiles.mockImplementation(actualMigrate.listMigrationFiles);
  readiness.shuttingDown = false;
  readiness.lock = { held: true, disabled: false };
  readiness.migrations = null;
  readiness.database = null;
  readiness.reported = new Set();
  database();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /healthz', () => {
  it('answers 200 without touching the database', async () => {
    const res = await request(app).get('/healthz');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(c2_query).not.toHaveBeenCalled();
  });

  it('answers even while shutting down and with no lock: it says only that the process is alive', async () => {
    readiness.shuttingDown = true;
    readiness.lock = null;

    const res = await request(app).get('/healthz');

    expect(res.status).toBe(200);
    expect(c2_query).not.toHaveBeenCalled();
  });

  it('is never cached by a proxy in between', async () => {
    const res = await request(app).get('/healthz');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('GET /readyz', () => {
  it('answers 200 when the lock is held, the database answers and nothing is pending', async () => {
    const res = await request(app).get('/readyz');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ready: true });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('non-vacuity: the migrations directory this checks is not empty', () => {
    expect(ALL_FILES.length).toBeGreaterThan(10);
  });

  it('answers 503 shutting_down once shutdown has begun, and asks the database nothing', async () => {
    readiness.shuttingDown = true;

    const res = await request(app).get('/readyz');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ready: false, reason: 'shutting_down' });
    expect(c2_query).not.toHaveBeenCalled();
  });

  it('answers 503 lock when the instance lock has not been taken', async () => {
    readiness.lock = null;

    const res = await request(app).get('/readyz');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ready: false, reason: 'lock' });
  });

  it('answers 503 lock when the instance lock was lost', async () => {
    readiness.lock = { held: false, disabled: false };

    const res = await request(app).get('/readyz');

    expect(res.body).toEqual({ ready: false, reason: 'lock' });
  });

  it('passes the lock check when the operator disabled the lock', async () => {
    readiness.lock = { held: false, disabled: true };

    const res = await request(app).get('/readyz');

    expect(res.status).toBe(200);
  });

  it('answers 503 database when SELECT 1 fails', async () => {
    database({ select1: 'fail' });

    const res = await request(app).get('/readyz');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ready: false, reason: 'database' });
  });

  it('answers database when SELECT 1 takes longer than two seconds', async () => {
    vi.useFakeTimers();
    database({ select1: 'hang' });

    const pending = notReadyReason();
    await vi.advanceTimersByTimeAsync(1_999);
    let settled = false;
    pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe('database');
  });

  it('answers 503 migrations when a file in migrations/ has no schema_migrations row', async () => {
    database({ applied: ALL_FILES.slice(0, -1) });

    const res = await request(app).get('/readyz');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ready: false, reason: 'migrations' });
  });

  it('answers migrations on a database nobody has adopted (no schema_migrations table)', async () => {
    database({ applied: Object.assign(new Error("Table 'c2.schema_migrations' doesn't exist"), { code: 'ER_NO_SUCH_TABLE' }) });

    const res = await request(app).get('/readyz');

    expect(res.body).toEqual({ ready: false, reason: 'migrations' });
  });

  it('answers migrations, rather than ready, when the migrations directory cannot be read', async () => {
    listMigrationFiles.mockImplementation(() => { throw new Error('ENOENT: no such file or directory'); });

    const res = await request(app).get('/readyz');

    expect(res.body).toEqual({ ready: false, reason: 'migrations' });
  });

  it('reads schema_migrations at most once every ten seconds', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-27T12:00:00Z'));

    await request(app).get('/readyz');
    vi.setSystemTime(new Date('2026-09-27T12:00:09.999Z'));
    await request(app).get('/readyz');
    expect(queriesMatching(/schema_migrations/)).toBe(1);

    vi.setSystemTime(new Date('2026-09-27T12:00:10.001Z'));
    await request(app).get('/readyz');
    expect(queriesMatching(/schema_migrations/)).toBe(2);
    // The database answer is cached for one second only, and the third probe
    // came two milliseconds after the second.
    expect(queriesMatching(/^SELECT 1$/)).toBe(2);
  });

  it('reuses the database answer for one second, then asks again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-27T12:00:00Z'));

    await request(app).get('/readyz');
    vi.setSystemTime(new Date('2026-09-27T12:00:00.999Z'));
    await request(app).get('/readyz');
    expect(queriesMatching(/^SELECT 1$/)).toBe(1);

    vi.setSystemTime(new Date('2026-09-27T12:00:01.001Z'));
    await request(app).get('/readyz');
    expect(queriesMatching(/^SELECT 1$/)).toBe(2);
  });

  it('never caches past a stop or a lost lock: those are read on every probe', async () => {
    expect((await request(app).get('/readyz')).status).toBe(200);

    readiness.lock = { held: false, disabled: false };
    expect((await request(app).get('/readyz')).body).toEqual({ ready: false, reason: 'lock' });
    readiness.lock = { held: true, disabled: false };
    readiness.shuttingDown = true;
    expect((await request(app).get('/readyz')).body).toEqual({ ready: false, reason: 'shutting_down' });
  });

  it('concurrent probes share one check instead of each querying the pool', async () => {
    const answers = await Promise.all(Array.from({ length: 8 }, () => request(app).get('/readyz')));

    expect(answers.map((res) => res.status)).toEqual(Array(8).fill(200));
    expect(queriesMatching(/^SELECT 1$/)).toBe(1);
    expect(queriesMatching(/schema_migrations/)).toBe(1);
  });

  it('never has more than one SELECT 1 outstanding, however long it hangs', async () => {
    vi.useFakeTimers();
    database({ select1: 'hang' });

    const first = notReadyReason();
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(first).resolves.toBe('database');

    await vi.advanceTimersByTimeAsync(1_500);          // past the one-second reuse
    const second = notReadyReason();
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(second).resolves.toBe('database');

    // A timed-out probe's query still holds a pooled connection; a second one
    // queued behind it would hold another, and so on until the pool is full.
    expect(queriesMatching(/^SELECT 1$/)).toBe(1);
  });

  it('says once, in the log, how to adopt a database nobody has adopted', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-27T12:00:00Z'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    database({ applied: Object.assign(new Error("Table 'c2.schema_migrations' doesn't exist"), { code: 'ER_NO_SUCH_TABLE' }) });

    await request(app).get('/readyz');
    vi.setSystemTime(new Date('2026-09-27T12:01:00Z'));
    await request(app).get('/readyz');

    const lines = errorSpy.mock.calls.flat().map(String).filter((line) => /--adopt-fresh-install/.test(line));
    expect(lines).toHaveLength(1);
    expect(queriesMatching(/schema_migrations/)).toBe(2);
    errorSpy.mockRestore();
  });

  it('notices the migration being applied within the cache window', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-27T12:00:00Z'));
    database({ applied: ALL_FILES.slice(0, -1) });
    expect((await request(app).get('/readyz')).status).toBe(503);

    database();
    vi.setSystemTime(new Date('2026-09-27T12:00:10.001Z'));
    expect((await request(app).get('/readyz')).status).toBe(200);
  });
});

describe('the probes carry no information', () => {
  // Reachable by anyone who can reach the port, so neither body may carry a
  // version, a count, a filename or a table name.
  const cases = [
    ['/healthz', () => {}],
    ['/readyz', () => {}],
    ['/readyz', () => { readiness.shuttingDown = true; }],
    ['/readyz', () => { readiness.lock = null; }],
    ['/readyz', () => database({ select1: 'fail' })],
    ['/readyz', () => database({ applied: ALL_FILES.slice(0, -2) })],
    ['/readyz', () => database({ applied: new Error("Table 'c2.schema_migrations' doesn't exist") })],
  ];

  it.each(cases)('%s leaks nothing (case %#)', async (path, arrange) => {
    arrange();

    const res = await request(app).get(path);
    const text = res.text;

    expect(text).not.toMatch(/\d/);
    expect(text).not.toMatch(/\.sql|schema_migrations|version|c2/i);
    expect(Object.keys(res.body).sort()).toEqual(
      path === '/healthz' ? ['ok'] : (res.body.ready ? ['ready'] : ['ready', 'reason'])
    );
    if (res.body.reason !== undefined) {
      expect(['shutting_down', 'lock', 'database', 'migrations']).toContain(res.body.reason);
    }
  });
});
