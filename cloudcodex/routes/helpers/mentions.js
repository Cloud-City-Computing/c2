/**
 * Mention extraction and notification fan-out for Cloud Codex
 *
 * Parses HTML for mention nodes (`<span data-mention-user-id="42">`),
 * diffs against the previous content, and fires a notification via
 * services/notifications.js for each newly-added recipient that has
 * read access to the document.
 *
 * Mentions inside <code>, <pre>, <script>, and <style> blocks are
 * intentionally ignored.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { c2_query } from '../../mysql_connect.js';
import { checkLogReadAccess } from './shared.js';
import { createNotification } from '../../services/notifications.js';

const MENTION_ATTR_RE = /data-mention-user-id="(\d+)"/g;

/**
 * Strip blocks where mentions should NOT trigger:
 * <pre>, <code>, <script>, <style>. Operates on raw HTML — this is
 * server-sanitized HTML emitted by Tiptap, so the structure is well-formed.
 */
function stripIgnoredBlocks(html) {
  if (!html) return '';
  return String(html)
    .replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, '')
    .replace(/<code\b[^>]*>[\s\S]*?<\/code>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
}

/**
 * Extract the set of user IDs mentioned in a chunk of HTML.
 * Returns Set<number>.
 */
export function extractMentions(html) {
  const ids = new Set();
  if (!html) return ids;
  const stripped = stripIgnoredBlocks(html);
  let m;
  MENTION_ATTR_RE.lastIndex = 0;
  while ((m = MENTION_ATTR_RE.exec(stripped)) !== null) {
    const id = Number(m[1]);
    if (Number.isInteger(id) && id > 0) ids.add(id);
  }
  return ids;
}

/**
 * Compute newly-added mentions between two HTML strings.
 * Returns Set<number> of recipient user IDs present in newHtml but not in prevHtml.
 */
export function diffMentions(prevHtml, newHtml) {
  const before = extractMentions(prevHtml);
  const after = extractMentions(newHtml);
  const added = new Set();
  for (const id of after) {
    if (!before.has(id)) added.add(id);
  }
  return added;
}

/**
 * Plain-text snippet of context surrounding a mention, for inbox preview / email.
 * Returns up to ~160 characters around the first mention of the user.
 */
export function extractContextSnippet(html, userId) {
  if (!html) return null;
  const stripped = stripIgnoredBlocks(html);
  const re = new RegExp(`data-mention-user-id="${userId}"[^>]*>([^<]*)<`, 'i');
  const match = stripped.match(re);
  // Plain-text fallback: take ~120 chars from the document, mention-aware
  const plain = stripped
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!match) return plain.slice(0, 160) || null;
  // Locate the mention text in plain
  const tag = match[1] ? `@${match[1].replace(/^@/, '')}` : '';
  const idx = tag ? plain.indexOf(tag) : -1;
  if (idx < 0) return plain.slice(0, 160) || null;
  const start = Math.max(0, idx - 60);
  const end = Math.min(plain.length, idx + 100);
  let snippet = plain.slice(start, end);
  if (start > 0) snippet = `…${snippet}`;
  if (end < plain.length) snippet = `${snippet}…`;
  return snippet;
}

async function getRecipientUser(userId) {
  const [row] = await c2_query(
    `SELECT id, name, email, is_admin FROM users WHERE id = ? LIMIT 1`,
    [userId]
  );
  return row || null;
}

/**
 * Process mention notifications for a document save.
 * Diffs prevHtml vs newHtml; for each newly added mention, sends a
 * notification when the recipient has read access.
 *
 * Errors are swallowed (logged) so a notification failure never breaks
 * a save. Self-mentions are filtered out by createNotification().
 *
 * @param {object} ctx
 * @param {number} ctx.logId
 * @param {string|null} ctx.prevHtml
 * @param {string} ctx.newHtml
 * @param {{id: number, name: string}} ctx.actor
 * @param {{title: string, archive_id?: number}} ctx.docMeta
 * @param {string} [ctx.linkUrl]    - override the default /editor/:logId link
 * @param {string} [ctx.notificationType] - default 'mention'; comments use 'mention'
 */
export async function processMentionsOnSave(ctx) {
  try {
    const added = diffMentions(ctx.prevHtml, ctx.newHtml);
    if (added.size === 0) return 0;

    const actorName = ctx.actor?.name || 'Someone';
    const docTitle = ctx.docMeta?.title || 'Untitled';
    const linkUrl = ctx.linkUrl || `/editor/${ctx.logId}`;
    const type = ctx.notificationType || 'mention';

    let sent = 0;
    for (const userId of added) {
      if (userId === ctx.actor?.id) continue;

      const recipient = await getRecipientUser(userId);
      if (!recipient) continue;

      const canRead = await checkLogReadAccess(ctx.logId, recipient);
      if (!canRead) continue;

      const snippet = extractContextSnippet(ctx.newHtml, userId);

      await createNotification({
        recipientId: userId,
        actorId: ctx.actor?.id || null,
        type,
        title: `${actorName} mentioned you in “${docTitle}”`,
        body: snippet,
        linkUrl,
        resourceType: 'log',
        resourceId: ctx.logId,
        metadata: ctx.docMeta?.archive_id ? { archive_id: ctx.docMeta.archive_id } : null,
        emailData: { actorName, docTitle, snippet, linkUrl },
      });
      sent++;
    }
    return sent;
  } catch (err) {
    console.error(`[${new Date().toISOString()}] processMentionsOnSave failed:`, err);
    return 0;
  }
}
