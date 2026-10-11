/**
 * The webhook delivery worker, proved against a live MySQL server and a real
 * receiver
 *
 * The receiver is a Node http server on 127.0.0.1, so every send is a real
 * request through pinnedLookup, and every assertion reads what it received
 * or what the outbox tables hold. Events and deliveries are written directly,
 * so this file tests the worker alone; the emit hook is tests/integration/
 * webhooks-emit.test.js. WEBHOOK_ALLOW_PRIVATE_TARGETS is not read here: the
 * worker is given the guard's options, so a private receiver is allowed by
 * construction, and one test shows the refusal without it.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import http from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import app from '../../app.js';
import { c2_query, generateSessionToken } from '../../mysql_connect.js';
import { createWebhookWorker, signBody, pruneWebhookRows } from '../../services/webhook-worker.js';

const SECRET = 'b'.repeat(64);
const ALLOW_PRIVATE = { allowPrivate: true, production: false };

let server;
let port;
let answer;
let received;
const sockets = new Set();

/** A receiver answer that is the same for every request. */
const reply = (status, extra = {}) => () => ({ status, ...extra });

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const label = JSON.parse(body.toString('utf8')).n;
      received.push({
        path: req.url,
        delivery: req.headers['x-codex-delivery'],
        event: req.headers['x-codex-event'],
        signature: req.headers['x-codex-signature-256'],
        contentType: req.headers['content-type'],
        length: Number(req.headers['content-length']),
        body,
        label,
      });
      const { status, location, hang } = answer(label, received.length);
      if (hang) return;
      res.writeHead(status, location ? { location } : {});
      res.end();
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

afterAll(async () => {
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
  answer = reply(200);
  received = [];
  await c2_query('DELETE FROM webhook_deliveries', []);
  await c2_query('DELETE FROM webhook_events', []);
  await c2_query('DELETE FROM webhook_subscriptions', []);
});

/** An admin subscription to `url`, returns its id. */
async function addSubscription(url, { source = 'admin', secret = SECRET } = {}) {
  const created = await c2_query(
    `INSERT INTO webhook_subscriptions (url, secret, source) VALUES (?, ?, ?)`,
    [url, source === 'env' ? null : secret, source]
  );
  return created.insertId;
}

/**
 * An outbox event labelled `label`, `hoursOld` hours before now (UTC), with a
 * delivery to each subscription. Returns the event id.
 */
async function addEvent(label, subscriptionIds, { hoursOld = 0, type = 'log.rename' } = {}) {
  const uuid = randomUUID();
  const body = Buffer.from(JSON.stringify({ schema: 'codex.event.v1', id: uuid, n: label, type }), 'utf8');
  const created = await c2_query(
    `INSERT INTO webhook_events (event_uuid, type, workspace_id, occurred_at, body)
     VALUES (?, ?, 1, UTC_TIMESTAMP(3) - INTERVAL ? HOUR, ?)`,
    [uuid, type, hoursOld, body]
  );
  for (const subscriptionId of subscriptionIds) {
    await c2_query('INSERT INTO webhook_deliveries (subscription_id, event_id) VALUES (?, ?)', [
      subscriptionId,
      created.insertId,
    ]);
  }
  return created.insertId;
}

/** Every delivery row of one subscription, in event order. */
async function deliveriesOf(subscriptionId) {
  return c2_query(
    `SELECT id, event_id, status, attempts, leased_by, last_status, last_error
       FROM webhook_deliveries WHERE subscription_id = ? ORDER BY event_id`,
    [subscriptionId]
  );
}

async function subscriptionRow(id) {
  const [row] = await c2_query(
    `SELECT enabled, disabled_reason, consecutive_failures, paused_until FROM webhook_subscriptions WHERE id = ?`,
    [id]
  );
  return row;
}

/** Clears every pause, as time passing would, so the next tick may send. */
const unpause = () => c2_query('UPDATE webhook_subscriptions SET paused_until = NULL', []);

/** The worker options that point at the test receiver. */
const worker = (over = {}) => createWebhookWorker({ targetOptions: ALLOW_PRIVATE, ...over });

/** Deliveries still pending, across every subscription. */
async function pendingCount() {
  const [{ pending }] = await c2_query(`SELECT COUNT(*) AS pending FROM webhook_deliveries WHERE status = 'pending'`, []);
  return Number(pending);
}

/**
 * Ticks until nothing is pending, unpausing between ticks the way time would,
 * for at most `limitMs`. A worker that finds its head leased by another
 * waits briefly rather than giving up. Returns the pending deliveries left.
 */
