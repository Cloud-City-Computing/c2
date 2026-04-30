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

// ── Authenticated flow + message routing ────────────────

/**
 * Open a real ws client, complete the auth handshake, and resolve once
 * the server's awareness/sync messages have arrived.
 */
async function authenticatedClient(logId, user = TEST_USER, dbStubs = []) {
  validateAndAutoLogin.mockResolvedValue(user);
  // First DB call after auth is the doc load (SELECT ydoc_state, html_content);
  // second is the read-access check; third is the write-access check.
  c2_query
    .mockResolvedValueOnce([{ ydoc_state: null, html_content: '<p>hi</p>' }]) // getOrCreateDoc
    .mockResolvedValueOnce([{ id: logId }])                                    // checkLogReadAccess
    .mockResolvedValueOnce([{ id: logId }]);                                   // checkLogWriteAccess
  for (const stub of dbStubs) c2_query.mockResolvedValueOnce(stub);

  const ws = new WebSocket(url(logId), { headers: { Origin: origin() } });
  ws.binaryType = 'arraybuffer';
  await new Promise((r) => ws.once('open', r));
  ws.send(JSON.stringify({ type: 'auth', token: 'good' }));

  // Wait for the JSON `sync` frame that confirms auth completed.
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No sync within 2s')), 2000);
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.type === 'sync') {
          clearTimeout(timer);
          resolve();
        }
      } catch { /* ignore */ }
    });
  });
  return ws;
}

