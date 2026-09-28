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
import {
  broadcastToUser,
  isUserConnected,
  getConnectedUserCount,
  setupUserChannelServer,
  closeAll,
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
