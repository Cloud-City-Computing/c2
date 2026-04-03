/**
 * Collaborative Editing Service for Cloud Codex
 *
 * Manages Yjs documents over WebSocket connections. Each document (page)
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
import { validateAndAutoLogin } from '../mysql_connect.js';
import { c2_query } from '../mysql_connect.js';
import { sanitizeHtml, canPublish, checkPageReadAccess, checkPageWriteAccess } from '../routes/helpers/shared.js';

// In-memory store: pageId → { doc, conns, saveTimer, lastSavedHtml }
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
 * Get or create a Yjs document for a page.
 * On first access, loads html_content from the database.
 */
async function getOrCreateDoc(pageId) {
  if (docs.has(pageId)) return docs.get(pageId);

  const ydoc = new Y.Doc();
  const entry = {
    doc: ydoc,
    conns: new Map(),   // ws → { user, awareness }
    saveTimer: null,
    cleanupTimer: null,
    lastSavedHtml: null,
    pageId,
  };

  // Load current content from DB
  const [page] = await c2_query(
    `SELECT html_content, version FROM pages WHERE id = ? LIMIT 1`,
    [pageId]
  );

  if (page?.html_content) {
    const xmlFragment = ydoc.getXmlFragment('document');
    // Initialize with existing HTML by inserting it as a single XmlText node.
    // This gives us a starting point; subsequent edits are CRDT-tracked.
    const textNode = new Y.XmlText();
    textNode.insert(0, page.html_content);
    xmlFragment.insert(0, [textNode]);
    entry.lastSavedHtml = page.html_content;
  }

  docs.set(pageId, entry);
  return entry;
}

/**
 * Serialize the Yjs XmlFragment back to an HTML string.
 */
function xmlFragmentToHtml(xmlFragment) {
  let html = '';
  for (let i = 0; i < xmlFragment.length; i++) {
    const item = xmlFragment.get(i);
    if (item instanceof Y.XmlText) {
      html += item.toString();
    } else if (item instanceof Y.XmlElement) {
      html += item.toString();
    } else {
      html += String(item);
    }
  }
  return html;
}

/**
 * Debounced save: writes the current Yjs document content back to MySQL.
 * Saves content only — does not create a version snapshot.
 */
function scheduleSave(entry, userId) {
  if (entry.saveTimer) clearTimeout(entry.saveTimer);
  entry.saveTimer = setTimeout(async () => {
    try {
      const xmlFragment = entry.doc.getXmlFragment('document');
      const rawHtml = xmlFragmentToHtml(xmlFragment);
      const html = sanitizeHtml(rawHtml);

      // Skip if content hasn't changed
      if (html === entry.lastSavedHtml) return;

      await c2_query(
        `UPDATE pages SET html_content = ?, updated_at = NOW(), updated_by = ? WHERE id = ?`,
        [html, userId, entry.pageId]
      );

      entry.lastSavedHtml = html;
    } catch (err) {
      console.error(`[collab] Save failed for page ${entry.pageId}:`, err);
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
      docs.delete(entry.pageId);
    }
  }, CLEANUP_DELAY_MS);
}

/**
 * Encode awareness state update for broadcasting.
 */
function encodeAwarenessUpdate(entry) {
  const users = [];
  for (const [, meta] of entry.conns) {
    users.push({ id: meta.user.id, name: meta.user.name, color: meta.color });
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
 * - Client connects to ws://host/collab?pageId=<id>&token=<sessionToken>
 * - Server authenticates the token, checks page read/write access
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

  server.on('upgrade', async (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);

    // Only handle /collab path
    if (url.pathname !== '/collab') return;

    // Origin validation to prevent Cross-Site WebSocket Hijacking (CSWSH)
    const origin = request.headers.origin;
    const host = request.headers.host;
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

    const pageId = Number(url.searchParams.get('pageId'));

    if (!pageId || !Number.isInteger(pageId) || pageId <= 0) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    // Upgrade the connection first — auth happens in the first message
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, { pageId });
    });
  });

  wss.on('connection', async (ws, { pageId }) => {
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
      const hasAccess = await checkPageReadAccess(pageId, user);
      if (!hasAccess) {
        ws.close(4003, 'Access denied');
        return;
      }

      const canWrite = Boolean(await checkPageWriteAccess(pageId, user));

      // Auth succeeded — set up the document session
      setupDocSession(ws, user, pageId, canWrite);
    });
  });
}

/**
 * Set up a fully authenticated document editing session.
 */
