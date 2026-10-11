/**
 * The webhook delivery worker: the signature vectors and one tick, with every
 * dependency injected (the query, the sender, the clock and the DNS resolver)
 *
 * The SQL is matched by its distinctive text, so a test names the write it
 * expects and what it must carry. The live-MySQL behaviour (ordering, two
 * workers, a lapsed lease, the backoff schedule) is proved in
 * tests/integration/webhooks-worker.test.js.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWebhookWorker, signBody, pruneWebhookRows, startWebhookWorker, postWebhook } from '../../services/webhook-worker.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const VECTORS = JSON.parse(
  readFileSync(path.join(here, '..', 'fixtures', 'codex-event-signature-vectors.json'), 'utf8')
);

// A public address literal for every name these tests resolve, so no DNS runs.
const PUBLIC = async () => [{ address: '203.0.113.10', family: 4 }];

const BODY = Buffer.from('{"schema":"codex.event.v1","id":"x"}', 'utf8');

/**
 * A fake query: each route is [pattern, answer]. The first pattern that
 * matches the SQL wins; an answer that is a function is called with the
 * params. An unmatched statement fails the test loudly.
 */
function fakeDb(routes) {
  const calls = [];
  const query = vi.fn(async (sql, params) => {
    calls.push({ sql, params });
    for (const [pattern, answer] of routes) {
      if (pattern.test(sql)) return typeof answer === 'function' ? answer(params, sql) : answer;
    }
    throw new Error(`unexpected SQL in test: ${sql.trim().split('\n')[0]}`);
  });
  const writes = (pattern) => calls.filter((c) => pattern.test(c.sql));
  return { query, calls, writes };
}

const OK = { affectedRows: 1 };
const NONE = { affectedRows: 0 };

const SUBS = /FROM webhook_subscriptions\s+WHERE enabled = TRUE/;
const HEAD = /JOIN webhook_events e ON/;
const LEASE = /SET leased_by = \?, lease_expires_at = NOW\(3\)/;
const EXPIRE = /last_error = 'expired after 72h'/;
const DELIVERED = /SET status = 'delivered'/;
const SUB_RESET = /SET consecutive_failures = 0, paused_until = NULL/;
const RELEASE_410 = /SET last_status = \?, last_error = \?, leased_by = NULL/;
const SUB_DISABLE = /SET enabled = FALSE, disabled_reason = \?/;
const DEAD_422 = /SET status = 'dead', last_status = \?/;
const FAILED = /SET attempts = attempts \+ 1/;
const SUB_BACKOFF = /LEAST\(10 \* POW\(2, consecutive_failures\), 3600\)/;

/** A head row as the head query returns it. */
const head = (over = {}) => ({
  id: 11,
  attempts: 0,
  sequence: 5,
  type: 'log.rename',
  body: BODY,
  expired: 0,
  ...over,
});

/** A subscription row as the tick's first query returns it. */
const sub = (over = {}) => ({
  id: 3,
  url: 'https://receiver.example/codex',
  source: 'admin',
  secret: 'a'.repeat(64),
  ...over,
});

/**
 * One tick's database: the subscription list, then the given heads in order
 * (an empty array ends a subscription's run), every lease succeeding unless
 * `lease` says otherwise, and every guarded write matching.
 */
function tickDb({ subs = [sub()], heads = [head()], lease = OK, writes = OK } = {}) {
  const queue = [...heads];
  return fakeDb([
    [SUBS, subs],
    [HEAD, () => (queue.length ? [queue.shift()] : [])],
    [LEASE, lease],
    [EXPIRE, writes],
    [DELIVERED, writes],
    [SUB_RESET, OK],
    [RELEASE_410, writes],
    [SUB_DISABLE, OK],
    [DEAD_422, writes],
    [FAILED, writes],
    [SUB_BACKOFF, OK],
  ]);
}

const worker = (db, over = {}) =>
  createWebhookWorker({
    query: db.query,
    owner: 'owner-a',
    now: () => 0,
    resolve: PUBLIC,
    targetOptions: { allowPrivate: false, production: true },
    ...over,
  });

let savedSecret;
beforeEach(() => {
  savedSecret = process.env.WEBHOOK_SECRET;
  process.env.WEBHOOK_SECRET = 'e'.repeat(40);
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env.WEBHOOK_SECRET;
  else process.env.WEBHOOK_SECRET = savedSecret;
});

describe('the signature, pinned by the committed vectors', () => {
  it('signBody matches every vector byte for byte (UTF-8 secret, raw body bytes)', () => {
    expect(VECTORS).toHaveLength(3);
    for (const v of VECTORS) {
      expect(signBody(v.secret, Buffer.from(v.body_base64, 'base64'))).toBe(v.signature);
    }
  });

  it('agrees with a direct HMAC over the UTF-8 bytes of the secret', () => {
    const v = VECTORS[1];
    const direct = `sha256=${createHmac('sha256', Buffer.from(v.secret, 'utf8'))
      .update(Buffer.from(v.body_base64, 'base64'))
      .digest('hex')}`;
    expect(direct).toBe(v.signature);
  });
});

