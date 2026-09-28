/**
 * The reconciliation read, GET /api/documents/state, against a live MySQL server
 *
 * The route tests prove which SQL the route issues and in what order it binds;
 * only a real server proves what that SQL returns. Two workspaces, a machine
 * principal that belongs to a squad in the first only, and a spread of
 * archives it can and cannot read: the answer holds exactly the documents the
 * principal could open in the workspace it asked about, and an id it cannot
 * read answers byte for byte like an id that does not exist, so the route is
 * never an oracle.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { c2_query, generateSessionToken } from '../../mysql_connect.js';

const SERVICE_TOKEN = 'reconciliation-service-token-0123456789abcdef';
const SERVICE_EMAIL = 'svc-state@example.com';

/** Everything the tests below name, by role. */
const ids = {};

async function insertUser(name, { admin = false } = {}) {
  const res = await c2_query('INSERT INTO users (name, email, is_admin) VALUES (?, ?, ?)', [
    name,
    `${name}@example.com`,
    admin,
  ]);
  return res.insertId;
}

async function insertArchive(squadId, name, extra = {}) {
  const res = await c2_query(
    `INSERT INTO archives (squad_id, name, created_by, read_access, read_access_workspace, \`system\`)
     VALUES (?, ?, NULL, ?, ?, ?)`,
    [squadId, name, JSON.stringify(extra.readAccess ?? []), extra.workspaceWide ?? false, extra.system ?? false]
  );
  return res.insertId;
}

async function insertLog(archiveId, title) {
  const res = await c2_query('INSERT INTO logs (archive_id, title, html_content) VALUES (?, ?, ?)', [
    archiveId,
    title,
    '<p>body</p>',
  ]);
  return res.insertId;
}

/** The route, as the machine principal unless another bearer is named. */
function state(workspaceId, logIds, bearer = SERVICE_TOKEN) {
  return request(app)
    .get(`/api/documents/state?workspaceId=${workspaceId}&ids=${logIds.join(',')}`)
    .set('Authorization', `Bearer ${bearer}`);
}

/** The ids of the documents an answer carries, sorted. */
const answered = (res) => res.body.documents.map((d) => d.id).sort((a, b) => a - b);

beforeAll(async () => {
  process.env.SERVICE_TOKEN = SERVICE_TOKEN;
  process.env.SERVICE_TOKEN_USER = SERVICE_EMAIL;

  const svc = await c2_query('INSERT INTO users (name, email, is_admin) VALUES (?, ?, FALSE)', [
    'svc-state',
    SERVICE_EMAIL,
  ]);
  ids.svc = svc.insertId;
  ids.admin = await insertUser('state-admin', { admin: true });
  ids.member = await insertUser('state-member');

  // No owner on either workspace and no creator on any archive, so the only
  // ways in are the ones each archive grants explicitly (or being an admin).
  ids.w1 = (await c2_query('INSERT INTO workspaces (name) VALUES (?)', ['State One'])).insertId;
  ids.w2 = (await c2_query('INSERT INTO workspaces (name) VALUES (?)', ['State Two'])).insertId;

  const squad = async (workspaceId, name) =>
    (await c2_query('INSERT INTO squads (workspace_id, name) VALUES (?, ?)', [workspaceId, name])).insertId;
  ids.s1 = await squad(ids.w1, 'Readers');
  ids.s1Private = await squad(ids.w1, 'Private');
  ids.s2 = await squad(ids.w2, 'Elsewhere');

  // The principal reads through squad membership in W1 only; the human member
  // sits in the same squad.
  for (const userId of [ids.svc, ids.member]) {
    await c2_query('INSERT INTO squad_members (squad_id, user_id, role, can_read) VALUES (?, ?, ?, TRUE)', [
      ids.s1,
      userId,
      'member',
    ]);
  }

  const a1 = await insertArchive(ids.s1, 'Readable');
  const a1Private = await insertArchive(ids.s1Private, 'Admins only');
  const a1System = await insertArchive(ids.s1, 'PR session', { readAccess: [ids.svc], system: true });
  const a2 = await insertArchive(ids.s2, 'Not ours');
  // Readable by the principal through a per-user grant, but in the second workspace.
  const a2Granted = await insertArchive(ids.s2, 'Granted', { readAccess: [ids.svc] });
  ids.a1 = a1;

  ids.readable = [await insertLog(a1, 'Runbook'), await insertLog(a1, 'Release checklist')];
  ids.adminOnly = await insertLog(a1Private, 'Board minutes');
  ids.system = await insertLog(a1System, 'PR #12');
  ids.otherWorkspace = await insertLog(a2, 'Their roadmap');
  ids.granted = await insertLog(a2Granted, 'Shared plan');

  // 254 plain characters, then an astral one at code point 255, then more: the
  // bound keeps the emoji whole and drops everything after it.
  ids.longTitlePrefix = `${'t'.repeat(254)}\u{1F680}`;
  ids.longTitle = await insertLog(a1, `${ids.longTitlePrefix}${'x'.repeat(45)}`);

  ids.deleted = await insertLog(a1, 'Gone');
  await c2_query('DELETE FROM logs WHERE id = ?', [ids.deleted]);
});

