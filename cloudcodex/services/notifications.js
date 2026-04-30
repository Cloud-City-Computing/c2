/**
 * Notification service for Cloud Codex
 *
 * The single funnel for every user-facing alert (mentions, comments,
 * watched-doc activity, squad invites). Handles persistence, WebSocket
 * push to the user's open tabs, optional email delivery, self-event
 * suppression, and a 60-second coalescing window so quick repeats of
 * the same (recipient, type, resource) don't flood the inbox.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { c2_query } from '../mysql_connect.js';
import { sendEmail } from './email.js';
import { broadcastToUser } from './user-channel.js';
import { buildNotificationEmail } from './email-templates.js';
import { sanitizeHtml } from '../routes/helpers/shared.js';

const COALESCE_WINDOW_SECONDS = 60;

/**
 * Default email-on/off per notification type. A user with NULL
 * notification_prefs gets these defaults; a user with a JSON object
 * overrides per-key.
 */
export const DEFAULT_EMAIL_PREFS = Object.freeze({
  email_mention: true,
  email_comment_on_my_doc: true,
  email_watched_comment: true,
  email_watched_publish: true,
  email_watched_log_update: false,
  email_squad_invite: true,
});

function emailPrefKey(type) {
  return `email_${type}`;
}

function shouldEmail(prefs, type) {
  const key = emailPrefKey(type);
  if (prefs && Object.prototype.hasOwnProperty.call(prefs, key)) {
    return Boolean(prefs[key]);
  }
  return DEFAULT_EMAIL_PREFS[key] === true;
}

async function getRecipient(userId) {
  const [row] = await c2_query(
    `SELECT id, name, email, notification_prefs FROM users WHERE id = ? LIMIT 1`,
    [userId]
  );
  if (!row) return null;
  let prefs = null;
  if (row.notification_prefs) {
    try {
      prefs = typeof row.notification_prefs === 'string'
        ? JSON.parse(row.notification_prefs)
        : row.notification_prefs;
    } catch {
      prefs = null;
    }
  }
  return { id: row.id, name: row.name, email: row.email, prefs };
}

/**
 * Create a notification for a single recipient.
 * Self-suppressed: returns null if recipientId === actorId.
 * Coalesced: no-op if a row with the same (recipient, type, resource)
 *   was created within the last 60 seconds.
 *
 * @param {object} args
 * @param {number} args.recipientId
 * @param {number|null} [args.actorId]
 * @param {string} args.type
 * @param {string} args.title
 * @param {string} [args.body]
 * @param {string} [args.linkUrl]
 * @param {string} [args.resourceType]
 * @param {number} [args.resourceId]
 * @param {object} [args.metadata]
 * @param {object} [args.emailData] - extra fields for the email template
 * @returns {Promise<object|null>}
 */
export async function createNotification(args) {
  const {
    recipientId,
    actorId = null,
    type,
    title,
    body = null,
    linkUrl = null,
    resourceType = null,
    resourceId = null,
    metadata = null,
    emailData = null,
  } = args;

  if (!recipientId || !type || !title) return null;
  if (actorId && actorId === recipientId) return null;

  // Coalesce: same recipient+type+resource within window → skip
  if (resourceType && resourceId) {
    const [existing] = await c2_query(
      `SELECT id FROM notifications
        WHERE user_id = ? AND type = ?
          AND resource_type = ? AND resource_id = ?
          AND created_at > (NOW() - INTERVAL ? SECOND)
        LIMIT 1`,
      [recipientId, type, resourceType, resourceId, COALESCE_WINDOW_SECONDS]
    );
    if (existing) return null;
  }

  // Defense-in-depth: even though every render path escapes (React,
  // email-templates), strip HTML on the way in so stored values are
  // safe regardless of how a future caller renders them.
  const safeTitle = sanitizeHtml(String(title)).replace(/<[^>]+>/g, '').slice(0, 255);
  const safeBody = body ? sanitizeHtml(String(body)).slice(0, 2000) : null;
  const metadataJson = metadata ? JSON.stringify(metadata) : null;

  const result = await c2_query(
    `INSERT INTO notifications
       (user_id, type, actor_id, title, body, link_url, resource_type, resource_id, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [recipientId, type, actorId, safeTitle, safeBody, linkUrl, resourceType, resourceId, metadataJson]
  );
  const id = result?.insertId ?? null;

  const row = {
    id,
    user_id: recipientId,
    type,
    actor_id: actorId,
    title: safeTitle,
    body: safeBody,
    link_url: linkUrl,
    resource_type: resourceType,
    resource_id: resourceId,
    metadata,
    read_at: null,
    created_at: new Date().toISOString(),
  };

  // Fire-and-forget WS push (no await)
  try {
    broadcastToUser(recipientId, { type: 'notification', notification: row });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] notification ws push failed:`, err);
  }

  // Fire-and-forget email send if prefs allow
  void deliverEmail(recipientId, type, emailData).catch((err) => {
    console.error(`[${new Date().toISOString()}] notification email failed:`, err);
  });

  return row;
}