async function drain(w, limitMs = 20000) {
  const deadline = Date.now() + limitMs;
  while (Date.now() < deadline) {
    await unpause();
    await w.tick();
    if ((await pendingCount()) === 0) return 0;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return pendingCount();
}

describe('what the receiver gets', () => {
  it('the body is byte-identical to the outbox row, the headers are right, and the signature verifies', async () => {
    const subId = await addSubscription(`http://127.0.0.1:${port}/codex`);
    const eventId = await addEvent('one', [subId]);

    const result = await worker().tick();

    expect(result.sent).toBe(1);
    expect(received).toHaveLength(1);
    const [got] = received;
    const [stored] = await c2_query('SELECT body FROM webhook_events WHERE id = ?', [eventId]);
    expect(got.body.equals(stored.body)).toBe(true);
    expect(got.length).toBe(stored.body.length);
    expect(got.contentType).toBe('application/json');
    expect(got.event).toBe('log.rename');
    expect(got.delivery).toBe(String((await deliveriesOf(subId))[0].id));
    const independent = `sha256=${createHmac('sha256', Buffer.from(SECRET, 'utf8')).update(got.body).digest('hex')}`;
    expect(got.signature).toBe(independent);
    expect(got.signature).toBe(signBody(SECRET, stored.body));
    expect(got.path).toBe('/codex');
    expect((await deliveriesOf(subId))[0].status).toBe('delivered');
  });

  it('an env row is signed with WEBHOOK_SECRET, which the row never stores', async () => {
    const previous = process.env.WEBHOOK_SECRET;
    process.env.WEBHOOK_SECRET = 'c'.repeat(40);
    try {
      const subId = await addSubscription(`http://127.0.0.1:${port}/env`, { source: 'env' });
      await addEvent('env', [subId]);
      await worker().tick();
      expect(received[0].signature).toBe(signBody('c'.repeat(40), received[0].body));
      const [row] = await c2_query('SELECT secret FROM webhook_subscriptions WHERE id = ?', [subId]);
      expect(row.secret).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.WEBHOOK_SECRET;
      else process.env.WEBHOOK_SECRET = previous;
    }
  });
});

describe('ordering', () => {
  it('event 3 is not received until event 2 is delivered, and event 2 is retried in place', async () => {
    const subId = await addSubscription(`http://127.0.0.1:${port}/order`);
    await addEvent(1, [subId]);
    await addEvent(2, [subId]);
    await addEvent(3, [subId]);
    let fails = 0;
    answer = (label) => {
      if (label === 2 && fails < 2) {
        fails += 1;
        return { status: 500 };
      }
      return { status: 200 };
    };

    expect(await drain(worker())).toBe(0);

    expect(received.map((r) => r.label)).toEqual([1, 2, 2, 2, 3]);
    const rows = await deliveriesOf(subId);
    expect(rows.map((r) => r.status)).toEqual(['delivered', 'delivered', 'delivered']);
    expect(rows[1].attempts).toBe(2);
    expect((await subscriptionRow(subId)).consecutive_failures).toBe(0);
  });

  it('a 500 on the head holds every later event behind it, in the same tick', async () => {
    const subId = await addSubscription(`http://127.0.0.1:${port}/hold`);
    await addEvent(1, [subId]);
    await addEvent(2, [subId]);
    answer = () => ({ status: 500 });

    const result = await worker().tick();

    expect(result.sent).toBe(1);
    expect(received.map((r) => r.label)).toEqual([1]);
    expect((await deliveriesOf(subId)).map((r) => r.status)).toEqual(['pending', 'pending']);
  });
});

describe('two workers, one database', () => {
  it('the receiver sees each delivery exactly once', async () => {
    const subId = await addSubscription(`http://127.0.0.1:${port}/two`);
    for (let i = 1; i <= 50; i += 1) await addEvent(i, [subId]);

    const left = await Promise.all([drain(worker({ owner: 'owner-a' })), drain(worker({ owner: 'owner-b' }))]);

    expect(left).toEqual([0, 0]);
    expect(received).toHaveLength(50);
    const ids = new Set(received.map((r) => r.delivery));
    expect(ids.size).toBe(50);
    expect((await deliveriesOf(subId)).every((r) => r.status === 'delivered')).toBe(true);
  });
});

describe('a lapsed lease writes nothing', () => {
  it("owner A's late outcome changes no row after owner B delivered", async () => {
    const subId = await addSubscription(`http://127.0.0.1:${port}/lapse`);
    await addEvent('lapse', [subId]);

    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const a = worker({ owner: 'owner-a', send: async () => { await gate; return { status: 500 }; } });
    const pendingA = a.tick();

    // Wait until A holds the lease, then let it lapse by hand.
    const deadline = Date.now() + 3000;
    for (;;) {
      const [row] = await deliveriesOf(subId);
      if (row.leased_by === 'owner-a') break;
      if (Date.now() > deadline) throw new Error('owner A never leased the delivery');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await c2_query('UPDATE webhook_deliveries SET lease_expires_at = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND', []);

    const b = worker({ owner: 'owner-b' });
    expect((await b.tick()).sent).toBe(1);
    release();
    const resultA = await pendingA;

    expect(resultA.stale).toBe(1);
    const [row] = await deliveriesOf(subId);
    expect(row.status).toBe('delivered');
    expect(row.attempts).toBe(0);
    expect(row.last_status).toBe(200);
    expect(row.leased_by).toBeNull();
    const sub = await subscriptionRow(subId);
    expect(sub.consecutive_failures).toBe(0);
    expect(sub.paused_until).toBeNull();
    expect(received).toHaveLength(1);
  });
});

describe('outcomes', () => {
  it('a 410 disables the subscription and leaves the delivery pending for a redelivery', async () => {
    const subId = await addSubscription(`http://127.0.0.1:${port}/gone`);
    await addEvent('gone', [subId]);
    answer = reply(410);
    const w = worker();

    await w.tick();
    await unpause();
    expect((await w.tick()).sent).toBe(0);

    const sub = await subscriptionRow(subId);
    expect(Boolean(sub.enabled)).toBe(false);
    expect(sub.disabled_reason).toBe('receiver answered 410');
    const [row] = await deliveriesOf(subId);
    expect(row.status).toBe('pending');
    expect(row.leased_by).toBeNull();
    expect(row.last_status).toBe(410);
    expect(received).toHaveLength(1);
  });

  it('a 422 dead-letters that one event, does not pause the subscription, and the run goes on', async () => {
    const subId = await addSubscription(`http://127.0.0.1:${port}/reject`);
    await addEvent(1, [subId]);
    await addEvent(2, [subId]);
    await addEvent(3, [subId]);
    answer = (label) => (label === 2 ? { status: 422 } : { status: 200 });

    expect(await drain(worker())).toBe(0);

    const rows = await deliveriesOf(subId);
    expect(rows.map((r) => r.status)).toEqual(['delivered', 'dead', 'delivered']);
    expect(rows[1].last_status).toBe(422);
    expect(received.map((r) => r.label)).toEqual([1, 2, 3]);
    const sub = await subscriptionRow(subId);
    expect(sub.consecutive_failures).toBe(0);
    expect(sub.paused_until).toBeNull();
  });

  it('a 302 is a failure and is not followed', async () => {
    const subId = await addSubscription(`http://127.0.0.1:${port}/moved`);
    await addEvent('moved', [subId]);
    answer = reply(302, { location: `http://127.0.0.1:${port}/elsewhere` });

    await worker().tick();

    expect(received).toHaveLength(1);
    expect(received[0].path).toBe('/moved');
    const [row] = await deliveriesOf(subId);
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.last_status).toBe(302);
    expect(row.last_error).toMatch(/redirects are not followed/);
  });

  it('a receiver that never answers is a timeout after ten seconds, and a failure', async () => {
    const subId = await addSubscription(`http://127.0.0.1:${port}/hang`);
    await addEvent('hang', [subId]);
    answer = () => ({ hang: true });

    const started = Date.now();
    await worker().tick();
    const elapsed = Date.now() - started;

    expect(elapsed).toBeGreaterThanOrEqual(9500);
    const [row] = await deliveriesOf(subId);
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.last_error).toBe('ETIMEDOUT');
    expect(row.leased_by).toBeNull();
  }, 30000);

  it('the backoff is 10s, 20s, 40s, then 2560s, capped at 3600s (the 1-hour cap)', async () => {
    const subId = await addSubscription(`http://127.0.0.1:${port}/backoff`);
    await addEvent('backoff', [subId]);
    answer = reply(500);
    const w = worker();

    for (const [failuresBefore, seconds] of [[0, 10], [1, 20], [2, 40], [8, 2560], [9, 3600], [40, 3600]]) {
      await c2_query('UPDATE webhook_subscriptions SET consecutive_failures = ?, paused_until = NULL WHERE id = ?', [
        failuresBefore,
        subId,
      ]);
      await w.tick();
      const [gap] = await c2_query(
        `SELECT ROUND(TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(3), paused_until) / 1000000) AS secs,
                consecutive_failures AS failures
           FROM webhook_subscriptions WHERE id = ?`,
        [subId]
      );
      expect(Number(gap.secs), `after ${failuresBefore} failures`).toBe(seconds);
      expect(Number(gap.failures)).toBe(failuresBefore + 1);
    }
  });

  it('an event older than 72 hours is dead-lettered, never sent, and the next one goes', async () => {
    const subId = await addSubscription(`http://127.0.0.1:${port}/stale`);
    await addEvent('old', [subId], { hoursOld: 73 });
    await addEvent('fresh', [subId], { hoursOld: 71 });

    // An expired head is dead-lettered and the run goes on in the same tick.
    const result = await worker().tick();

    expect(result.sent).toBe(1);
    expect(received.map((r) => r.label)).toEqual(['fresh']);
    expect((await deliveriesOf(subId))[0].status).toBe('dead');
    const rows = await deliveriesOf(subId);
    expect(rows[0].last_error).toBe('expired after 72h');
    expect(rows[1].status).toBe('delivered');
  });
});