describe('one send', () => {
  it('POSTs the stored bytes with the three headers and a Content-Length', async () => {
    const db = tickDb({ heads: [head()] });
    const send = vi.fn(async () => ({ status: 200 }));
    await worker(db, { send }).tick();

    expect(send).toHaveBeenCalledTimes(1);
    const req = send.mock.calls[0][0];
    expect(req.url).toBe('https://receiver.example/codex');
    expect(req.body).toBe(BODY);
    expect(req.headers['Content-Type']).toBe('application/json');
    expect(req.headers['X-Codex-Event']).toBe('log.rename');
    expect(req.headers['X-Codex-Delivery']).toBe('11');
    expect(req.headers['Content-Length']).toBe(BODY.length);
    expect(req.headers['X-Codex-Signature-256']).toBe(signBody('a'.repeat(64), BODY));
    expect(req.addresses).toEqual([{ address: '203.0.113.10', family: 4 }]);
  });

  it('signs an env row with WEBHOOK_SECRET, which is never stored', async () => {
    const db = tickDb({ subs: [sub({ source: 'env', secret: null })] });
    const send = vi.fn(async () => ({ status: 204 }));
    await worker(db, { send }).tick();
    expect(send.mock.calls[0][0].headers['X-Codex-Signature-256']).toBe(signBody('e'.repeat(40), BODY));
  });

  it('a 2xx marks the delivery delivered, releasing its lease, and resets the subscription', async () => {
    const db = tickDb();
    const result = await worker(db, { send: async () => ({ status: 202 }) }).tick();

    const [delivered] = db.writes(DELIVERED);
    expect(delivered.sql).toMatch(/AND leased_by = \?/);
    expect(delivered.params).toEqual([202, 11, 'owner-a']);
    expect(db.writes(SUB_RESET)).toHaveLength(1);
    expect(db.writes(FAILED)).toHaveLength(0);
    expect(result).toEqual({ sent: 1, stale: 0 });
  });

  it('a 410 disables the subscription and leaves the delivery pending for a redelivery', async () => {
    const db = tickDb();
    await worker(db, { send: async () => ({ status: 410 }) }).tick();

    const [release] = db.writes(RELEASE_410);
    expect(release.params).toContain(410);
    expect(release.params).toContain('owner-a');
    expect(db.writes(DEAD_422)).toHaveLength(0);
    const [disable] = db.writes(SUB_DISABLE);
    expect(disable.params).toEqual(['receiver answered 410', 3]);
  });

  it('a 422 dead-letters that one delivery and does not pause the subscription', async () => {
    const db = tickDb({ heads: [head(), head({ id: 12, sequence: 6 })] });
    const result = await worker(db, { send: async () => ({ status: 422 }) }).tick();

    const [dead] = db.writes(DEAD_422);
    expect(dead.params).toContain(422);
    expect(dead.params).toContain(11);
    expect(db.writes(SUB_BACKOFF)).toHaveLength(0);
    expect(db.writes(SUB_DISABLE)).toHaveLength(0);
    // The dead delivery is not the head any more, so the run carries on to the next one.
    expect(result.sent).toBe(2);
  });

  it('a 3xx is a failure, never followed', async () => {
    const db = tickDb();
    const send = vi.fn(async () => ({ status: 302 }));
    await worker(db, { send }).tick();

    expect(send).toHaveBeenCalledTimes(1);
    const [failed] = db.writes(FAILED);
    expect(failed.params).toContain(302);
    expect(failed.params.some((p) => typeof p === 'string' && p.includes('302'))).toBe(true);
    expect(db.writes(SUB_BACKOFF)).toHaveLength(1);
  });

  it('a 5xx, a timeout or a refused connection is a failure with the error text, never the body', async () => {
    const db = tickDb();
    const err = Object.assign(new Error('connect ECONNREFUSED 203.0.113.10:443'), { code: 'ECONNREFUSED' });
    await worker(db, { send: async () => { throw err; } }).tick();

    const [failed] = db.writes(FAILED);
    expect(failed.params).toContain('ECONNREFUSED');
    expect(failed.params).toContain(null);
    expect(db.writes(SUB_BACKOFF)).toHaveLength(1);
  });

  it('caps last_error at 255 characters', async () => {
    const db = tickDb();
    const err = Object.assign(new Error('x'.repeat(400)), { code: 'E'.repeat(400) });
    await worker(db, { send: async () => { throw err; } }).tick();
    const [failed] = db.writes(FAILED);
    const text = failed.params.find((p) => typeof p === 'string' && p.startsWith('E'));
    expect(text.length).toBeLessThanOrEqual(255);
  });

  it('a failure releases the lease, counts the attempt and pauses the subscription by the backoff formula', async () => {
    const db = tickDb();
    await worker(db, { send: async () => ({ status: 500 }) }).tick();

    expect(db.writes(FAILED)[0].params).toContain(500);
    const [pause] = db.writes(SUB_BACKOFF);
    expect(pause.params).toEqual([3]);
    expect(pause.sql).toMatch(/DATE_ADD\(NOW\(3\)/);
  });

  it('a signing secret that is missing at send time is a failure, and nothing is sent', async () => {
    delete process.env.WEBHOOK_SECRET;
    const db = tickDb({ subs: [sub({ source: 'env', secret: null })] });
    const send = vi.fn(async () => ({ status: 200 }));
    await worker(db, { send }).tick();
    expect(send).not.toHaveBeenCalled();
    expect(db.writes(FAILED)).toHaveLength(1);
  });
});

describe('the lease and the head', () => {
  it('skips a subscription whose head another worker holds', async () => {
    const db = tickDb({ lease: NONE });
    const send = vi.fn(async () => ({ status: 200 }));
    const result = await worker(db, { send }).tick();
    expect(send).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, stale: 0 });
  });

  it('only ever leases the head: the head query orders by event and takes one row', async () => {
    const db = tickDb({ heads: [] });
    await worker(db).tick();
    const headQuery = db.calls.find((c) => HEAD.test(c.sql));
    expect(headQuery.sql).toMatch(/ORDER BY d\.event_id\s+LIMIT 1/);
    expect(headQuery.sql).toMatch(/d\.status = 'pending'/);
  });

  it('selects the subscriptions that are enabled and not paused, at most twenty', async () => {
    const db = tickDb({ subs: [] });
    await worker(db).tick();
    const subQuery = db.calls.find((c) => SUBS.test(c.sql));
    expect(subQuery.sql).toMatch(/paused_until IS NULL OR paused_until <= NOW\(3\)/);
    expect(subQuery.sql).toMatch(/LIMIT 20/);
  });
});

