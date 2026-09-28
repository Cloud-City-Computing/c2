/**
 * The instance lifecycle against a live MySQL server: one writer per schema, and a clean stop
 *
 * The single-writer lock is a GET_LOCK held on a connection for the life of
 * the process, so only real processes against a real server can prove what
 * it promises: a second process on the same schema refuses and names the
 * holder, a killed holder frees the lock at once, and two schemas on one
 * server never contend. The last test boots server.js itself, edits a
 * document over /collab, stops it with SIGTERM inside the three-second save
 * debounce, and finds the edit in ydoc_state and in a restarted server.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import mysql from 'mysql2/promise';
import { c2_query, openConnection } from '../../mysql_connect.js';
import { INSTANCE_LOCK_NAME_SQL } from '../../services/instance-lock.js';
import { SCHEMA_PREFIX, dropSchema, openAdminConnection, throwawaySchemaName } from './mysql-admin.js';
import { children, freePort, holdLock, kill, killChildren, signIn, startServer } from './app-process.js';

afterEach(killChildren);

describe('the single-writer lock, across processes', () => {
  it('a second process on the same schema exits non-zero and names the holder', async () => {
    const first = holdLock();
    const holding = await first.outcome;
    expect(holding.held).toBe(true);

    const second = await holdLock().outcome;

    expect(second.held).toBe(false);
    expect(second.code).toBe(1);
    expect(second.stderr).toContain(`MySQL connection ${holding.connectionId}`);
    expect(second.stderr).toContain('C2_INSTANCE_LOCK=0');
  });

  it('after the holder is killed with SIGKILL, the next process takes the lock within two seconds', async () => {
    const first = holdLock();
    expect((await first.outcome).held).toBe(true);
    // Non-vacuity: while it lives, nobody else gets in.
    expect((await holdLock().outcome).held).toBe(false);

    const killedAt = Date.now();
    await kill(first, 'SIGKILL');
    const third = await holdLock().outcome;

    expect(third.held).toBe(true);
    expect(Date.now() - killedAt).toBeLessThan(2000);
  });

  it('two schemas on one server each hold their own lock at the same time', async () => {
    const admin = await openAdminConnection();
    const other = throwawaySchemaName();
    try {
      await admin.query(`CREATE DATABASE ${mysql.escapeId(other)}`);

      const here = await holdLock().outcome;
      const there = await holdLock(other).outcome;

      expect(here.held).toBe(true);
      expect(there.held).toBe(true);
      expect(there.connectionId).not.toBe(here.connectionId);
    } finally {
      for (const child of children) child.kill('SIGKILL');
      await dropSchema(admin, other);
      await admin.end();
    }
  });

  it('a schema name as long as MySQL allows still gets a lock of its own', async () => {
    const admin = await openAdminConnection();
    // 64 characters, MySQL's limit for a schema name and for a lock name alike,
    // so the lock cannot simply be the prefix and the schema.
    const long = `${SCHEMA_PREFIX}${'l'.repeat(64 - SCHEMA_PREFIX.length - 12)}${randomHex(12)}`;
    expect(long).toHaveLength(64);
    try {
      await admin.query(`CREATE DATABASE ${mysql.escapeId(long)}`);

      const holding = await holdLock(long).outcome;
      expect(holding.held, holding.stderr).toBe(true);
      // And it is exclusive there too.
      const second = await holdLock(long).outcome;
      expect(second.held).toBe(false);
      expect(second.stderr).toContain(`MySQL connection ${holding.connectionId}`);
    } finally {
      for (const child of children) child.kill('SIGKILL');
      await dropSchema(admin, long);
      await admin.end();
    }
  });
});

// ── the edit survives a stop ────────────────────────────────

const MARKER = 'typed two hundred milliseconds before SIGTERM';

/** `n` random lowercase hex characters. */
function randomHex(n) {
  return Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

/**
 * Open /collab for `logId`, authenticate, and resolve once the server has
 * sent both its sync steps and the JSON `sync` frame. `doc` receives the
 * server's state.
 */
async function openCollab(port, logId, token, doc) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/collab?logId=${logId}`, {
    headers: { Origin: `http://127.0.0.1:${port}` },
  });
  ws.binaryType = 'arraybuffer';
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const synced = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no sync frame within 5 s')), 5000);
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        syncProtocol.readSyncMessage(decoding.createDecoder(new Uint8Array(data)), encoding.createEncoder(), doc, 'server');
        return;
      }
      const msg = JSON.parse(data.toString());
      if (msg.type === 'sync') {
        clearTimeout(timer);
        resolve(msg);
      }
    });
  });
  ws.send(JSON.stringify({ type: 'auth', token }));
  const meta = await synced;
  expect(meta.canWrite).toBe(true);
  return ws;
}

