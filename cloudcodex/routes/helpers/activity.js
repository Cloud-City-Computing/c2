/**
 * Activity log helper for Cloud Codex
 *
 * Records workspace-scoped events. Caller fires-and-forgets — errors
 * are swallowed and logged via console.error (project format) so a
 * failed activity write never breaks the user's request.
 *
 * Edits to a doc by the same user within COALESCE_WINDOW_SECONDS are
 * collapsed into a single `log.update` row. Other action types are
 * never coalesced.
 *
 * Phase 4 will also fan-out per-resource notifications to watchers
 * inside this helper (via fanOutToWatchers).
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { c2_query } from '../../mysql_connect.js';
import { createNotification } from '../../services/notifications.js';

const UPDATE_COALESCE_WINDOW_SECONDS = 5 * 60;

const WATCH_NOTIFICATION_TYPE = {
  'log.update': 'watched_log_update',
  'log.publish': 'watched_publish',
  'log.restore': 'watched_publish',
  'comment.create': 'watched_comment',
  'comment.reply': 'watched_comment',
};

const AUTO_WATCH_RULES = [
  { action: 'log.create', source: 'auto_create' },
  { action: 'log.update', source: 'auto_edit' },
  { action: 'comment.create', source: 'auto_comment' },
];

/**
 * Record an activity event. Fire-and-forget; never throws.
 *
 * @param {object} ctx
 * @param {{id: number, name?: string}} ctx.user      - actor (req.user)
 * @param {string} ctx.action                          - taxonomy value
 * @param {string} ctx.resourceType                    - 'log'|'archive'|'comment'|'squad'|'version'
 * @param {number} ctx.resourceId
 * @param {object} [ctx.metadata]                      - title snapshot, snippet, etc.
 * @param {number} [ctx.workspaceId]                   - resolved if omitted (best-effort)
 * @param {number} [ctx.squadId]
 */
export function logActivity(ctx) {
  Promise.resolve()
    .then(() => doLogActivity(ctx))
    .catch((err) => {
      console.error(`[${new Date().toISOString()}] activity log failed:`, err);
    });
}

