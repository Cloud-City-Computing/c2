/**
 * Collaborative Editing Service for Cloud Codex
 *
 * Manages Yjs documents over WebSocket connections. Each document (log)
 * gets a shared Yjs Doc that multiple users can edit simultaneously.
 * The CRDT handles merge/conflict resolution automatically.
 *
 * Auth: Validates session tokens on WebSocket upgrade.
 * Persistence: Loads initial content from MySQL, debounce-saves back.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { validateAndAutoLogin } from '../mysql_connect.js';
import { c2_query } from '../mysql_connect.js';
import { sanitizeHtml, canPublish, checkLogReadAccess, checkLogWriteAccess } from '../routes/helpers/shared.js';
import { extractImagesFromHtml } from '../routes/helpers/images.js';

// In-memory store: logId → { doc, conns, saveTimer, lastSavedHtml }
const docs = new Map();

// Track per-user connection count across all documents
const userConnectionCounts = new Map(); // userId → count

const SAVE_DEBOUNCE_MS = 3000;
const CLEANUP_DELAY_MS = 30000;
const MAX_MESSAGE_SIZE = 5 * 1024 * 1024;   // 5 MB max WebSocket message
const MAX_HTML_SIZE   = 2 * 1024 * 1024;    // 2 MB max document HTML
const MAX_CONNECTIONS_PER_USER = 10;         // Max simultaneous WS connections per user
const RATE_LIMIT_WINDOW_MS = 1000;           // 1 second window
const RATE_LIMIT_MAX_MESSAGES = 60;          // Max messages per window

/**
 * Get or create a Yjs document for a log.
 * Restores from binary CRDT state if available; otherwise the Y.Doc starts
 * empty and the first connecting client will initialise it via the Tiptap
 * Collaboration extension (which writes a proper ProseMirror structure).
 */
async function getOrCreateDoc(logId) {
  if (docs.has(logId)) return docs.get(logId);

  const ydoc = new Y.Doc();
  const entry = {
    doc: ydoc,
    conns: new Map(),   // ws → { user, canWrite, color }
    saveTimer: null,
    cleanupTimer: null,
    lastSavedHtml: null,
    logId,
  };

  // Load binary CRDT state from DB (preferred) or fall back to empty doc
  const [log] = await c2_query(
    `SELECT ydoc_state, html_content FROM logs WHERE id = ? LIMIT 1`,
    [logId]
  );

  if (log?.ydoc_state) {
    Y.applyUpdate(ydoc, new Uint8Array(log.ydoc_state));
  }
  // If no ydoc_state, the Y.Doc stays empty. The first client's Tiptap
  // Collaboration extension will initialise it from the REST-loaded HTML,
  // creating a proper ProseMirror Y.Xml structure that syncs back here.

  if (log?.html_content) {
    entry.lastSavedHtml = log.html_content;
  }

  // Broadcast every Y.Doc mutation to connected peers (except the origin).
  // The origin is set to the sender's WebSocket in readSyncMessage, so we
  // can skip echoing the update back to the author.
  ydoc.on('update', (update, origin) => {
    const encoder = encoding.createEncoder();
    syncProtocol.writeUpdate(encoder, update);
    const msg = encoding.toUint8Array(encoder);
    for (const [client] of entry.conns) {
      if (client !== origin && client.readyState === 1) {
        client.send(msg);
      }
    }
    // Any mutation should trigger a debounced save
    scheduleSave(entry);
  });

  docs.set(logId, entry);
  return entry;
}

/**
 * Debounced save: writes the current Yjs binary CRDT state back to MySQL.
 * HTML is NOT updated here — clients send HTML during explicit save/publish.
 * Binary state is saved frequently so the CRDT can be restored on restart.
 */
function scheduleSave(entry) {
  if (entry.saveTimer) clearTimeout(entry.saveTimer);
  entry.saveTimer = setTimeout(async () => {
    try {
      const state = Y.encodeStateAsUpdate(entry.doc);
      await c2_query(
        `UPDATE logs SET ydoc_state = ?, updated_at = NOW() WHERE id = ?`,
        [Buffer.from(state), entry.logId]
      );
    } catch (err) {
      console.error(`[collab] Save failed for log ${entry.logId}:`, err);
    }
  }, SAVE_DEBOUNCE_MS);
}

