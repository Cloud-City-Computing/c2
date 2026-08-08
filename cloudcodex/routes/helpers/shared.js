/**
 * Shared helpers used across route files and services in Cloud Codex
 *
 * Consolidates common utilities that were previously duplicated in
 * every route file: input validation, async error handling, HTML
 * sanitisation, access checks, permission helpers, and the
 * centralised Express error handler.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import DOMPurify from 'isomorphic-dompurify';
import { c2_query } from '../../mysql_connect.js';
import {
  readAccessWhere,
  readAccessParams,
  writeAccessWhere,
  writeAccessParams,
} from './ownership.js';

// --- Input validation ---

/** Check whether a value is a valid positive integer ID. */
export const isValidId = (id) => Number.isInteger(Number(id)) && Number(id) > 0;

// --- Async route handler ---

/** Wrap an async route handler to forward rejected promises to Express error handling. */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// --- HTML sanitisation ---

/** Sanitize HTML to prevent stored XSS — strips scripts, event handlers, and dangerous URIs */
export function sanitizeHtml(html) {
  if (!html) return '';
  return DOMPurify.sanitize(html, {
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
    // Allow data: URIs only on img tags (for pasted/embedded images)
    ADD_DATA_URI_TAGS: ['img'],
  });
}

// --- Default permissions fallback ---

/** Default permission values for users without a row in the permissions table. */
export const DEFAULT_PERMISSIONS = { create_squad: false, create_archive: false, create_log: true };

// --- Log-level access checks ---

/**
 * Check if a user has read access to a log's parent archive.
 * Returns the matched log row, or undefined if no access.
 */
export async function checkLogReadAccess(logId, user) {
  const [log] = await c2_query(
    `SELECT pg.id
       FROM logs pg
 INNER JOIN archives p ON pg.archive_id = p.id
      WHERE pg.id = ?
        AND ${readAccessWhere('p')}
      LIMIT 1`,
    [logId, ...readAccessParams(user)]
  );
  return log;
}

/**
 * Check if a user has write access to a log's parent archive.
 * Returns the matched log row, or undefined if no access.
 */
export async function checkLogWriteAccess(logId, user) {
  const [log] = await c2_query(
    `SELECT pg.id
       FROM logs pg
 INNER JOIN archives p ON pg.archive_id = p.id
      WHERE pg.id = ?
        AND ${writeAccessWhere('p')}
      LIMIT 1`,
    [logId, ...writeAccessParams(user)]
  );
  return log;
}

// --- Publish permission check ---

/**
 * Check whether a user is allowed to publish versions for a log.
 * Allowed when: no squad context, user is workspace owner, squad owner,
 * archive creator, or has can_publish permission.
 *
 * @param {number} squadId - The squad_id from the log's archive (may be null)
 * @param {number} archiveCreatorId - The created_by of the archive
 * @param {{id: number, email: string}} user
 * @returns {Promise<boolean>}
 */
export async function canPublish(squadId, archiveCreatorId, user) {
  if (!squadId) return true;

  // Admin bypass — admins can always publish
  if (user.is_admin) return true;

  // Workspace owner bypass
  const [orgOwner] = await c2_query(
    `SELECT 1 FROM squads t
     JOIN workspaces o ON t.workspace_id = o.id
     WHERE t.id = ? AND o.owner = ?
     LIMIT 1`,
    [squadId, user.email]
  );
  if (orgOwner) return true;

  // Squad member check
  const [member] = await c2_query(
    `SELECT can_publish, role FROM squad_members WHERE squad_id = ? AND user_id = ? LIMIT 1`,
    [squadId, user.id]
  );
  if (member?.can_publish || member?.role === 'owner') return true;

  // Archive creator bypass
  if (archiveCreatorId === user.id) return true;

  return false;
}

// --- Shared constants ---

export const BCRYPT_ROUNDS = 12;
export const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';
export const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// --- Shared DB operations ---

/**
 * Check if a user has write access to an archive.
 * Returns the archive row { id } or undefined if no access.
 */
export async function checkArchiveWriteAccess(archiveId, user) {
  const [archive] = await c2_query(
    `SELECT p.id FROM archives p
     WHERE p.id = ?
       AND ${writeAccessWhere('p')}
     LIMIT 1`,
    [Number(archiveId), ...writeAccessParams(user)]
  );
  return archive;
}

/**
 * Check if a user has read access to an archive.
 * Returns the archive row { id } or undefined if no access.
 */
export async function checkArchiveReadAccess(archiveId, user) {
  const [archive] = await c2_query(
    `SELECT p.id FROM archives p
     WHERE p.id = ?
       AND ${readAccessWhere('p')}
     LIMIT 1`,
    [Number(archiveId), ...readAccessParams(user)]
  );
  return archive;
}

/**
 * Insert the default permissions row for a new user.
 *
 * @param {number} userId
 * @param {(sql: string, params?: Array) => Promise<Array>} [query] - Query
 *   executor to use, defaults to `c2_query`. Pass the executor handed to a
 *   `withTransaction` callback so this insert joins the caller's transaction.
 */
export async function createDefaultPermissions(userId, query = c2_query) {
  await query(
    `INSERT INTO permissions (user_id, create_squad, create_archive, create_log) VALUES (?, TRUE, TRUE, TRUE)`,
    [userId]
  );
}

/**
 * Insert a squad owner member with full permissions.
 *
 * @param {number} squadId
 * @param {number} userId
 * @param {(sql: string, params?: Array) => Promise<Array>} [query] - Query
 *   executor to use, defaults to `c2_query`. Pass the executor handed to a
 *   `withTransaction` callback so this insert joins the caller's transaction.
 */
export async function addSquadOwnerMember(squadId, userId, query = c2_query) {
  await query(
    `INSERT INTO squad_members (squad_id, user_id, role, can_read, can_write, can_create_log, can_create_archive, can_manage_members, can_delete_version, can_publish)
     VALUES (?, ?, 'owner', TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE)`,
    [squadId, userId]
  );
}

/**
 * Insert a squad member with an explicit role and permission set.
 *
 * `addSquadOwnerMember` is the fixed-permission owner case; this is the
 * general one, used when an invitation carries the membership it grants.
 *
 * @param {number} squadId
 * @param {number} userId
 * @param {{role: string, can_read: boolean, can_write: boolean,
 *          can_create_log: boolean, can_create_archive: boolean,
 *          can_manage_members: boolean, can_delete_version: boolean,
 *          can_publish: boolean}} membership
 * @param {(sql: string, params?: Array) => Promise<Array>} [query] - Query
 *   executor to use, defaults to `c2_query`. Pass the executor handed to a
 *   `withTransaction` callback so this insert joins the caller's transaction.
 */
export async function addSquadMember(squadId, userId, membership, query = c2_query) {
  await query(
    `INSERT INTO squad_members (squad_id, user_id, role, can_read, can_write, can_create_log, can_create_archive, can_manage_members, can_delete_version, can_publish)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      squadId,
      userId,
      membership.role ?? 'member',
      Boolean(membership.can_read),
      Boolean(membership.can_write),
      Boolean(membership.can_create_log),
      Boolean(membership.can_create_archive),
      Boolean(membership.can_manage_members),
      Boolean(membership.can_delete_version),
      Boolean(membership.can_publish),
    ]
  );
}

// --- Centralized error handler ---

/**
 * Express error-handling middleware for route files.
 * Attach with `router.use(errorHandler)` at the end of a router.
 */
export function errorHandler(err, req, res, _next) {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}:`, err);
  res.status(500).json({
    success: false,
    message: 'An internal server error occurred',
  });
}
