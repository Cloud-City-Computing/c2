/**
 * The outbound-event emit hook, proved against a live MySQL server
 *
 * Every event here is caused the way a person causes it, through the HTTP
 * routes with a real session, and every assertion reads the outbox tables.
 * The subscriptions are made through the admin API, so its SQL runs for real
 * too. logActivity is fire-and-forget, so each assertion polls, and a "writes
 * none" assertion waits long enough for a late write to have landed.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import mysql from 'mysql2/promise';
import app from '../../app.js';
import { c2_query, generateSessionToken } from '../../mysql_connect.js';
import { ENVELOPE_SCHEMA } from '../../services/webhooks.js';
import { openAdminConnection } from './mysql-admin.js';

// A public address literal, so creating a subscription asks no DNS server.
const RECEIVER = 'https://203.0.113.10/codex/events';

let actorId;
let watcherId;
let token;
let adminToken;
let workspaceId;
let otherWorkspaceId;
let squadId;
let archiveId;
let otherArchiveId;
let subscriptionId;

/** A user row, returned as its id. */
async function insertUser(name, isAdmin = false) {
  const created = await c2_query('INSERT INTO users (name, email, password_hash, is_admin) VALUES (?, ?, NULL, ?)', [
    name,
    `${name}@example.com`,
    isAdmin,
  ]);
  return created.insertId;
}

/** A workspace owned by the actor, with one squad; returns both ids. */
async function insertWorkspace(name) {
  const workspace = (await c2_query('INSERT INTO workspaces (name, owner_id) VALUES (?, ?)', [name, actorId])).insertId;
  const squad = (await c2_query('INSERT INTO squads (workspace_id, name, created_by) VALUES (?, ?, ?)', [
    workspace,
    `${name} squad`,
    actorId,
  ])).insertId;
  return { workspace, squad };
}

/** An archive in `squad`, created by the actor. */
async function insertArchive(squad, name) {
  return (await c2_query('INSERT INTO archives (squad_id, name, created_by) VALUES (?, ?, ?)', [squad, name, actorId]))
    .insertId;
}

/** A document in `archive`. */
async function insertLog(archive, title) {
  return (await c2_query(
    `INSERT INTO logs (archive_id, title, html_content, created_by, updated_by) VALUES (?, ?, '<p>start</p>', ?, ?)`,
    [archive, title, actorId, actorId]
  )).insertId;
}

/** The highest outbox id so far, the marker a test counts new events after. */
async function lastEventId() {
  const [row] = await c2_query('SELECT COALESCE(MAX(id), 0) AS id FROM webhook_events', []);
  return Number(row.id);
}

/** Long enough for the rest of a fire-and-forget logActivity to land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

/**
 * The events written after `marker`, each with its deliveries' subscription
 * ids: polled until `count` have landed (two seconds at most), then given time
 * for an unexpected extra one to land too.
 */
async function eventsAfter(marker, count) {
  const deadline = Date.now() + 2000;
  let rows;
  for (;;) {
    rows = await c2_query('SELECT id, event_uuid, type, workspace_id, body FROM webhook_events WHERE id > ? ORDER BY id', [
      marker,
    ]);
    if (rows.length >= count || Date.now() > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await settle();
  rows = await c2_query('SELECT id, event_uuid, type, workspace_id, body FROM webhook_events WHERE id > ? ORDER BY id', [
    marker,
  ]);
  for (const row of rows) {
    const deliveries = await c2_query(
      'SELECT subscription_id, status, attempts FROM webhook_deliveries WHERE event_id = ? ORDER BY subscription_id',
      [row.id]
    );
    row.deliveries = deliveries;
    row.envelope = JSON.parse(row.body.toString('utf8'));
  }
  return rows;
}

/** Sends `method url body` as the actor and expects `status`. */
async function as(method, url, body, status = 200) {
  const res = await request(app)[method](url).set('Authorization', `Bearer ${token}`).send(body);
  expect(res.status, `${method.toUpperCase()} ${url}: ${JSON.stringify(res.body)}`).toBe(status);
  return res;
}

beforeAll(async () => {
  actorId = await insertUser('hookactor');
  watcherId = await insertUser('hookwatcher');
  const adminId = await insertUser('hookadmin', true);
  token = await generateSessionToken({ id: actorId });
  adminToken = await generateSessionToken({ id: adminId });

  ({ workspace: workspaceId, squad: squadId } = await insertWorkspace('Hooks'));
  ({ workspace: otherWorkspaceId } = await insertWorkspace('Other hooks'));
  archiveId = await insertArchive(squadId, 'Hooks archive');
  const otherSquad = (await c2_query('SELECT id FROM squads WHERE workspace_id = ?', [otherWorkspaceId]))[0].id;
  otherArchiveId = await insertArchive(otherSquad, 'Other archive');

  const created = await request(app)
    .post('/api/admin/webhooks')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ url: RECEIVER });
  expect(created.status).toBe(201);
  subscriptionId = created.body.webhook.id;
});