/**
 * Remove a document from memory after all connections close (with delay).
 */
function scheduleCleanup(entry) {
  if (entry.cleanupTimer) clearTimeout(entry.cleanupTimer);
  entry.cleanupTimer = setTimeout(() => {
    if (entry.conns.size === 0) {
      if (entry.saveTimer) clearTimeout(entry.saveTimer);
      entry.doc.destroy();
      docs.delete(entry.logId);
    }
  }, CLEANUP_DELAY_MS);
}

/**
 * Encode awareness state update for broadcasting.
 */
function encodeAwarenessUpdate(entry) {
  const users = [];
  for (const [, meta] of entry.conns) {
    users.push({ id: meta.user.id, name: meta.user.name, avatar_url: meta.user.avatar_url || null, color: meta.color });
  }
  return JSON.stringify({ type: 'awareness', users });
}

/**
 * Broadcast a message to all connections on a document except the sender.
 */
function broadcastExcept(entry, senderWs, message) {
  const data = typeof message === 'string' ? message : JSON.stringify(message);
  for (const [ws] of entry.conns) {
    if (ws !== senderWs && ws.readyState === 1) {
      ws.send(data);
    }
  }
}

/**
 * Broadcast awareness state to ALL connections (including sender).
 */
function broadcastAwareness(entry) {
  const msg = encodeAwarenessUpdate(entry);
  for (const [ws] of entry.conns) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

// Color palette for user cursors
const COLORS = [
  '#2ca7db', '#e5544e', '#50c878', '#ffa500', '#9b59b6',
  '#e91e63', '#00bcd4', '#8bc34a', '#ff5722', '#607d8b',
];

let colorIndex = 0;
function nextColor() {
  const c = COLORS[colorIndex % COLORS.length];
  colorIndex++;
  return c;
}

/**
 * Attach the collaborative WebSocket server to an existing HTTP server.
 *
 * Protocol:
 * - Client connects to ws://host/collab?logId=<id>&token=<sessionToken>
 * - Server authenticates the token, checks log read/write access
 * - Server sends: { type: 'sync', html, canWrite, user: { id, name } } on connect
 * - Client sends: { type: 'update', html } when content changes
 * - Client sends: { type: 'cursor', position: { index, line?, length? } } for cursor position
 * - Client sends: { type: 'save' } to request an immediate content save
 * - Client sends: { type: 'publish', title?, notes? } to publish a version snapshot
 * - Server broadcasts: { type: 'update', html, userId } to other clients
 * - Server broadcasts: { type: 'cursor', userId, userName, color, position } to other clients
 * - Server sends: { type: 'saved' } to confirm a content save
 * - Server broadcasts: { type: 'published', version, title } on successful publish
 * - Server sends: { type: 'awareness', users: [...] } on join/leave
 * - Server sends: { type: 'error', message } on failures
 *
 * @param {import('http').Server} server
 */
export function setupCollabServer(server) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_SIZE,
  });

  server.prependListener('upgrade', async (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);

    // Only handle /collab path
    if (url.pathname !== '/collab') return;

    // Origin validation to prevent Cross-Site WebSocket Hijacking (CSWSH)
    const origin = request.headers.origin;
    const host = request.headers.host;
    if (!origin) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    if (origin) {
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
    }

    const logId = Number(url.searchParams.get('logId'));

    if (!logId || !Number.isInteger(logId) || logId <= 0) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    // Upgrade the connection first — auth happens in the first message
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, { logId });
    });
  });

  wss.on('connection', async (ws, { logId }) => {
    // Wait for the first message to be an auth message with the session token.
    // The client must send { type: 'auth', token: '...' } within 5 seconds.
    const AUTH_TIMEOUT_MS = 5000;
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

      // Authenticate
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

      // Enforce per-user connection limit
      const currentCount = userConnectionCounts.get(user.id) || 0;
      if (currentCount >= MAX_CONNECTIONS_PER_USER) {
        ws.close(4004, 'Too many connections');
        return;
      }

      // Check read access at minimum
      const hasAccess = await checkLogReadAccess(logId, user);
      if (!hasAccess) {
        ws.close(4003, 'Access denied');
        return;
      }

      const canWrite = Boolean(await checkLogWriteAccess(logId, user));

      // Auth succeeded — set up the document session
      setupDocSession(ws, user, logId, canWrite);
    });
  });
}