describe('an expired head', () => {
  it('is dead-lettered with the 72-hour reason and nothing is sent for it', async () => {
    const db = tickDb({ heads: [head({ expired: 1 })] });
    const send = vi.fn(async () => ({ status: 200 }));
    await worker(db, { send }).tick();

    expect(send).not.toHaveBeenCalled();
    const [expire] = db.writes(EXPIRE);
    expect(expire.params).toEqual([11, 'owner-a']);
    expect(expire.sql).toMatch(/AND leased_by = \?/);
  });

  it('is checked in SQL against UTC_TIMESTAMP, not NOW', async () => {
    const db = tickDb({ heads: [] });
    await worker(db).tick();
    const headQuery = db.calls.find((c) => HEAD.test(c.sql));
    expect(headQuery.sql).toMatch(/UTC_TIMESTAMP\(3\) - INTERVAL 72 HOUR/);
    expect(headQuery.sql).not.toMatch(/occurred_at\s*<\s*NOW/);
  });
});

describe('a target the guard refuses at send time', () => {
  it('is not sent to; the subscription is disabled with the sentence and the delivery stays pending', async () => {
    const db = tickDb();
    const send = vi.fn(async () => ({ status: 200 }));
    const rebound = async () => [{ address: '10.0.0.5', family: 4 }];
    await worker(db, { send, resolve: rebound }).tick();

    expect(send).not.toHaveBeenCalled();
    const [disable] = db.writes(SUB_DISABLE);
    expect(disable.params[0]).toMatch(/loopback or private/);
    expect(db.writes(RELEASE_410)).toHaveLength(1);
    expect(db.writes(DEAD_422)).toHaveLength(0);
  });

  it('a name that does not resolve yet is a failure with backoff, not a disable', async () => {
    const db = tickDb();
    const send = vi.fn(async () => ({ status: 200 }));
    const nxdomain = async () => { throw Object.assign(new Error('nope'), { code: 'ENOTFOUND' }); };
    await worker(db, { send, resolve: nxdomain }).tick();

    expect(send).not.toHaveBeenCalled();
    expect(db.writes(SUB_DISABLE)).toHaveLength(0);
    expect(db.writes(FAILED)).toHaveLength(1);
    expect(db.writes(SUB_BACKOFF)).toHaveLength(1);
  });
});