async function doLogActivity(ctx) {
  if (!ctx || !ctx.user?.id || !ctx.action || !ctx.resourceType || !ctx.resourceId) return;

  let { workspaceId, squadId } = ctx;
  if (workspaceId === undefined || workspaceId === null) {
    const resolved = await resolveScope(ctx.resourceType, ctx.resourceId);
    if (!resolved) return;
    workspaceId = resolved.workspace_id;
    squadId = resolved.squad_id ?? null;
  }
  if (!workspaceId) return;

  // Coalesce log.update events from the same user for the same log
  if (ctx.action === 'log.update') {
    const [recent] = await c2_query(
      `SELECT id FROM activity_log
        WHERE workspace_id = ? AND user_id = ?
          AND action = 'log.update'
          AND resource_type = 'log' AND resource_id = ?
          AND created_at > (NOW() - INTERVAL ? SECOND)
        LIMIT 1`,
      [workspaceId, ctx.user.id, ctx.resourceId, UPDATE_COALESCE_WINDOW_SECONDS]
    );
    if (recent) return;
  }

  const metadataJson = ctx.metadata ? JSON.stringify(ctx.metadata) : null;
  await c2_query(
    `INSERT INTO activity_log
       (workspace_id, squad_id, user_id, action, resource_type, resource_id, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [workspaceId, squadId ?? null, ctx.user.id, ctx.action, ctx.resourceType, ctx.resourceId, metadataJson]
  );

  await applyAutoWatch(ctx);
  await fanOutToWatchers(ctx);
}

/**
 * Auto-watch policy:
 *   log.create  → actor watches the new log
 *   log.update  → actor watches the log (idempotent)
 *   comment.create → actor watches the parent log (idempotent)
 */
async function applyAutoWatch(ctx) {
  const rule = AUTO_WATCH_RULES.find((r) => r.action === ctx.action);
  if (!rule) return;

  let logId = null;
  if (ctx.resourceType === 'log') {
    logId = ctx.resourceId;
  } else if (ctx.resourceType === 'comment') {
    const meta = ctx.metadata || {};
    logId = meta.log_id;
    if (!logId) {
      const [row] = await c2_query(
        `SELECT log_id FROM comments WHERE id = ? LIMIT 1`,
        [ctx.resourceId]
      );
      logId = row?.log_id || null;
    }
  }
  if (!logId) return;

  await c2_query(
    `INSERT IGNORE INTO watches (user_id, resource_type, resource_id, source)
     VALUES (?, 'log', ?, ?)`,
    [ctx.user.id, logId, rule.source]
  );
}

/**
 * Resolve the set of users who should be notified about an activity event:
 *   - direct watchers of the log
 *   - watchers of the parent archive (cascade)
 * Excludes the actor.
 */
async function collectWatchers(logId) {
  const watcherIds = new Set();
  if (!logId) return watcherIds;

  const direct = await c2_query(
    `SELECT user_id FROM watches WHERE resource_type = 'log' AND resource_id = ?`,
    [logId]
  );
  direct.forEach((row) => watcherIds.add(row.user_id));

  const [logRow] = await c2_query(
    `SELECT archive_id FROM logs WHERE id = ? LIMIT 1`,
    [logId]
  );
  if (logRow?.archive_id) {
    const arch = await c2_query(
      `SELECT user_id FROM watches WHERE resource_type = 'archive' AND resource_id = ?`,
      [logRow.archive_id]
    );
    arch.forEach((row) => watcherIds.add(row.user_id));
  }

  return watcherIds;
}

function watchVerb(action) {
  switch (action) {
    case 'log.update':     return 'edited';
    case 'log.publish':    return 'published';
    case 'log.restore':    return 'restored';
    case 'comment.create': return 'commented on';
    case 'comment.reply':  return 'replied on';
    default: return 'updated';
  }
}

async function fanOutToWatchers(ctx) {
  const notificationType = WATCH_NOTIFICATION_TYPE[ctx.action];
  if (!notificationType) return;

  let logId = null;
  if (ctx.resourceType === 'log') logId = ctx.resourceId;
  else if (ctx.resourceType === 'comment') logId = ctx.metadata?.log_id;
  if (!logId) return;

  const [logRow] = await c2_query(
    `SELECT id, title FROM logs WHERE id = ? LIMIT 1`,
    [logId]
  );
  if (!logRow) return;

  const watchers = await collectWatchers(logId);
  if (watchers.size === 0) return;

  const docTitle = logRow.title || ctx.metadata?.title || 'Untitled';
  const linkUrl = ctx.resourceType === 'comment'
    ? `/editor/${logId}#comment-${ctx.resourceId}`
    : `/editor/${logId}`;
  const actorName = ctx.user?.name || 'Someone';
  const verb = watchVerb(ctx.action);
  const snippet = ctx.metadata?.snippet || null;

  for (const watcherId of watchers) {
    if (watcherId === ctx.user.id) continue;
    await createNotification({
      recipientId: watcherId,
      actorId: ctx.user.id,
      type: notificationType,
      title: `${actorName} ${verb} “${docTitle}”`,
      body: snippet,
      linkUrl,
      resourceType: 'log',
      resourceId: logId,
      metadata: { action: ctx.action },
      emailData: { actorName, docTitle, snippet, linkUrl },
    });
  }
}

/**
 * Resolve the (workspace_id, squad_id) for a given resource so the
 * caller doesn't have to pass them on every call. Falls back through
 * the parent chain log → archive → squad → workspace.
 */
async function resolveScope(resourceType, resourceId) {
  if (resourceType === 'log') {
    const [row] = await c2_query(
      `SELECT s.workspace_id AS workspace_id, p.squad_id AS squad_id
         FROM logs l
   INNER JOIN archives p ON l.archive_id = p.id
   INNER JOIN squads s ON p.squad_id = s.id
        WHERE l.id = ?
        LIMIT 1`,
      [resourceId]
    );
    return row || null;
  }
  if (resourceType === 'archive') {
    const [row] = await c2_query(
      `SELECT s.workspace_id AS workspace_id, p.squad_id AS squad_id
         FROM archives p
   INNER JOIN squads s ON p.squad_id = s.id
        WHERE p.id = ?
        LIMIT 1`,
      [resourceId]
    );
    return row || null;
  }
  if (resourceType === 'comment') {
    const [row] = await c2_query(
      `SELECT s.workspace_id AS workspace_id, p.squad_id AS squad_id, l.id AS log_id
         FROM comments c
   INNER JOIN logs l ON c.log_id = l.id
   INNER JOIN archives p ON l.archive_id = p.id
   INNER JOIN squads s ON p.squad_id = s.id
        WHERE c.id = ?
        LIMIT 1`,
      [resourceId]
    );
    return row || null;
  }
  if (resourceType === 'squad') {
    const [row] = await c2_query(
      `SELECT workspace_id AS workspace_id, id AS squad_id FROM squads WHERE id = ? LIMIT 1`,
      [resourceId]
    );
    return row || null;
  }
  if (resourceType === 'version') {
    const [row] = await c2_query(
      `SELECT s.workspace_id AS workspace_id, p.squad_id AS squad_id
         FROM versions v
   INNER JOIN logs l ON v.log_id = l.id
   INNER JOIN archives p ON l.archive_id = p.id
   INNER JOIN squads s ON p.squad_id = s.id
        WHERE v.id = ?
        LIMIT 1`,
      [resourceId]
    );
    return row || null;
  }
  return null;
}