async function deliverEmail(recipientId, type, emailData) {
  const recipient = await getRecipient(recipientId);
  if (!recipient || !recipient.email) return;
  if (!shouldEmail(recipient.prefs, type)) return;

  const tpl = buildNotificationEmail(type, {
    recipientName: recipient.name,
    ...(emailData || {}),
  });
  if (!tpl) return;

  await sendEmail({
    to: recipient.email,
    subject: tpl.subject,
    text: tpl.text,
    html: tpl.html,
  });
}

/**
 * Mark a single notification read. Idempotent. Only operates on rows
 * owned by the calling user.
 */
export async function markRead(notificationId, userId) {
  await c2_query(
    `UPDATE notifications SET read_at = NOW()
      WHERE id = ? AND user_id = ? AND read_at IS NULL`,
    [notificationId, userId]
  );
  try {
    broadcastToUser(userId, { type: 'read', id: Number(notificationId) });
  } catch {
    // ignore
  }
}

/** Mark all of a user's unread notifications read. */
export async function markAllRead(userId) {
  await c2_query(
    `UPDATE notifications SET read_at = NOW()
      WHERE user_id = ? AND read_at IS NULL`,
    [userId]
  );
  try {
    broadcastToUser(userId, { type: 'read_all' });
  } catch {
    // ignore
  }
}

/** Get the unread count for a user (for the badge). */
export async function getUnreadCount(userId) {
  const [row] = await c2_query(
    `SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND read_at IS NULL`,
    [userId]
  );
  return Number(row?.unread || 0);
}

/**
 * List a user's notifications, newest first. Cursor pagination via
 * `before` (an ISO date string) — pass the oldest created_at from the
 * previous page to fetch the next.
 */
export function listForUser(userId, { limit = 20, before, unreadOnly } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
  const params = [userId];
  let where = `n.user_id = ?`;

  if (unreadOnly) {
    where += ` AND n.read_at IS NULL`;
  }
  if (before) {
    where += ` AND n.created_at < ?`;
    params.push(before);
  }

  params.push(String(safeLimit));

  return c2_query(
    `SELECT n.id, n.user_id, n.type, n.actor_id, n.title, n.body, n.link_url,
            n.resource_type, n.resource_id, n.metadata, n.read_at, n.created_at,
            u.name AS actor_name, u.avatar_url AS actor_avatar
       FROM notifications n
  LEFT JOIN users u ON n.actor_id = u.id
      WHERE ${where}
      ORDER BY n.created_at DESC
      LIMIT ?`,
    params
  );
}

/** Get user's notification preferences (merged with defaults). */
export async function getPrefs(userId) {
  const [row] = await c2_query(
    `SELECT notification_prefs FROM users WHERE id = ? LIMIT 1`,
    [userId]
  );
  let stored = null;
  if (row?.notification_prefs) {
    try {
      stored = typeof row.notification_prefs === 'string'
        ? JSON.parse(row.notification_prefs)
        : row.notification_prefs;
    } catch {
      stored = null;
    }
  }
  return { ...DEFAULT_EMAIL_PREFS, ...(stored || {}) };
}

/** Update a user's notification preferences. */
export async function setPrefs(userId, prefs) {
  // Whitelist: only persist known keys, only boolean values.
  const next = {};
  for (const key of Object.keys(DEFAULT_EMAIL_PREFS)) {
    if (Object.prototype.hasOwnProperty.call(prefs, key)) {
      next[key] = Boolean(prefs[key]);
    }
  }
  await c2_query(
    `UPDATE users SET notification_prefs = ? WHERE id = ?`,
    [JSON.stringify(next), userId]
  );
  return { ...DEFAULT_EMAIL_PREFS, ...next };
}
