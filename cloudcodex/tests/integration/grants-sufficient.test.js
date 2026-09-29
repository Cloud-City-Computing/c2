/**
 * The app runs on the recipe's DML-only account: boot, the smoke path, a live edit and a stop
 *
 * tenancy.test.js proves the recipe's app account can reach nothing outside
 * its schema. This file proves it is still enough: an instance built by the
 * recipe (init.sql and adoption as the migration account) runs server.js as
 * the app account, in production mode, through boot (the instance lock, the
 * admin sync, the first-run seed, the activity prune), a signed-in path that
 * creates a workspace, squad, archive and document, saves, renames (a
 * transaction with SELECT ... FOR UPDATE), comments, publishes, searches,
 * deletes a comment and a document, one collaborative edit over a real
 * socket, a sign-out, and a SIGTERM that flushes the edit.
 * Every answer must succeed and the server must log no privilege error.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import mysql from 'mysql2/promise';
import { INSTANCE_LOCK_NAME_SQL } from '../../services/instance-lock.js';
import { openAdminConnection } from './mysql-admin.js';
import { buildFresh, newInstance, provision, unprovision } from './instance-recipe.js';
import { freePort, kill, killChildren, openCollab, signIn, startServer } from './server-child.js';

const ADMIN = { username: 'dmladmin', password: 'Dml-Only-Passw0rd!', email: 'dmladmin@example.com' };
const MARKER = 'written by the DML-only account';

/** What MySQL says when an account lacks a privilege, in any of its forms. */
const PRIVILEGE_ERROR = /ER_(TABLE|DB|SPECIFIC_|PROC|COLUMN|)ACCESS_DENIED|ER_KILL_DENIED|command denied|Access denied/;

const instance = newInstance();
let admin;

beforeAll(async () => {
  admin = await openAdminConnection();
  await provision(admin, instance);
  await buildFresh(instance);
}, 60_000);

afterAll(async () => {
  await unprovision(admin, instance);
  await admin.end();
});

afterEach(killChildren);

/** A JSON request as the signed-in admin; resolves `{ status, body }`. */
async function api(port, token, method, url, body) {
  const res = await fetch(`http://127.0.0.1:${port}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}

/** A read as the admin account, on the instance's schema. */
async function adminRead(sql, params) {
  const [rows] = await admin.query(sql.replaceAll('{S}', mysql.escapeId(instance.schema)), params);
  return rows;
}

describe('the app on the DML-only account', () => {
  it('boots, serves the smoke path, saves a live edit and stops cleanly, with no privilege error', { timeout: 120_000 }, async () => {
    const port = await freePort();
    const server = await startServer(port, ADMIN, {
      DB_USER: instance.app.user,
      DB_PASS: instance.app.password,
      DB_NAME: instance.schema,
    });

    // The instance lock is held, and by the app account.
    await admin.changeUser({ database: instance.schema });
    const [[{ holder }]] = await admin.query(`SELECT IS_USED_LOCK(${INSTANCE_LOCK_NAME_SQL}) AS holder`);
    expect(holder).toEqual(expect.any(Number));
    const [[{ USER: lockUser }]] = await admin.query('SELECT USER FROM performance_schema.processlist WHERE ID = ?', [holder]);
    expect(lockUser).toBe(instance.app.user);

    const token = await signIn(port, ADMIN);
    const ok = (res, status = 200) => {
      expect(res.status, JSON.stringify(res.body)).toBe(status);
      return res.body;
    };

    const { workspaceId } = ok(await api(port, token, 'POST', '/api/workspaces', { name: 'DML workspace' }), 201);
    const { squadId } = ok(await api(port, token, 'POST', `/api/workspaces/${workspaceId}/squads`, { name: 'DML squad' }), 201);
    const { archiveId } = ok(await api(port, token, 'POST', '/api/archives', { name: 'DML archive', squad_id: squadId }), 201);
    const { logId } = ok(await api(port, token, 'POST', `/api/archives/${archiveId}/logs`, { title: 'DML document' }), 201);
    ok(await api(port, token, 'POST', '/api/save-document', { doc_id: logId, html_content: '<p>saved by the app account</p>' }));
    ok(await api(port, token, 'PUT', `/api/archives/${archiveId}/logs/${logId}`, { title: 'DML document, renamed' }));
    ok(await api(port, token, 'POST', `/api/logs/${logId}/comments`, { content: 'a comment on it' }), 201);
    ok(await api(port, token, 'POST', `/api/document/${logId}/publish`, { notes: 'first' }));
    const found = ok(await api(port, token, 'GET', '/api/search?query=saved'));
    expect(JSON.stringify(found)).toContain('DML document, renamed');
    // And the deletes: a second comment, a second document.
    const { comment } = ok(await api(port, token, 'POST', `/api/logs/${logId}/comments`, { content: 'a second, removed' }), 201);
    ok(await api(port, token, 'DELETE', `/api/comments/${comment.id}`));
    const { logId: scratchId } = ok(await api(port, token, 'POST', `/api/archives/${archiveId}/logs`, { title: 'DML scratch' }), 201);
    ok(await api(port, token, 'DELETE', `/api/archives/${archiveId}/logs/${scratchId}`));

    const editor = new Y.Doc();
    const ws = await openCollab(port, logId, token, editor);
    editor.getText('body').insert(0, MARKER);
    const encoder = encoding.createEncoder();
    syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(editor));
    ws.send(encoding.toUint8Array(encoder));
    await new Promise((resolve) => setTimeout(resolve, 200));
    ok(await api(port, token, 'POST', '/api/logout'));

    const stopped = await kill(server, 'SIGTERM');

    expect(stopped.code, stopped.stderr).toBe(0);
    expect(stopped.stderr).toMatch(/stopped cleanly on SIGTERM/);
    // Fire-and-forget writes (activity, watches, notifications) log their
    // failures rather than fail the request, so the log is where a missing
    // privilege would show.
    expect(`${stopped.stdout}\n${stopped.stderr}`).not.toMatch(PRIVILEGE_ERROR);

    const [row] = await adminRead('SELECT title, ydoc_state FROM {S}.logs WHERE id = ?', [logId]);
    expect(row.title).toBe('DML document, renamed');
    const saved = new Y.Doc();
    Y.applyUpdate(saved, new Uint8Array(row.ydoc_state));
    expect(saved.getText('body').toString()).toBe(MARKER);
    const [{ comments }] = await adminRead('SELECT COUNT(*) AS comments FROM {S}.comments WHERE log_id = ?', [logId]);
    expect(comments).toBe(1);
    expect(await adminRead('SELECT id FROM {S}.logs WHERE id = ?', [scratchId])).toEqual([]);
    const [{ sessions }] = await adminRead('SELECT COUNT(*) AS sessions FROM {S}.sessions');
    expect(sessions).toBe(0);
    const [{ versions }] = await adminRead('SELECT COUNT(*) AS versions FROM {S}.versions WHERE log_id = ?', [logId]);
    expect(versions).toBe(1);
    const actions = (await adminRead('SELECT DISTINCT action FROM {S}.activity_log')).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['archive.create', 'log.create']));
  });
});