describe('the budget', () => {
  it('stops after five seconds, even with heads left', async () => {
    let t = 0;
    const db = tickDb({ heads: [head(), head({ id: 12, sequence: 6 })] });
    const send = vi.fn(async () => { t = 5001; return { status: 200 }; });
    const result = await worker(db, { send, now: () => t }).tick();
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.sent).toBe(1);
  });

  it('stops after one hundred sends', async () => {
    const heads = Array.from({ length: 150 }, (_, i) => head({ id: 100 + i, sequence: 100 + i }));
    const db = tickDb({ heads });
    const send = vi.fn(async () => ({ status: 200 }));
    const result = await worker(db, { send }).tick();
    expect(send).toHaveBeenCalledTimes(100);
    expect(result.sent).toBe(100);
  });
});

describe('a lapsed lease writes nothing', () => {
  it('an outcome whose guarded write touches no row is counted stale and changes no subscription', async () => {
    const db = tickDb({ writes: NONE });
    const result = await worker(db, { send: async () => ({ status: 500 }) }).tick();
    expect(result.stale).toBe(1);
    expect(db.writes(SUB_BACKOFF)).toHaveLength(0);
  });

  it('a stale 2xx does not reset the subscription either', async () => {
    const db = tickDb({ writes: NONE });
    await worker(db, { send: async () => ({ status: 200 }) }).tick();
    expect(db.writes(SUB_RESET)).toHaveLength(0);
  });
});

describe('pruneWebhookRows', () => {
  it('deletes finished deliveries and then unreferenced events, both older than thirty days', async () => {
    const db = fakeDb([
      [/DELETE FROM webhook_deliveries/, { affectedRows: 4 }],
      [/DELETE FROM webhook_events/, { affectedRows: 2 }],
    ]);
    const counts = await pruneWebhookRows({ query: db.query });
    expect(counts).toEqual({ deliveries: 4, events: 2 });
    expect(db.calls[0].sql).toMatch(/status IN \('delivered', 'dead'\)/);
    expect(db.calls[0].sql).toMatch(/INTERVAL 30 DAY/);
    expect(db.calls[1].sql).toMatch(/NOT IN \(SELECT event_id FROM webhook_deliveries\)/);
    expect(db.calls[1].sql).toMatch(/INTERVAL 30 DAY/);
  });
});

describe('startWebhookWorker', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('ticks every two seconds, never overlaps a tick, and logs a tick that throws', async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let release;
    let calls = 0;
    const query = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('database down');
      await new Promise((resolve) => { release = resolve; });
      return [];
    });
    const started = startWebhookWorker({ query, owner: 'owner-s', now: () => 0 });

    await vi.advanceTimersByTimeAsync(2000);
    expect(query).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('webhook delivery tick failed'), expect.any(Error));

    await vi.advanceTimersByTimeAsync(2000);
    expect(query).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(6000);
    expect(query).toHaveBeenCalledTimes(2);

    release();
    await vi.advanceTimersByTimeAsync(2000);
    expect(query).toHaveBeenCalledTimes(3);
    started.stop();
    await vi.advanceTimersByTimeAsync(10000);
    expect(query).toHaveBeenCalledTimes(3);
  });
});

describe('postWebhook, the real send to a local receiver', () => {
  let server;
  let port;
  let seen;
  let answerWith;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        seen.push({ path: req.url, method: req.method, headers: req.headers, body: Buffer.concat(chunks) });
        res.writeHead(answerWith.status, answerWith.location ? { location: answerWith.location } : {});
        res.end('reply body that must never be read');
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    seen = [];
    answerWith = { status: 204 };
  });

  it('POSTs the bytes with the headers and reports the status', async () => {
    const result = await postWebhook({
      url: `http://127.0.0.1:${port}/codex`,
      body: BODY,
      headers: { 'Content-Type': 'application/json', 'Content-Length': BODY.length, 'X-Codex-Delivery': '7' },
      addresses: [{ address: '127.0.0.1', family: 4 }],
    });
    expect(result).toEqual({ status: 204 });
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe('POST');
    expect(seen[0].path).toBe('/codex');
    expect(seen[0].headers['x-codex-delivery']).toBe('7');
    expect(seen[0].body.equals(BODY)).toBe(true);
  });

  it('reports a 3xx as the status and never follows it', async () => {
    answerWith = { status: 301, location: `http://127.0.0.1:${port}/elsewhere` };
    const result = await postWebhook({
      url: `http://127.0.0.1:${port}/moved`,
      body: BODY,
      headers: { 'Content-Length': BODY.length },
      addresses: [{ address: '127.0.0.1', family: 4 }],
    });
    expect(result).toEqual({ status: 301 });
    expect(seen.map((s) => s.path)).toEqual(['/moved']);
  });

  it('connects only through approved addresses: a name with none approved is refused', async () => {
    await expect(
      postWebhook({
        url: `http://unapproved.test:${port}/x`,
        body: BODY,
        headers: { 'Content-Length': BODY.length },
        addresses: [],
      })
    ).rejects.toMatchObject({ code: 'ENOTFOUND' });
  });
});