describe('services/collab — authenticated session', () => {
  it('admits the user and reports them via getActiveUsers / getAllPresence', async () => {
    const ws = await authenticatedClient(101);
    expect(getActiveUsers(101).length).toBe(1);
    expect(getActiveUsers(101)[0]).toMatchObject({ id: TEST_USER.id, name: TEST_USER.name });
    expect(getAllPresence()[101]).toBeDefined();
    expect(getActiveDocCount()).toBeGreaterThanOrEqual(1);
    ws.close();
    await new Promise((r) => ws.once('close', r));
  });

  it('broadcastToDoc returns true and sends to active connections', async () => {
    const ws = await authenticatedClient(102);
    const received = [];
    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        try { received.push(JSON.parse(data.toString())); } catch { /* ignore */ }
      }
    });

    expect(broadcastToDoc(102, { type: 'github-pulled' })).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(received.some((m) => m.type === 'github-pulled')).toBe(true);
    ws.close();
    await new Promise((r) => ws.once('close', r));
  });

  it('rejects unknown JSON message types silently (no error frame)', async () => {
    const ws = await authenticatedClient(103);
    const errs = [];
    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        try {
          const m = JSON.parse(data.toString());
          if (m.type === 'error') errs.push(m);
        } catch { /* ignore */ }
      }
    });
    ws.send(JSON.stringify({ type: 'mystery-event' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(errs).toEqual([]);
    ws.close();
    await new Promise((r) => ws.once('close', r));
  });

  it('rejects cursor messages with non-numeric or missing index', async () => {
    const ws = await authenticatedClient(104);
    const peers = [];
    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        try {
          const m = JSON.parse(data.toString());
          if (m.type === 'cursor') peers.push(m);
        } catch { /* ignore */ }
      }
    });
    // Single client — no peers will receive this anyway, but the server
    // still rejects malformed messages without crashing.
    ws.send(JSON.stringify({ type: 'cursor', position: { index: 'not-a-number' } }));
    ws.send(JSON.stringify({ type: 'cursor' }));
    await new Promise((r) => setTimeout(r, 50));
    // The connection is still healthy.
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
    await new Promise((r) => ws.once('close', r));
  });

  it('persists a title change via UPDATE logs SET title = ?', async () => {
    const ws = await authenticatedClient(105, TEST_USER, [
      [{ affectedRows: 1 }], // UPDATE logs SET title
      [{ insertId: 1 }],     // logActivity insert
    ]);
    ws.send(JSON.stringify({ type: 'title', title: 'Renamed Doc' }));
    await new Promise((r) => setTimeout(r, 100));

    const titleUpdate = c2_query.mock.calls.find(([sql]) =>
      /UPDATE logs SET title/i.test(sql)
    );
    expect(titleUpdate).toBeDefined();
    expect(titleUpdate[1]).toContain('Renamed Doc');
    ws.close();
    await new Promise((r) => ws.once('close', r));
  });

  it('truncates oversized titles to 255 chars', async () => {
    const ws = await authenticatedClient(106, TEST_USER, [
      [{ affectedRows: 1 }],
      [{ insertId: 1 }],
    ]);
    const huge = 'a'.repeat(500);
    ws.send(JSON.stringify({ type: 'title', title: huge }));
    await new Promise((r) => setTimeout(r, 100));

    const titleUpdate = c2_query.mock.calls.find(([sql]) =>
      /UPDATE logs SET title/i.test(sql)
    );
    expect(titleUpdate).toBeDefined();
    expect(titleUpdate[1][0].length).toBe(255);
    ws.close();
    await new Promise((r) => ws.once('close', r));
  });

  it('ignores empty titles after trimming', async () => {
    const ws = await authenticatedClient(107);
    ws.send(JSON.stringify({ type: 'title', title: '   ' }));
    await new Promise((r) => setTimeout(r, 50));
    const titleUpdate = c2_query.mock.calls.find(([sql]) =>
      /UPDATE logs SET title/i.test(sql)
    );
    expect(titleUpdate).toBeUndefined();
    ws.close();
    await new Promise((r) => ws.once('close', r));
  });

  it('saves the document on save messages and acks with type:saved', async () => {
    const ws = await authenticatedClient(108, TEST_USER, [
      [{ affectedRows: 1 }], // UPDATE logs SET html_content
      [{ id: 108, title: 'T', archive_id: 5 }], // fetchDocMeta inside processMentionsOnSave
      [], // any mentions queries
      [{ insertId: 1 }], // logActivity
    ]);

    const saved = new Promise((resolve) => {
      ws.on('message', (data, isBinary) => {
        if (!isBinary) {
          try {
            const m = JSON.parse(data.toString());
            if (m.type === 'saved') resolve();
          } catch { /* ignore */ }
        }
      });
    });

    ws.send(JSON.stringify({ type: 'save', html: '<p>updated</p>' }));
    await saved;
    ws.close();
    await new Promise((r) => ws.once('close', r));
  });

  it('rejects HTML payloads larger than MAX_HTML_SIZE on save (no error)', async () => {
    const ws = await authenticatedClient(109);
    const huge = 'x'.repeat(3 * 1024 * 1024); // 3 MB, over the 2 MB cap
    ws.send(JSON.stringify({ type: 'save', html: huge }));
    await new Promise((r) => setTimeout(r, 100));
    // No html_content UPDATE should have happened — the server falls back to
    // saving just the binary state with the prior html.
    const htmlUpdate = c2_query.mock.calls.find(([sql]) =>
      /UPDATE logs SET html_content/i.test(sql)
    );
    expect(htmlUpdate).toBeUndefined();
    ws.close();
    await new Promise((r) => ws.once('close', r));
  });

  it('blocks publish when canPublish denies (squad context, no permission)', async () => {
    const ws = await authenticatedClient(110, TEST_USER, [
      // Get squad context for the log — squad set, archive_creator different
      [{ squad_id: 5, archive_creator: 999 }],
      // canPublish workspace owner check — denies
      [],
      // canPublish squad member check — denies
      [{ can_publish: false, role: 'member' }],
    ]);

    const errors = new Promise((resolve) => {
      ws.on('message', (data, isBinary) => {
        if (!isBinary) {
          try {
            const m = JSON.parse(data.toString());
            if (m.type === 'error') resolve(m);
          } catch { /* ignore */ }
        }
      });
    });

    ws.send(JSON.stringify({ type: 'publish', title: 'v1' }));
    const err = await errors;
    expect(err.message).toMatch(/permission/i);
    ws.close();
    await new Promise((r) => ws.once('close', r));
  });

  it('broadcasts comment events to other connections', async () => {
    const ws1 = await authenticatedClient(111);
    // Open a second client on the same log.
    validateAndAutoLogin.mockResolvedValue({ ...TEST_USER, id: 2, name: 'Bob' });
    c2_query
      .mockResolvedValueOnce([{ id: 111 }]) // checkLogReadAccess
      .mockResolvedValueOnce([{ id: 111 }]); // checkLogWriteAccess
    const ws2 = new WebSocket(url(111), { headers: { Origin: origin() } });
    ws2.binaryType = 'arraybuffer';
    await new Promise((r) => ws2.once('open', r));
    ws2.send(JSON.stringify({ type: 'auth', token: 'good' }));
    await new Promise((resolve) => {
      ws2.on('message', (data, isBinary) => {
        if (!isBinary) {
          try {
            const m = JSON.parse(data.toString());
            if (m.type === 'sync') resolve();
          } catch { /* ignore */ }
        }
      });
    });

    const received = new Promise((resolve) => {
      ws1.on('message', (data, isBinary) => {
        if (!isBinary) {
          try {
            const m = JSON.parse(data.toString());
            if (m.type === 'comment' && m.action === 'add') resolve(m);
          } catch { /* ignore */ }
        }
      });
    });

    ws2.send(JSON.stringify({
      type: 'comment',
      action: 'add',
      comment: { id: 99 },
    }));

    const got = await received;
    expect(got.action).toBe('add');
    expect(got.userId).toBe(2);
    ws1.close();
    ws2.close();
    await Promise.all([
      new Promise((r) => ws1.once('close', r)),
      new Promise((r) => ws2.once('close', r)),
    ]);
  });

  it('drops the user from presence on close', async () => {
    const ws = await authenticatedClient(112);
    expect(getActiveUsers(112).length).toBe(1);
    ws.close();
    await new Promise((r) => ws.once('close', r));
    // Wait briefly for the close handler to run.
    await new Promise((r) => setTimeout(r, 50));
    expect(getActiveUsers(112).length).toBe(0);
  });
});