async function setupDocSession(ws, user, pageId, canWrite) {
    let entry;
    try {
      entry = await getOrCreateDoc(pageId);
    } catch (err) {
      console.error(`[collab] Failed to load doc ${pageId}:`, err);
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

    // Send initial sync: current HTML content
    const xmlFragment = entry.doc.getXmlFragment('document');
    const html = xmlFragmentToHtml(xmlFragment);
    ws.send(JSON.stringify({
      type: 'sync',
      html,
      canWrite,
      user: { id: user.id, name: user.name },
    }));

    // Broadcast updated awareness to all
    broadcastAwareness(entry);

    // Handle incoming messages
    ws.on('message', (data) => {
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

      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }

      // Validate message type is a known string
      if (typeof msg.type !== 'string' || !['update', 'cursor', 'save', 'publish'].includes(msg.type)) {
        return;
      }

      if (msg.type === 'update' && canWrite && typeof msg.html === 'string') {
        // Enforce HTML content size limit
        if (msg.html.length > MAX_HTML_SIZE) {
          ws.send(JSON.stringify({ type: 'error', message: 'Document content exceeds maximum size' }));
          return;
        }
        // Apply the update to the Yjs doc
        const xmlFragment = entry.doc.getXmlFragment('document');
        entry.doc.transact(() => {
          // Clear and replace — for HTML-based sync this is the straightforward approach
          while (xmlFragment.length > 0) xmlFragment.delete(0);
          const textNode = new Y.XmlText();
          textNode.insert(0, msg.html);
          xmlFragment.insert(0, [textNode]);
        });

        // Broadcast to other clients
        broadcastExcept(entry, ws, { type: 'update', html: msg.html, userId: user.id });

        // Schedule debounced save
        scheduleSave(entry, user.id);
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
        // Immediate content save (no version snapshot)
        if (entry.saveTimer) clearTimeout(entry.saveTimer);
        const xmlFragment = entry.doc.getXmlFragment('document');
        const currentHtml = sanitizeHtml(xmlFragmentToHtml(xmlFragment));
        if (currentHtml !== entry.lastSavedHtml) {
          (async () => {
            try {
              await c2_query(
                `UPDATE pages SET html_content = ?, updated_at = NOW(), updated_by = ? WHERE id = ?`,
                [currentHtml, user.id, entry.pageId]
              );
              entry.lastSavedHtml = currentHtml;

              // Notify sender that save completed
              ws.send(JSON.stringify({ type: 'saved' }));
            } catch (err) {
              console.error(`[collab] Immediate save failed for page ${entry.pageId}:`, err);
            }
          })();
        } else {
          ws.send(JSON.stringify({ type: 'saved' }));
        }
      }

      if (msg.type === 'publish' && canWrite) {
        // Validate optional title and notes
        const pubTitle = typeof msg.title === 'string' ? msg.title.trim().slice(0, 255) : null;
        const pubNotes = typeof msg.notes === 'string' ? msg.notes.trim().slice(0, 5000) : null;

        // Check can_publish permission
        (async () => {
          try {
            // Get team context for the page
            const [pageInfo] = await c2_query(
              `SELECT p.team_id, p.created_by AS project_creator FROM pages pg
               INNER JOIN projects p ON pg.project_id = p.id
               WHERE pg.id = ? LIMIT 1`,
              [entry.pageId]
            );

            const publishAllowed = await canPublish(pageInfo?.team_id, pageInfo?.project_creator, user);
            if (!publishAllowed) {
              ws.send(JSON.stringify({ type: 'error', message: 'You do not have permission to publish versions' }));
              return;
            }

            // Publish: save content AND create a formal version snapshot
            if (entry.saveTimer) clearTimeout(entry.saveTimer);
            const xmlFragment = entry.doc.getXmlFragment('document');
            const currentHtml = sanitizeHtml(xmlFragmentToHtml(xmlFragment));

            const [page] = await c2_query(
              `SELECT version FROM pages WHERE id = ? LIMIT 1`,
              [entry.pageId]
            );
            if (!page) return;
            const newVersion = page.version + 1;
            await c2_query(
              `UPDATE pages SET html_content = ?, version = ?, updated_at = NOW(), updated_by = ? WHERE id = ?`,
              [currentHtml, newVersion, user.id, entry.pageId]
            );
            await c2_query(
              `INSERT INTO versions (page_id, version, title, notes, html_content, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
              [entry.pageId, newVersion, pubTitle || null, pubNotes || null, currentHtml, user.id]
            );
            entry.lastSavedHtml = currentHtml;

            // Notify all clients of the new published version
            const versionMsg = JSON.stringify({ type: 'published', version: newVersion, title: pubTitle || null });
            for (const [client] of entry.conns) {
              if (client.readyState === 1) client.send(versionMsg);
            }
          } catch (err) {
            console.error(`[collab] Publish failed for page ${entry.pageId}:`, err);
          }
        })();
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
        scheduleSave(entry, user.id);
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
 * Returns the number of active collaborative sessions (for diagnostics).
 */
export function getActiveDocCount() {
  return docs.size;
}

/**
 * Returns active users for a specific page (for the REST API).
 */
export function getActiveUsers(pageId) {
  const entry = docs.get(pageId);
  if (!entry) return [];
  const users = [];
  for (const [, meta] of entry.conns) {
    users.push({ id: meta.user.id, name: meta.user.name, color: meta.color });
  }
  return users;
}

/**
 * Returns a map of all pages with active users: { [pageId]: [{ id, name, color }] }
 */
export function getAllPresence() {
  const presence = {};
  for (const [pageId, entry] of docs) {
    if (entry.conns.size === 0) continue;
    const users = [];
    for (const [, meta] of entry.conns) {
      users.push({ id: meta.user.id, name: meta.user.name, color: meta.color });
    }
    presence[pageId] = users;
  }
  return presence;
}
