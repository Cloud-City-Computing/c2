/**
 * User-scoped WebSocket channel for Cloud Codex
 *
 * Push-only channel for delivering inbox/notification updates to a user's
 * open tabs. Distinct from the doc-keyed /collab WebSocket — a user holds
 * one connection here regardless of which document they have open.
 *
 * Protocol:
 *   Client connects to ws://host/notifications-ws
 *   Client sends:  { type: 'auth', token: '<sessionToken>' } within 5s
 *   Server pushes: { type: 'notification', id, title, body, link_url, ... }
 *                  { type: 'unread_count', count }
 *                  { type: 'read', id }
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { WebSocketServer } from 'ws';
import { validateAndAutoLogin } from '../mysql_connect.js';

const AUTH_TIMEOUT_MS = 5000;
const MAX_CONNECTIONS_PER_USER = 10;

// userId → Set<ws>
const channels = new Map();

function trackConnection(userId, ws) {
  let set = channels.get(userId);
  if (!set) {
    set = new Set();
    channels.set(userId, set);
  }
  set.add(ws);
}

function untrackConnection(userId, ws) {
  const set = channels.get(userId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) channels.delete(userId);
}

/**
 * Push a JSON message to every active connection a user has.
 * Returns the number of sockets the message was sent to (0 if none open).
 */
export function broadcastToUser(userId, message) {
  const set = channels.get(userId);
  if (!set) return 0;
  const data = typeof message === 'string' ? message : JSON.stringify(message);
  let sent = 0;
  for (const ws of set) {
    if (ws.readyState === 1) {
      try {
        ws.send(data);
        sent++;
      } catch {
        // ignore — close handler will untrack
      }
    }
  }
  return sent;
}

/** Diagnostics: number of users currently connected. */
export function getConnectedUserCount() {
  return channels.size;
}

/** Diagnostics: whether a given user has at least one open tab. */
export function isUserConnected(userId) {
  const set = channels.get(userId);
  return Boolean(set && set.size > 0);
}

/**
 * Attach the user-channel WebSocket server to an existing HTTP server.
 * Mirrors the auth pattern in services/collab.js.
 *
 * @param {import('http').Server} server
 */
export function setupUserChannelServer(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.prependListener('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname !== '/notifications-ws') return;

    // CSWSH protection: same-origin only
    const origin = request.headers.origin;
    const host = request.headers.host;
    if (!origin) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
    } catch {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws);
    });
  });

  wss.on('connection', (ws) => {
    const authTimer = setTimeout(() => {
      ws.close(4001, 'Authentication timeout');
    }, AUTH_TIMEOUT_MS);

    ws.once('message', async (data) => {
      clearTimeout(authTimer);

      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        ws.close(4002, 'Invalid auth message');
        return;
      }

      if (msg.type !== 'auth' || typeof msg.token !== 'string') {
        ws.close(4002, 'First message must be auth');
        return;
      }

      let user;
      try {
        user = await validateAndAutoLogin(msg.token);
      } catch {
        // auth error
      }

      if (!user) {
        ws.close(4003, 'Unauthorized');
        return;
      }

      const existing = channels.get(user.id);
      if (existing && existing.size >= MAX_CONNECTIONS_PER_USER) {
        ws.close(4004, 'Too many connections');
        return;
      }

      trackConnection(user.id, ws);

      try {
        ws.send(JSON.stringify({ type: 'connected', userId: user.id }));
      } catch {
        // ignore
      }

      ws.on('close', () => untrackConnection(user.id, ws));
      ws.on('error', () => untrackConnection(user.id, ws));
    });
  });
}
