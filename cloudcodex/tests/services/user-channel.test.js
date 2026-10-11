import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import WebSocket from 'ws';

vi.mock('../../mysql_connect.js', () => ({
  c2_query: vi.fn(async () => []),
  validateAndAutoLogin: vi.fn(async () => null),
  generateSessionToken: vi.fn(async () => 'tok'),
  touchSession: vi.fn(async () => {}),
}));

import { validateAndAutoLogin } from '../../mysql_connect.js';
import { hashSessionToken } from '../../services/session-token.js';
import {
  broadcastToUser,
  isUserConnected,
  getConnectedUserCount,
  setupUserChannelServer,
  closeAll,
  closeSocketsForSessions,
} from '../../services/user-channel.js';

describe('services/user-channel (broadcast helpers)', () => {
  beforeEach(() => {
    // Force re-import to clear in-memory channel map between tests by
    // using a fresh broadcast — there's no public reset API, but the
    // map is keyed by userId, so untracked users return 0 from the start.
  });

  it('broadcastToUser returns 0 when the user has no open tabs', () => {
    const sent = broadcastToUser(999_999_999, { type: 'notification', notification: { id: 1 } });
    expect(sent).toBe(0);
  });

  it('isUserConnected returns false for an untracked user', () => {
    expect(isUserConnected(999_999_999)).toBe(false);
  });

  it('getConnectedUserCount returns a non-negative integer', () => {
    const n = getConnectedUserCount();
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(0);
  });
});

describe('services/user-channel: closeAll', () => {
  let server;
  let port;

  beforeEach(async () => {
    server = http.createServer();
    setupUserChannelServer(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  afterEach(async () => {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  });

  const open = async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/notifications-ws`, {
      headers: { Origin: `http://127.0.0.1:${port}` },
    });
    await new Promise((r) => ws.once('open', r));
    return ws;
  };

  const closed = (ws) => new Promise((resolve) => {
    ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
  });

  it('closes every open socket, authenticated or not, with the code and reason given', async () => {
    validateAndAutoLogin.mockResolvedValue({ id: 8101, name: 'u' });
    const authed = await open();
    const connected = new Promise((r) => authed.once('message', r));
    authed.send(JSON.stringify({ type: 'auth', token: 't' }));
    await connected;
    expect(isUserConnected(8101)).toBe(true);
    const pendingAuth = await open();

    const results = Promise.all([closed(authed), closed(pendingAuth)]);
    closeAll(1001, 'Server shutting down');

    expect(await results).toEqual([
      { code: 1001, reason: 'Server shutting down' },
      { code: 1001, reason: 'Server shutting down' },
    ]);
  });
});

// Pinned for W6-CDX-3: the inbox socket authenticates from a token the page
// reads out of the cookie, so the Origin rule is the whole cross-site defence.
// A sibling host under the same registrable domain is cross-origin here.
describe('services/user-channel: the Origin rule, pinned', () => {
  let server;
  let port;

  beforeEach(async () => {
    server = http.createServer();
    setupUserChannelServer(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  afterEach(async () => {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  });

  const connect = (headers) => new WebSocket(`ws://127.0.0.1:${port}/notifications-ws`, { headers });

  /** The refused upgrade's status, once the server has destroyed the socket. */
  const refusal = (ws) => new Promise((resolve, reject) => {
    ws.once('open', () => reject(new Error('upgrade was accepted')));
    ws.once('unexpected-response', (_req, res) => {
      res.socket.once('close', () => resolve({ status: res.statusCode, destroyed: res.socket.destroyed }));
      res.resume();
    });
  });

  it('refuses an upgrade with no Origin: 403, socket destroyed', async () => {
    expect(await refusal(connect({}))).toEqual({ status: 403, destroyed: true });
  });

  it('refuses a sibling host\'s Origin: 403, socket destroyed', async () => {
    const ws = connect({ Host: 'codex.example.com', Origin: 'https://command.example.com' });
    expect(await refusal(ws)).toEqual({ status: 403, destroyed: true });
  });

  it('accepts the same Host with its own Origin (the control for the sibling case)', async () => {
    const ws = connect({ Host: 'codex.example.com', Origin: 'https://codex.example.com' });
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('unexpected-response', (_req, res) => reject(new Error(`refused: ${res.statusCode}`)));
    });
    ws.terminate();
  });
});

describe('services/user-channel: closeSocketsForSessions (W6-CDX-6)', () => {
  let server;
  let port;

  beforeEach(async () => {
    server = http.createServer();
    setupUserChannelServer(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  afterEach(async () => {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  });

  const open = async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/notifications-ws`, {
      headers: { Origin: `http://127.0.0.1:${port}` },
    });
    await new Promise((r) => ws.once('open', r));
    return ws;
  };

  /** Authenticates a socket as `sessionId`, and waits for the server to confirm it. */
  const authenticate = async (ws, userId, sessionId) => {
    validateAndAutoLogin.mockResolvedValueOnce(Object.defineProperty({ id: userId, name: 'u' }, 'sessionId', { value: sessionId }));
    const connected = new Promise((r) => ws.once('message', r));
    ws.send(JSON.stringify({ type: 'auth', token: `t-${sessionId}` }));
    await connected;
  };

  const closed = (ws) => new Promise((resolve) => {
    ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
  });

  it('closes only the sockets of the revoked session, and leaves the same user\'s other device open', async () => {
    const phone = await open();
    const laptop = await open();
    await authenticate(phone, 9301, 'digest-phone');
    await authenticate(laptop, 9301, 'digest-laptop');

    const phoneClosed = closed(phone);
    const closedCount = closeSocketsForSessions([hashSessionToken('t-digest-phone')]);
    expect(closedCount).toBe(1);
    expect(await phoneClosed).toEqual({ code: 4004, reason: 'Signed out' });

    // The laptop socket is still open and still receives this user's messages.
    expect(laptop.readyState).toBe(WebSocket.OPEN);
    expect(broadcastToUser(9301, { type: 'ping' })).toBe(1);
    laptop.terminate();
  });

  it('closes nothing for an empty set of digests, or for sessions with no open socket', async () => {
    const ws = await open();
    await authenticate(ws, 9302, 'digest-live');

    expect(closeSocketsForSessions([])).toBe(0);
    expect(closeSocketsForSessions([hashSessionToken('t-nobody')])).toBe(0);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.terminate();
  });

  // W6-CDX-6 review: a sign-out that lands while the socket is still authenticating must not leave it live.
  it('closes a socket whose sign-out lands while it is still authenticating, and registers it nowhere', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    validateAndAutoLogin.mockImplementationOnce(() => gate.then(() => ({ id: 9401, name: 'racer' })));

    const ws = await open();
    const closedSocket = closed(ws);
    ws.send(JSON.stringify({ type: 'auth', token: 't-race' }));
    await vi.waitFor(() => expect(validateAndAutoLogin).toHaveBeenCalledWith('t-race'));

    // The session is ended while the auth read is still pending.
    expect(closeSocketsForSessions([hashSessionToken('t-race')])).toBe(1);
    release();

    expect(await closedSocket).toEqual({ code: 4004, reason: 'Signed out' });
    expect(isUserConnected(9401)).toBe(false);
  });
});