describe('a stop in the middle of an edit', () => {
  it('flushes the pending save: the edit is in ydoc_state and in the restarted server', { timeout: 120_000 }, async () => {
    const port = await freePort();
    const first = await startServer(port);
    const token = await signIn(port);
    // bootstrapInstance seeded one document for the admin on this empty schema.
    const [log] = await c2_query('SELECT id FROM logs ORDER BY id LIMIT 1', []);
    expect(log).toBeDefined();

    const editor = new Y.Doc();
    const ws = await openCollab(port, log.id, token, editor);
    const editedAt = Date.now();
    editor.getText('body').insert(0, MARKER);
    const encoder = encoding.createEncoder();
    syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(editor));
    ws.send(encoding.toUint8Array(encoder));
    const socketClosed = new Promise((resolve) => ws.once('close', (code) => resolve(code)));
    await new Promise((resolve) => setTimeout(resolve, 200));

    const stopped = await kill(first, 'SIGTERM');

    // Inside the debounce: the three-second save timer never fired, so
    // whatever reached the database got there through the shutdown flush.
    expect(Date.now() - editedAt).toBeLessThan(3000);
    expect(stopped.code, stopped.stderr).toBe(0);
    expect(stopped.stderr).toMatch(/stopped cleanly on SIGTERM/);
    expect(await socketClosed).toBe(1001);

    const [row] = await c2_query('SELECT ydoc_state FROM logs WHERE id = ?', [log.id]);
    expect(row.ydoc_state).not.toBeNull();
    const saved = new Y.Doc();
    Y.applyUpdate(saved, new Uint8Array(row.ydoc_state));
    expect(saved.getText('body').toString()).toBe(MARKER);

    // And a restart serves it: the lock the stopped process held is free.
    const second = await startServer(port);
    const reader = new Y.Doc();
    const ws2 = await openCollab(port, log.id, await signIn(port), reader);
    expect(reader.getText('body').toString()).toBe(MARKER);
    ws2.terminate();
    const again = await kill(second, 'SIGTERM');
    expect(again.code, again.stderr).toBe(0);
  });
});

describe('a lock lost to another process', () => {
  it('the server that lost it stops through its shutdown and exits 1, naming the new holder', { timeout: 120_000 }, async () => {
    const port = await freePort();
    const server = await startServer(port);
    const [{ holder }] = await c2_query(`SELECT IS_USED_LOCK(${INSTANCE_LOCK_NAME_SQL}) AS holder`, []);
    expect(holder).toEqual(expect.any(Number));

    // KILL stands in for a MySQL restart: the lock goes with its connection.
    // This test's own connection then takes it, the way a duplicate process
    // that reconnects first after the restart would.
    const admin = await openAdminConnection();
    const rival = await openConnection();
    try {
      await admin.query('KILL ?', [holder]);
      const [[taken]] = await rival.query(`SELECT GET_LOCK(${INSTANCE_LOCK_NAME_SQL}, 5) AS got, CONNECTION_ID() AS id`);
      expect(taken.got).toBe(1);

      const stopped = await Promise.race([
        server.closed,
        new Promise((resolve) => setTimeout(() => resolve({ code: 'still running' }), 15_000)),
      ]);

      expect(stopped.code, server.out.stderr).toBe(1);
      expect(stopped.stderr).toContain(`MySQL connection ${taken.id}`);
      expect(stopped.stderr).toMatch(/another process took the instance lock/i);
      expect(stopped.stderr).toMatch(/stopped on/);
      expect(stopped.stderr).not.toMatch(/stopped cleanly/);
    } finally {
      await rival.end();
      await admin.end();
    }
  });
});
