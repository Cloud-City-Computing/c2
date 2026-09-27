/**
 * The three activity gaps W6-CDX-12 closed, proved against a live MySQL server
 *
 * The route tests prove which rows the routes ask for. Only a real server
 * proves the row lands: activity_log.workspace_id is NOT NULL, and an archive
 * delete has to read its scope before the row that leads to it is gone.
 * logActivity is fire-and-forget, so each assertion polls the table.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { c2_query, generateSessionToken } from '../../mysql_connect.js';

let userId;
let watcherId;
let token;
let workspaceId;
let squadId;
let archiveId;
let parentLogId;
let childLogId;

/**
 * Poll for the activity rows matching `action` on one resource, for up to two
 * seconds, and return them (possibly none).
 * @param { String } action
 * @param { String } resourceType
 * @param { Number } resourceId
 */
async function activityRows(action, resourceType, resourceId) {
  const deadline = Date.now() + 2000;
  for (;;) {
    const rows = await c2_query(
      `SELECT workspace_id, squad_id, user_id, action, resource_type, resource_id, metadata
         FROM activity_log WHERE action = ? AND resource_type = ? AND resource_id = ?`,
      [action, resourceType, resourceId]
    );
    if (rows.length > 0 || Date.now() > deadline) return rows;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Long enough for the rest of a fire-and-forget logActivity to land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

/** A user row, returned as its id. */
async function insertUser(name) {
  const created = await c2_query('INSERT INTO users (name, email, password_hash) VALUES (?, ?, NULL)', [
    name,
    `${name}@example.com`,
  ]);
  return created.insertId;
}

/** An archive in the seeded squad, created by the seeded user. */
async function insertArchive(name) {
  const created = await c2_query('INSERT INTO archives (squad_id, name, created_by) VALUES (?, ?, ?)', [
    squadId,
    name,
    userId,
  ]);
  return created.insertId;
}

/** A document in `archive`. */
async function insertLog(archive, title) {
  const created = await c2_query(
    `INSERT INTO logs (archive_id, title, html_content, created_by, updated_by) VALUES (?, ?, '', ?, ?)`,
    [archive, title, userId, userId]
  );
  return created.insertId;
}

beforeAll(async () => {
  userId = await insertUser('gapsactor');
  watcherId = await insertUser('gapswatcher');
  token = await generateSessionToken({ id: userId });
  workspaceId = (await c2_query('INSERT INTO workspaces (name, owner_id) VALUES (?, ?)', ['Gaps', userId])).insertId;
  squadId = (await c2_query('INSERT INTO squads (workspace_id, name, created_by) VALUES (?, ?, ?)', [
    workspaceId,
    'Gaps squad',
    userId,
  ])).insertId;
  archiveId = await insertArchive('Gaps archive');
  parentLogId = await insertLog(archiveId, 'Parent');
  childLogId = await insertLog(archiveId, 'Child');
  // Someone else watches the document, so a rename that notified watchers
  // would leave a notifications row for them.
  await c2_query(`INSERT INTO watches (user_id, resource_type, resource_id, source) VALUES (?, 'log', ?, 'manual')`, [
    watcherId,
    childLogId,
  ]);
});

describe('the tree route, on a real server', () => {
  it('records log.rename with the workspace and squad, and notifies and enrols nobody', async () => {
    const res = await request(app)
      .put(`/api/archives/${archiveId}/logs/${childLogId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: '  Renamed child  ' });
    expect(res.status).toBe(200);

    const rows = await activityRows('log.rename', 'log', childLogId);
    expect(rows).toEqual([
      {
        workspace_id: workspaceId,
        squad_id: squadId,
        user_id: userId,
        action: 'log.rename',
        resource_type: 'log',
        resource_id: childLogId,
        metadata: { title: 'Renamed child' },
      },
    ]);
    const [stored] = await c2_query('SELECT title FROM logs WHERE id = ?', [childLogId]);
    expect(stored.title).toBe('Renamed child');
    // Auto-watch and fan-out run after the insert this just saw, so give them
    // time to land before asserting that they did nothing.
    await settle();
    expect(await c2_query('SELECT id FROM notifications WHERE user_id = ?', [watcherId])).toEqual([]);
    expect(await c2_query('SELECT id FROM watches WHERE user_id = ?', [userId])).toEqual([]);
  });

  it('records log.move with the previous and new parent', async () => {
    const res = await request(app)
      .put(`/api/archives/${archiveId}/logs/${childLogId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ parent_id: parentLogId });
    expect(res.status).toBe(200);

    const rows = await activityRows('log.move', 'log', childLogId);
    expect(rows).toEqual([
      {
        workspace_id: workspaceId,
        squad_id: squadId,
        user_id: userId,
        action: 'log.move',
        resource_type: 'log',
        resource_id: childLogId,
        metadata: { parent_id: parentLogId, previous_parent_id: null },
      },
    ]);
  });

  it('records nothing for a re-save of the title and parent already stored', async () => {
    // A real server returns parent_id as a number; a string would make every
    // re-save look like a move.
    const res = await request(app)
      .put(`/api/archives/${archiveId}/logs/${childLogId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Renamed child', parent_id: parentLogId });
    expect(res.status).toBe(200);

    await settle();
    expect(await activityRows('log.rename', 'log', childLogId)).toHaveLength(1);
    expect(await activityRows('log.move', 'log', childLogId)).toHaveLength(1);
  });

  it('refuses a parent that would make a cycle, or that lives in another archive', async () => {
    // childLogId sits under parentLogId now, so moving the parent under the
    // child would make each the other's ancestor.
    const underChild = await request(app)
      .put(`/api/archives/${archiveId}/logs/${parentLogId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ parent_id: childLogId });
    expect(underChild.status).toBe(400);

    const elsewhere = await insertLog(await insertArchive('Elsewhere'), 'Foreign parent');
    const foreign = await request(app)
      .put(`/api/archives/${archiveId}/logs/${parentLogId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ parent_id: elsewhere });
    expect(foreign.status).toBe(400);

    const [stored] = await c2_query('SELECT parent_id FROM logs WHERE id = ?', [parentLogId]);
    expect(stored.parent_id).toBeNull();
    await settle();
    expect(await activityRows('log.move', 'log', parentLogId)).toEqual([]);
  });

  it('refuses a 256-character title and leaves the stored one alone', async () => {
    const res = await request(app)
      .put(`/api/archives/${archiveId}/logs/${parentLogId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'x'.repeat(256) });
    expect(res.status).toBe(400);

    const [stored] = await c2_query('SELECT title FROM logs WHERE id = ?', [parentLogId]);
    expect(stored.title).toBe('Parent');
  });
});

describe('an archive delete, on a real server', () => {
  it('records archive.delete with the scope it had before the row was deleted', async () => {
    const doomed = await insertArchive('Doomed archive');
    await insertLog(doomed, 'Goes with it');

    const res = await request(app).delete(`/api/archives/${doomed}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    expect(await c2_query('SELECT id FROM archives WHERE id = ?', [doomed])).toEqual([]);
    const rows = await activityRows('archive.delete', 'archive', doomed);
    expect(rows).toEqual([
      {
        workspace_id: workspaceId,
        squad_id: squadId,
        user_id: userId,
        action: 'archive.delete',
        resource_type: 'archive',
        resource_id: doomed,
        metadata: null,
      },
    ]);
  });
});