describe('review follow-ups, against the database', () => {
  it('a late delivered write does not clear a backoff another worker set while it was sending', async () => {
    const subId = await addSubscription(`http://127.0.0.1:${port}/late`);
    await addEvent('late', [subId]);

    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const a = worker({ owner: 'owner-late', send: async () => { await gate; return { status: 200 }; } });
    const pendingA = a.tick();
    const deadline = Date.now() + 3000;
    while ((await deliveriesOf(subId))[0].leased_by !== 'owner-late') {
      if (Date.now() > deadline) throw new Error('owner-late never leased the delivery');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // Another worker's failure, while A is still sending: a live pause and a count.
    await c2_query(
      'UPDATE webhook_subscriptions SET consecutive_failures = 3, paused_until = UTC_TIMESTAMP(3) + INTERVAL 1 HOUR WHERE id = ?',
      [subId]
    );
    release();
    await pendingA;

    const sub = await subscriptionRow(subId);
    expect(sub.consecutive_failures).toBe(3);
    expect(sub.paused_until).not.toBeNull();
    expect((await deliveriesOf(subId))[0].status).toBe('delivered');
  });

  it('a renewed lease covers a send that starts after the DNS check, and the renewal is visible in the row', async () => {
    const subId = await addSubscription(`http://slow.test:${port}/renew`);
    await addEvent('renew', [subId]);
    let leaseAtSend;
    // A slow name: the DNS check takes four seconds before the send.
    const slowName = () => new Promise((resolve) => setTimeout(() => resolve([{ address: '127.0.0.1', family: 4 }]), 4000));
    const w = worker({
      resolve: slowName,
      send: async () => {
        [leaseAtSend] = await c2_query('SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(3), lease_expires_at) AS left_s FROM webhook_deliveries', []);
        return { status: 200 };
      },
    });
    await w.tick();
    // Renewed after the four-second check: about 30 seconds were left at the send.
    expect(Number(leaseAtSend.left_s)).toBeGreaterThan(27);
    expect(received).toHaveLength(0);
  });

  it('the subscription read is not capped: a subscription beyond the twentieth is served', async () => {
    const ids = [];
    for (let i = 0; i < 22; i += 1) ids.push(await addSubscription(`http://127.0.0.1:${port}/many/${i}`));
    for (const id of ids) await addEvent(`many-${id}`, [id]);
    expect(await drain(worker())).toBe(0);
    expect(received).toHaveLength(22);
  });
});

describe('the guard at send time', () => {
  it('a name that now resolves to a private address is not sent to, and the subscription is disabled', async () => {
    const subId = await addSubscription(`http://rebind.test:${port}/hook`);
    await addEvent('rebind', [subId]);
    const privateNow = async () => [{ address: '127.0.0.1', family: 4 }];

    const result = await worker({ targetOptions: { allowPrivate: false, production: false }, resolve: privateNow }).tick();

    expect(result.sent).toBe(0);
    expect(received).toHaveLength(0);
    const sub = await subscriptionRow(subId);
    expect(Boolean(sub.enabled)).toBe(false);
    expect(sub.disabled_reason).toMatch(/loopback or private/);
    expect((await deliveriesOf(subId))[0].status).toBe('pending');
  });

  it('the connect goes to the approved address, not to whatever the name means in DNS', async () => {
    const subId = await addSubscription(`http://pinned.test:${port}/pinned`);
    await addEvent('pinned', [subId]);
    const approved = async () => [{ address: '127.0.0.1', family: 4 }];

    await worker({ resolve: approved }).tick();

    expect(received).toHaveLength(1);
    expect(received[0].path).toBe('/pinned');
  });
});

describe('the daily prune', () => {
  it('removes finished deliveries and unreferenced events older than thirty days, and keeps the rest', async () => {
    const subId = await addSubscription(`http://127.0.0.1:${port}/prune`);
    const oldDone = await addEvent('old-done', [subId]);
    const oldPending = await addEvent('old-pending', [subId]);
    const recent = await addEvent('recent', [subId]);
    await c2_query(`UPDATE webhook_events SET created_at = NOW() - INTERVAL 31 DAY WHERE id IN (?, ?)`, [oldDone, oldPending]);
    await c2_query(
      `UPDATE webhook_deliveries SET status = 'delivered', created_at = NOW() - INTERVAL 31 DAY WHERE event_id = ?`,
      [oldDone]
    );
    await c2_query(`UPDATE webhook_deliveries SET created_at = NOW() - INTERVAL 31 DAY WHERE event_id = ?`, [oldPending]);

    const counts = await pruneWebhookRows();

    expect(counts).toEqual({ deliveries: 1, events: 1 });
    const left = (await c2_query('SELECT id FROM webhook_events ORDER BY id', [])).map((r) => r.id);
    expect(left).toEqual([oldPending, recent]);
  });
});

describe('a subscriber that never answers does not slow a save', () => {
  it('the median save latency is within noise of the same run with no subscription', async () => {
    const actorId = (await c2_query('INSERT INTO users (name, email, password_hash, is_admin) VALUES (?, ?, NULL, FALSE)', [
      'latency',
      'latency@example.com',
    ])).insertId;
    const token = await generateSessionToken({ id: actorId });
    const workspace = (await c2_query('INSERT INTO workspaces (name, owner_id) VALUES (?, ?)', ['Latency', actorId])).insertId;
    const squad = (await c2_query('INSERT INTO squads (workspace_id, name, created_by) VALUES (?, ?, ?)', [
      workspace,
      'Latency squad',
      actorId,
    ])).insertId;
    const archive = (await c2_query('INSERT INTO archives (squad_id, name, created_by) VALUES (?, ?, ?)', [
      squad,
      'Latency archive',
      actorId,
    ])).insertId;
    const doc = (await c2_query(
      `INSERT INTO logs (archive_id, title, html_content, created_by, updated_by) VALUES (?, 'Latency doc', '<p>start</p>', ?, ?)`,
      [archive, actorId, actorId]
    )).insertId;

    /** One save, timed in milliseconds from request to response. */
    const save = async (i) => {
      const started = process.hrtime.bigint();
      const res = await request(app)
        .post('/api/save-document')
        .set('Authorization', `Bearer ${token}`)
        .send({ doc_id: doc, html_content: `<p>save ${i}</p>` });
      expect(res.status).toBe(200);
      return Number(process.hrtime.bigint() - started) / 1e6;
    };
    const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

    const baseline = [];
    for (let i = 0; i < 20; i += 1) baseline.push(await save(i));

    // A subscriber that never answers, with pending deliveries, and a worker
    // ticking in this same process while the saves run.
    const subId = await addSubscription(`http://127.0.0.1:${port}/never`);
    for (let i = 1; i <= 5; i += 1) await addEvent(`never-${i}`, [subId]);
    answer = () => ({ hang: true });
    const background = createWebhookWorker({ targetOptions: ALLOW_PRIVATE });
    const timer = setInterval(() => { background.tick().catch(() => {}); }, 50);
    const withSubscriber = [];
    try {
      for (let i = 0; i < 20; i += 1) withSubscriber.push(await save(100 + i));
    } finally {
      clearInterval(timer);
    }

    const measured = { baselineMedianMs: median(baseline), withSubscriberMedianMs: median(withSubscriber) };
    console.error('save latency', JSON.stringify(measured));
    expect(measured.withSubscriberMedianMs).toBeLessThanOrEqual(measured.baselineMedianMs * 2 + 25);
  }, 60000);
});