describe('the admin API, on a real server', () => {
  it('stored the secret it returned once, and lists only a fingerprint of it', async () => {
    const [row] = await c2_query('SELECT secret, source, url FROM webhook_subscriptions WHERE id = ?', [subscriptionId]);
    expect(row).toMatchObject({ source: 'admin', url: RECEIVER });
    expect(row.secret).toMatch(/^[0-9a-f]{64}$/);

    const listed = await request(app).get('/api/admin/webhooks').set('Authorization', `Bearer ${adminToken}`);
    expect(listed.status).toBe(200);
    expect(JSON.stringify(listed.body)).not.toContain(row.secret);
    expect(listed.body.webhooks).toEqual([expect.objectContaining({ id: subscriptionId, managed: false, enabled: true })]);
  });

  it('refuses the actor, who is not an admin', async () => {
    const res = await request(app).get('/api/admin/webhooks').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe('emitting, on a real server', () => {
  it('writes exactly one event and one delivery for each of the eight actions', async () => {
    const parent = await insertLog(archiveId, 'Parent');
    const doc = await insertLog(archiveId, 'Doc');
    const doomedArchive = await insertArchive(squadId, 'Doomed');

    const steps = [
      ['log.rename', () => as('put', `/api/document/${doc}/title`, { title: 'Renamed doc' }),
        { log_id: doc, archive_id: archiveId, title: 'Renamed doc' }],
      ['log.update', () => as('post', '/api/save-document', { doc_id: doc, html_content: '<p>edited</p>' }),
        { log_id: doc, archive_id: archiveId, title: 'Renamed doc' }],
      // The publish body's title names the version, not the document, so the
      // event carries the document's own title.
      ['log.publish', () => as('post', `/api/document/${doc}/publish`, { title: 'First cut' }),
        { log_id: doc, archive_id: archiveId, title: 'Renamed doc', version: 1 }],
      ['log.restore', async () => {
        const [version] = await c2_query('SELECT id FROM versions WHERE log_id = ? ORDER BY id LIMIT 1', [doc]);
        return as('post', `/api/document/${doc}/versions/${version.id}/restore`, {});
      }, { log_id: doc, archive_id: archiveId, title: 'Renamed doc', version: 2 }],
      ['log.move', () => as('put', `/api/archives/${archiveId}/logs/${doc}`, { parent_id: parent }),
        { log_id: doc, archive_id: archiveId, parent_id: parent, previous_parent_id: null }],
      ['log.delete', () => as('delete', `/api/archives/${archiveId}/logs/${doc}`),
        { log_id: doc, archive_id: archiveId }],
      ['archive.rename', () => as('put', `/api/archives/${doomedArchive}`, { name: 'Doomed, renamed' }),
        { archive_id: doomedArchive, name: 'Doomed, renamed' }],
      ['archive.delete', () => as('delete', `/api/archives/${doomedArchive}`),
        { archive_id: doomedArchive }],
    ];

    for (const [type, act, data] of steps) {
      const marker = await lastEventId();
      await act();
      const events = await eventsAfter(marker, 1);
      expect(events.map((e) => e.type), type).toEqual([type]);
      const [event] = events;
      expect(event.deliveries, type).toEqual([{ subscription_id: subscriptionId, status: 'pending', attempts: 0 }]);
      expect(event.workspace_id, type).toBe(workspaceId);
      expect(event.envelope, type).toMatchObject({
        schema: ENVELOPE_SCHEMA,
        id: event.event_uuid,
        sequence: event.id,
        type,
        workspace_id: workspaceId,
        actor: { id: actorId, name: 'hookactor' },
        data,
      });
      expect(Object.keys(event.envelope.data).sort(), type).toEqual(Object.keys(data).sort());
    }
  });

  it('writes nothing for a log.update coalesced into the previous one', async () => {
    const doc = await insertLog(archiveId, 'Saved twice');
    const marker = await lastEventId();
    await as('post', '/api/save-document', { doc_id: doc, html_content: '<p>one</p>' });
    expect((await eventsAfter(marker, 1)).map((e) => e.type)).toEqual(['log.update']);

    const second = await lastEventId();
    await as('post', '/api/save-document', { doc_id: doc, html_content: '<p>two</p>' });
    expect(await eventsAfter(second, 1)).toEqual([]);
  });

  it('writes nothing for an action outside the allowlist', async () => {
    const doc = await insertLog(archiveId, 'Commented');
    const marker = await lastEventId();
    await as('post', `/api/logs/${doc}/comments`, { content: 'A note' }, 201);
    expect(await eventsAfter(marker, 1)).toEqual([]);
    // It was recorded, so emitEvent saw it and chose to write nothing.
    const recorded = await c2_query(`SELECT id FROM activity_log WHERE action = 'comment.create' AND user_id = ?`, [actorId]);
    expect(recorded).toHaveLength(1);
  });

  it('keeps the stored body byte-stable, and it is the envelope the row describes', async () => {
    const doc = await insertLog(archiveId, 'Stable');
    const marker = await lastEventId();
    await as('put', `/api/document/${doc}/title`, { title: 'Café ☕ \u{1F680}' });
    const [event] = await eventsAfter(marker, 1);

    const [first] = await c2_query('SELECT body FROM webhook_events WHERE id = ?', [event.id]);
    const [again] = await c2_query('SELECT body FROM webhook_events WHERE id = ?', [event.id]);
    expect(Buffer.compare(first.body, again.body)).toBe(0);
    expect(first.body.toString('utf8')).toBe(JSON.stringify(event.envelope));
    expect(event.envelope.data.title).toBe('Café ☕ \u{1F680}');

    const [stamp] = await c2_query(
      `SELECT CONCAT(DATE_FORMAT(occurred_at, '%Y-%m-%dT%H:%i:%s.'), LPAD(FLOOR(MICROSECOND(occurred_at) / 1000), 3, '0'), 'Z') AS iso
         FROM webhook_events WHERE id = ?`,
      [event.id]
    );
    expect(stamp.iso).toBe(event.envelope.occurred_at);
  });

  it('emits a stored title longer than any route allows as its first 255 code points', async () => {
    // logs.title is TEXT and not every writer caps it; publish without a title
    // falls back to the stored one.
    const doc = await insertLog(archiveId, 'é'.repeat(30_000));
    const marker = await lastEventId();
    await as('post', `/api/document/${doc}/publish`, {});
    const [event] = await eventsAfter(marker, 1);
    expect(event.envelope.data.title).toBe('é'.repeat(255));
    expect(event.body.length).toBeLessThan(4096);
  });

  it('narrows by workspace: a subscription for another workspace gets no delivery', async () => {
    const created = await request(app)
      .post('/api/admin/webhooks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ url: RECEIVER, workspace_id: otherWorkspaceId });
    expect(created.status).toBe(201);
    const narrow = created.body.webhook.id;

    const here = await insertLog(archiveId, 'Here');
    let marker = await lastEventId();
    await as('put', `/api/document/${here}/title`, { title: 'Here, renamed' });
    let [event] = await eventsAfter(marker, 1);
    expect(event.deliveries.map((d) => d.subscription_id)).toEqual([subscriptionId]);

    const there = await insertLog(otherArchiveId, 'There');
    marker = await lastEventId();
    await as('put', `/api/document/${there}/title`, { title: 'There, renamed' });
    [event] = await eventsAfter(marker, 1);
    expect(event.workspace_id).toBe(otherWorkspaceId);
    expect(event.deliveries.map((d) => d.subscription_id)).toEqual([subscriptionId, narrow]);

    const deleted = await request(app).delete(`/api/admin/webhooks/${narrow}`).set('Authorization', `Bearer ${adminToken}`);
    expect(deleted.status).toBe(200);
  });

  it('leaves the activity row, the watcher\'s notification and the response alone when the outbox insert fails', async () => {
    const doc = await insertLog(archiveId, 'Watched');
    await c2_query(`INSERT INTO watches (user_id, resource_type, resource_id, source) VALUES (?, 'log', ?, 'manual')`, [
      watcherId,
      doc,
    ]);
    // A trigger makes every outbox insert fail, as a full disk or a lost
    // table would. It is DDL, so it goes through an admin connection.
    const conn = await openAdminConnection();
    const errorSpy = vi.spyOn(console, 'error');
    try {
      await conn.changeUser({ database: process.env.DB_NAME });
      await conn.query(
        `CREATE TRIGGER it_outbox_fails BEFORE INSERT ON webhook_events FOR EACH ROW
         SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forced outbox failure'`
      );
      const marker = await lastEventId();

      const res = await request(app)
        .post('/api/save-document')
        .set('Authorization', `Bearer ${token}`)
        .send({ doc_id: doc, html_content: '<p>watched edit</p>' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });

      expect(await eventsAfter(marker, 1)).toEqual([]);
      const activity = await c2_query(
        `SELECT id FROM activity_log WHERE action = 'log.update' AND resource_type = 'log' AND resource_id = ?`,
        [doc]
      );
      expect(activity).toHaveLength(1);
      const notified = await c2_query(
        `SELECT type FROM notifications WHERE user_id = ? AND resource_id = ?`,
        [watcherId, doc]
      );
      expect(notified).toEqual([{ type: 'watched_log_update' }]);
      expect(errorSpy.mock.calls.flat().map(String).join(' ')).toMatch(/forced outbox failure/);
    } finally {
      errorSpy.mockRestore();
      await conn.query(`DROP TRIGGER IF EXISTS ${mysql.escapeId('it_outbox_fails')}`);
      await conn.end();
    }
  });

  it('writes no row at all once no subscription remains', async () => {
    const deleted = await request(app).delete(`/api/admin/webhooks/${subscriptionId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(deleted.status).toBe(200);
    expect(await c2_query('SELECT id FROM webhook_subscriptions', [])).toEqual([]);

    const doc = await insertLog(archiveId, 'Nobody listens');
    const marker = await lastEventId();
    const deliveriesBefore = (await c2_query('SELECT COUNT(*) AS n FROM webhook_deliveries', []))[0].n;
    await as('put', `/api/document/${doc}/title`, { title: 'Nobody listens, renamed' });
    await as('post', '/api/save-document', { doc_id: doc, html_content: '<p>quiet</p>' });

    expect(await eventsAfter(marker, 1)).toEqual([]);
    expect((await c2_query('SELECT COUNT(*) AS n FROM webhook_deliveries', []))[0].n).toBe(deliveriesBefore);
    expect(await c2_query(`SELECT id FROM activity_log WHERE resource_id = ? AND action = 'log.rename'`, [doc])).toHaveLength(1);
  });
});

afterAll(async () => {
  // Leave the module cache empty for whatever runs next in this worker.
  const { loadSubscriptions } = await import('../../services/webhooks.js');
  await loadSubscriptions();
});