afterAll(() => {
  delete process.env.SERVICE_TOKEN;
  delete process.env.SERVICE_TOKEN_USER;
});

describe('GET /api/documents/state, on a real server', () => {
  it('answers the first workspace with exactly the documents the principal can read there', async () => {
    const res = await state(ids.w1, [
      ...ids.readable,
      ids.adminOnly,
      ids.system,
      ids.otherWorkspace,
      ids.granted,
      ids.deleted,
    ]);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Not the admin-only archive (is_admin is forced false), not the system
    // archive, not the granted document (another workspace), not the deleted id.
    expect(answered(res)).toEqual([...ids.readable].sort((a, b) => a - b));

    const [runbook] = res.body.documents.filter((d) => d.id === ids.readable[0]);
    expect(Object.keys(runbook).sort()).toEqual(['archive_id', 'id', 'title', 'updated_at']);
    expect(runbook).toMatchObject({ title: 'Runbook', archive_id: ids.a1 });
    expect(Number.isNaN(Date.parse(runbook.updated_at))).toBe(false);
  });

  it('answers the second workspace with nothing from the first, and nothing the principal cannot read', async () => {
    const res = await state(ids.w2, [...ids.readable, ids.adminOnly, ids.otherWorkspace]);

    expect(res.status).toBe(200);
    expect(res.body.documents).toEqual([]);
  });

  it('narrows by workspace, not only by access: a readable document appears only under its own', async () => {
    const own = await state(ids.w2, [ids.granted]);
    expect(answered(own)).toEqual([ids.granted]);

    const other = await state(ids.w1, [ids.granted]);
    expect(other.body.documents).toEqual([]);
  });

  it('is not vacuous: an admin session does see the admin-only document', async () => {
    const token = await generateSessionToken({ id: ids.admin });

    const res = await state(ids.w1, [ids.adminOnly], token);

    expect(res.status).toBe(200);
    expect(answered(res)).toEqual([ids.adminOnly]);
  });

  it('gives a deleted id and an unreadable id byte-identical answers', async () => {
    const deleted = await state(ids.w1, [ids.deleted]);
    const unreadable = await state(ids.w1, [ids.adminOnly]);

    expect(deleted.status).toBe(200);
    expect(unreadable.status).toBe(deleted.status);
    expect(unreadable.text).toBe(deleted.text);
    expect(unreadable.headers['content-length']).toBe(deleted.headers['content-length']);
    expect(unreadable.headers.etag).toBe(deleted.headers.etag);
  });

  it('bounds a title to 255 code points, the event envelope\'s bound, without splitting a surrogate pair', async () => {
    const res = await state(ids.w1, [ids.longTitle]);

    const [doc] = res.body.documents;
    expect(Array.from(doc.title)).toHaveLength(255);
    expect(doc.title).toBe(ids.longTitlePrefix);
  });

  it('answers an id past the INT range like any other absent id, not with a 500', async () => {
    const res = await state(ids.w1, [ids.readable[0], 99999999999, 2147483648]);

    expect(res.status).toBe(200);
    expect(answered(res)).toEqual([ids.readable[0]]);
  });

  it('orders the answer by id, whatever order the ids were asked in', async () => {
    // The promise in docs/api is ascending id, across two archives here.
    // Deliberately not through answered(), which sorts. On this data MySQL
    // happens to return id order even without the clause, so a dropped ORDER BY
    // is caught by the SQL-shape pin in tests/routes/documents.test.js; this
    // catches a changed one (another column, or DESC) on a real server.
    const token = await generateSessionToken({ id: ids.admin });
    const asked = [...ids.readable, ids.adminOnly, ids.longTitle].sort((a, b) => b - a);

    const res = await state(ids.w1, asked, token);

    expect(res.status).toBe(200);
    expect(res.body.documents.map((d) => d.id)).toEqual([...asked].reverse());
  });

  it('answers a human session with what that person can read', async () => {
    const token = await generateSessionToken({ id: ids.member });

    const res = await state(ids.w1, [...ids.readable, ids.adminOnly, ids.system], token);

    expect(res.status).toBe(200);
    expect(answered(res)).toEqual([...ids.readable].sort((a, b) => a - b));
  });
});