/**
 * Set up a fully authenticated document editing session.
 */
async function setupDocSession(ws, user, logId, canWrite) {
    let entry;
    try {
      entry = await getOrCreateDoc(logId);
    } catch (err) {
      console.error(`[collab] Failed to load doc ${logId}:`, err);
      ws.close(1011, 'Failed to load document');
      return;
    }

    // Cancel cleanup timer if someone reconnects
    if (entry.cleanupTimer) {
      clearTimeout(entry.cleanupTimer);
      entry.cleanupTimer = null;
    }

    const color = nextColor();
    entry.conns.set(ws, { user, canWrite, color });

    // Track per-user connection count
    userConnectionCounts.set(user.id, (userConnectionCounts.get(user.id) || 0) + 1);

    // Per-connection rate limiter state
    let messageCount = 0;
    let rateLimitWindowStart = Date.now();

    // --- Binary Yjs sync: send server state to new client ---
    // Step 1: send our state vector so the client knows what we have
    {
      const encoder = encoding.createEncoder();
      syncProtocol.writeSyncStep1(encoder, entry.doc);
      ws.send(encoding.toUint8Array(encoder));
    }
    // Step 2: send the full document state (proactive, so client gets content immediately)
    {
      const encoder = encoding.createEncoder();
      syncProtocol.writeSyncStep2(encoder, entry.doc);
      ws.send(encoding.toUint8Array(encoder));
    }

    // JSON metadata sync (permissions, identity — no HTML)
    ws.send(JSON.stringify({
      type: 'sync',
      canWrite,
      user: { id: user.id, name: user.name },
    }));

    // Broadcast updated awareness to all
    broadcastAwareness(entry);

    // Handle incoming messages — binary frames are Yjs CRDT ops,
    // text frames are JSON for cursors / save / publish / comments / title.
    ws.on('message', (data, isBinary) => {
      // Rate limit: max RATE_LIMIT_MAX_MESSAGES per RATE_LIMIT_WINDOW_MS
      const now = Date.now();
      if (now - rateLimitWindowStart > RATE_LIMIT_WINDOW_MS) {
        messageCount = 0;
        rateLimitWindowStart = now;
      }
      messageCount++;
      if (messageCount > RATE_LIMIT_MAX_MESSAGES) {
        ws.send(JSON.stringify({ type: 'error', message: 'Rate limit exceeded' }));
        return;
      }

      // --- Binary: Yjs sync/update ---
      if (isBinary) {
        if (!canWrite) return; // read-only clients cannot mutate the doc
        try {
          const decoder = decoding.createDecoder(new Uint8Array(data));
          const encoder = encoding.createEncoder();
          // Pass `ws` as transactionOrigin so the doc 'update' handler
          // knows which client sent it and won't echo it back.
          syncProtocol.readSyncMessage(decoder, encoder, entry.doc, ws);
          if (encoding.length(encoder) > 1) {
            ws.send(encoding.toUint8Array(encoder));
          }
        } catch (err) {
          console.error(`[collab] Binary sync error for log ${entry.logId}:`, err);
        }
        return;
      }

      // --- Text: JSON messages ---
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }

      // Validate message type is a known string
      if (typeof msg.type !== 'string' || !['cursor', 'save', 'publish', 'comment', 'title'].includes(msg.type)) {
        return;
      }

      if (msg.type === 'cursor' && canWrite) {
        // Validate cursor position structure before forwarding
        const pos = msg.position;
        if (!pos || typeof pos !== 'object' || typeof pos.index !== 'number' || !Number.isFinite(pos.index)) {
          return;
        }
        // Sanitize: only forward safe numeric fields
        const safePosition = { index: Math.max(0, Math.floor(pos.index)) };
        if (typeof pos.line === 'number' && Number.isFinite(pos.line)) {
          safePosition.line = Math.max(0, Math.floor(pos.line));
        }
        if (typeof pos.length === 'number' && Number.isFinite(pos.length)) {
          safePosition.length = Math.max(0, Math.floor(pos.length));
        }

        // Forward validated cursor position to others
        broadcastExcept(entry, ws, {
          type: 'cursor',
          userId: user.id,
          userName: user.name,
          color,
          position: safePosition,
        });
      }

      if (msg.type === 'save' && canWrite) {
        // Immediate save — client sends current HTML for DB storage alongside
        // the binary CRDT state that the server already has.
        if (entry.saveTimer) clearTimeout(entry.saveTimer);
        (async () => {
          try {
            const state = Y.encodeStateAsUpdate(entry.doc);
            let storedHtml = entry.lastSavedHtml;

            if (typeof msg.html === 'string' && msg.html.length <= MAX_HTML_SIZE) {
              const safeHtml = sanitizeHtml(msg.html);
              storedHtml = await extractImagesFromHtml(safeHtml);
            }

            // Determine markdown_content: explicit string keeps it, explicit null clears it, undefined leaves it unchanged
            const mdVal = msg.markdown !== undefined ? (typeof msg.markdown === 'string' ? msg.markdown : null) : undefined;

            if (storedHtml && storedHtml !== entry.lastSavedHtml) {
              if (mdVal !== undefined) {
                await c2_query(
                  `UPDATE logs SET html_content = ?, markdown_content = ?, ydoc_state = ?, updated_at = NOW(), updated_by = ? WHERE id = ?`,
                  [storedHtml, mdVal, Buffer.from(state), user.id, entry.logId]
                );
              } else {
                await c2_query(
                  `UPDATE logs SET html_content = ?, ydoc_state = ?, updated_at = NOW(), updated_by = ? WHERE id = ?`,
                  [storedHtml, Buffer.from(state), user.id, entry.logId]
                );
              }
              entry.lastSavedHtml = storedHtml;
            } else {
              await c2_query(
                `UPDATE logs SET ydoc_state = ?, updated_at = NOW(), updated_by = ? WHERE id = ?`,
                [Buffer.from(state), user.id, entry.logId]
              );
            }
            ws.send(JSON.stringify({ type: 'saved' }));
          } catch (err) {
            console.error(`[collab] Immediate save failed for log ${entry.logId}:`, err);
          }
        })();
      }

      if (msg.type === 'title' && typeof msg.title === 'string') {
        const safeTitle = msg.title.trim().slice(0, 255);
        if (!safeTitle) return;

        (async () => {
          try {
            await c2_query(
              `UPDATE logs SET title = ?, updated_at = NOW(), updated_by = ? WHERE id = ?`,
              [safeTitle, user.id, entry.logId]
            );
            // Broadcast to all other clients
            broadcastExcept(entry, ws, { type: 'title', title: safeTitle, userId: user.id });
          } catch (err) {
            console.error(`[collab] Title update failed for log ${entry.logId}:`, err);
          }
        })();
      }

      if (msg.type === 'publish' && canWrite) {
        // Validate optional title, notes, and HTML from client
        const pubTitle = typeof msg.title === 'string' ? msg.title.trim().slice(0, 255) : null;
        const pubNotes = typeof msg.notes === 'string' ? msg.notes.trim().slice(0, 5000) : null;
        const pubHtml = typeof msg.html === 'string' ? msg.html : null;

        (async () => {
          try {
            // Get squad context for the log
            const [logInfo] = await c2_query(
              `SELECT p.squad_id, p.created_by AS archive_creator FROM logs pg
               INNER JOIN archives p ON pg.archive_id = p.id
               WHERE pg.id = ? LIMIT 1`,
              [entry.logId]
            );

            const publishAllowed = await canPublish(logInfo?.squad_id, logInfo?.archive_creator, user);
            if (!publishAllowed) {
              ws.send(JSON.stringify({ type: 'error', message: 'You do not have permission to publish versions' }));
              return;
            }

            // Publish: save content AND create a formal version snapshot
            if (entry.saveTimer) clearTimeout(entry.saveTimer);
            const state = Y.encodeStateAsUpdate(entry.doc);

            // Use client-provided HTML (preferred) or fall back to last saved HTML
            let currentHtml = entry.lastSavedHtml || '';
            if (pubHtml && pubHtml.length <= MAX_HTML_SIZE) {
              currentHtml = await extractImagesFromHtml(sanitizeHtml(pubHtml));
            }

            const [log] = await c2_query(
              `SELECT version FROM logs WHERE id = ? LIMIT 1`,
              [entry.logId]
            );
            if (!log) return;
            const newVersion = log.version + 1;
            await c2_query(
              `UPDATE logs SET html_content = ?, ydoc_state = ?, version = ?, updated_at = NOW(), updated_by = ? WHERE id = ?`,
              [currentHtml, Buffer.from(state), newVersion, user.id, entry.logId]
            );
            await c2_query(
              `INSERT INTO versions (log_id, version, title, notes, html_content, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
              [entry.logId, newVersion, pubTitle || null, pubNotes || null, currentHtml, user.id]
            );
            entry.lastSavedHtml = currentHtml;

            // Notify all clients of the new published version
            const versionMsg = JSON.stringify({ type: 'published', version: newVersion, title: pubTitle || null });
            for (const [client] of entry.conns) {
              if (client.readyState === 1) client.send(versionMsg);
            }
          } catch (err) {
            console.error(`[collab] Publish failed for log ${entry.logId}:`, err);
          }
        })();
      }

      // --- Comment broadcast ---
      // Relays comment events (add, update, resolve, delete) to all other clients on the same log.
      // The actual CRUD is handled by the REST API; this just broadcasts for real-time sync.
      if (msg.type === 'comment' && canWrite) {
        const validActions = ['add', 'update', 'resolve', 'reopen', 'delete', 'reply', 'clear'];
        if (typeof msg.action === 'string' && validActions.includes(msg.action)) {
          broadcastExcept(entry, ws, {
            type: 'comment',
            action: msg.action,
            comment: msg.comment ? { id: msg.comment.id } : null,
            reply: msg.reply ? { id: msg.reply.id, comment_id: msg.reply.comment_id } : null,
            commentId: typeof msg.commentId === 'number' ? msg.commentId : null,
            replyId: typeof msg.replyId === 'number' ? msg.replyId : null,
            userId: user.id,
            userName: user.name,
          });
        }
      }
    });

    ws.on('close', () => {
      entry.conns.delete(ws);

      // Decrement per-user connection count
      const count = (userConnectionCounts.get(user.id) || 1) - 1;
      if (count <= 0) userConnectionCounts.delete(user.id);
      else userConnectionCounts.set(user.id, count);

      broadcastAwareness(entry);

      if (entry.conns.size === 0) {
        // Final save then schedule cleanup
        scheduleSave(entry);
        scheduleCleanup(entry);
      }
    });

    ws.on('error', () => {
      entry.conns.delete(ws);

      // Decrement per-user connection count
      const count = (userConnectionCounts.get(user.id) || 1) - 1;
      if (count <= 0) userConnectionCounts.delete(user.id);
      else userConnectionCounts.set(user.id, count);

      broadcastAwareness(entry);
    });
}

/**
 * Broadcast an arbitrary JSON message to all active connections on a log.
 * Used by REST handlers (e.g. GitHub pull/push) to push side-channel events
 * to live editors without going through the Yjs sync protocol.
 */
export function broadcastToDoc(logId, message) {
  const entry = docs.get(logId);
  if (!entry) return false;
  const data = typeof message === 'string' ? message : JSON.stringify(message);
  for (const [ws] of entry.conns) {
    if (ws.readyState === 1) ws.send(data);
  }
  return true;
}

/**
 * Returns the number of active collaborative sessions (for diagnostics).
 */
export function getActiveDocCount() {
  return docs.size;
}

/**
 * Returns active users for a specific log (for the REST API).
 */
export function getActiveUsers(logId) {
  const entry = docs.get(logId);
  if (!entry) return [];
  const users = [];
  for (const [, meta] of entry.conns) {
    users.push({ id: meta.user.id, name: meta.user.name, avatar_url: meta.user.avatar_url || null, color: meta.color });
  }
  return users;
}

/**
 * Returns a map of all logs with active users: { [logId]: [{ id, name, color }] }
 */
export function getAllPresence() {
  const presence = {};
  for (const [logId, entry] of docs) {
    if (entry.conns.size === 0) continue;
    const users = [];
    for (const [, meta] of entry.conns) {
      users.push({ id: meta.user.id, name: meta.user.name, avatar_url: meta.user.avatar_url || null, color: meta.color });
    }
    presence[logId] = users;
  }
  return presence;
}
