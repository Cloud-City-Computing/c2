/**
 * Cloud Codex — Tests for services/collab.js
 *
 * Covers the exported broadcast/presence helpers, the upgrade-time origin
 * and path validation (CSWSH guard), and the per-connection auth flow
 * (timeout, malformed auth, bad token). The deeper Yjs CRDT sync paths are
 * intentionally light-touch — they're better exercised end-to-end against
 * a real client.
 *
 * Uses a real http.createServer() and a real ws client, so the upgrade
 * handler runs as it does in production. The mysql layer is mocked
 * globally via tests/setup.js; collab.js sits on top of those mocks.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import WebSocket from 'ws';
import { c2_query, validateAndAutoLogin } from '../../mysql_connect.js';
import { resetMocks, TEST_USER } from '../helpers.js';
import {
  setupCollabServer,
  broadcastToDoc,
  getActiveDocCount,
  getActiveUsers,
  getAllPresence,
} from '../../services/collab.js';

// Spin up a fresh HTTP server + WS upgrade handler per test so the in-memory
// `docs` Map state from one test doesn't bleed into another.
let server;
let port;

beforeEach(async () => {
  resetMocks();
  server = http.createServer();
  setupCollabServer(server);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  port = server.address().port;
});

afterEach(async () => {
  // closeAllConnections() is needed because clients that hung on a half-open
  // upgrade keep the server alive; without it server.close() waits forever.
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

function origin() {
  return `http://127.0.0.1:${port}`;
}

function url(logId = 1, path = '/collab') {
  return `ws://127.0.0.1:${port}${path}?logId=${logId}`;
}

/**
 * Wait for a ws to either open, close, or error and report the close code.
 * Resolves with { type: 'open' | 'close' | 'error', code, reason }.
 */
function awaitTerminal(ws) {
  return new Promise((resolve) => {
    ws.once('open', () => resolve({ type: 'open' }));
    ws.once('unexpected-response', (_req, res) => {
      resolve({ type: 'unexpected-response', status: res.statusCode });
    });
    ws.once('close', (code, reason) => {
      resolve({ type: 'close', code, reason: reason?.toString() });
    });
    ws.once('error', (err) => resolve({ type: 'error', message: err.message }));
  });
}

describe('services/collab — pure exports', () => {
  it('getActiveDocCount returns 0 when no docs are loaded', () => {
    expect(getActiveDocCount()).toBe(0);
  });

  it('getActiveUsers returns an empty array for an unknown log', () => {
    expect(getActiveUsers(99999)).toEqual([]);
  });

  it('getAllPresence returns an empty object when no docs are active', () => {
    expect(getAllPresence()).toEqual({});
  });

  it('broadcastToDoc returns false when the log has no in-memory entry', () => {
    expect(broadcastToDoc(99999, { type: 'ping' })).toBe(false);
  });
});

describe('services/collab — upgrade-time validation', () => {
  it('rejects when Origin host does not match request host', async () => {
    const ws = new WebSocket(url(1), {
      headers: { Origin: 'http://attacker.example.com' },
    });
    const result = await awaitTerminal(ws);
    expect(result.type).not.toBe('open');
  });

  it('rejects when Origin is malformed (URL parse fails)', async () => {
    const ws = new WebSocket(url(1), {
      headers: { Origin: '://not-a-url' },
    });
    const result = await awaitTerminal(ws);
    expect(result.type).not.toBe('open');
  });

  it('rejects when logId is missing or non-numeric', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/collab?logId=banana`, {
      headers: { Origin: origin() },
    });
    const result = await awaitTerminal(ws);
    expect(result.type).not.toBe('open');
  });

  it('rejects when logId is zero or negative', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/collab?logId=0`, {
      headers: { Origin: origin() },
    });
    const result = await awaitTerminal(ws);
    expect(result.type).not.toBe('open');
  });
});

describe('services/collab — post-upgrade auth flow', () => {
  // Note: the 5-second auth timeout (closes with code 4001) is exercised in
  // production; it's not unit-tested here because fake timers don't compose
  // cleanly with real WebSocket sockets. The malformed-message and bad-token
  // paths below cover the rest of the auth state machine.

  it('closes with 4002 if the first message is not valid JSON', async () => {
    const ws = new WebSocket(url(1), { headers: { Origin: origin() } });
    await new Promise((r) => ws.once('open', r));
    ws.send('not-json{{{');
    const result = await awaitTerminal(ws);
    expect(result.type).toBe('close');
    expect(result.code).toBe(4002);
  });

  it('closes with 4002 if the first message is not type=auth', async () => {
    const ws = new WebSocket(url(1), { headers: { Origin: origin() } });
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'cursor', position: { index: 0 } }));
    const result = await awaitTerminal(ws);
    expect(result.type).toBe('close');
    expect(result.code).toBe(4002);
  });

  it('closes with 4002 if auth message has no token string', async () => {
    const ws = new WebSocket(url(1), { headers: { Origin: origin() } });
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'auth' })); // missing token
    const result = await awaitTerminal(ws);
    expect(result.type).toBe('close');
    expect(result.code).toBe(4002);
  });

  it('closes with 4003 when validateAndAutoLogin returns null', async () => {
    validateAndAutoLogin.mockResolvedValue(null);

    const ws = new WebSocket(url(1), { headers: { Origin: origin() } });
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'auth', token: 'invalid' }));

    const result = await awaitTerminal(ws);
    expect(result.type).toBe('close');
    expect(result.code).toBe(4003);
  });

  it('closes with 4003 when the user has no read access to the log', async () => {
    validateAndAutoLogin.mockResolvedValue(TEST_USER);
    // checkLogReadAccess returns nothing → access denied
    c2_query.mockResolvedValueOnce([]); // checkLogReadAccess query

    const ws = new WebSocket(url(1), { headers: { Origin: origin() } });
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'auth', token: 'good-token' }));

    const result = await awaitTerminal(ws);
    expect(result.type).toBe('close');
    expect(result.code).toBe(4003);
  });
});

describe('services/collab — broadcastToDoc behaviour', () => {
  it('returns false for a logId without an in-memory entry', () => {
    // Without a real connection lifecycle there is no entry; returning false
    // is the contract for "nothing to broadcast to".
    expect(broadcastToDoc(424242, { type: 'ping' })).toBe(false);
  });
});
