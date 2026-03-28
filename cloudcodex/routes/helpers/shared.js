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
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
  });
}

// --- Default permissions fallback ---

/** Default permission values for users without a row in the permissions table. */
export const DEFAULT_PERMISSIONS = { create_team: false, create_project: false, create_page: true };

// --- Page-level access checks ---

/**
 * Check if a user has read access to a page's parent project.
 * Returns the matched page row, or undefined if no access.
 */
export async function checkPageReadAccess(pageId, user) {
  const [page] = await c2_query(
    `SELECT pg.id
       FROM pages pg
 INNER JOIN projects p ON pg.project_id = p.id
      WHERE pg.id = ?
        AND ${readAccessWhere('p')}
      LIMIT 1`,
    [pageId, ...readAccessParams(user)]
  );
  return page;
}

/**
 * Check if a user has write access to a page's parent project.
 * Returns the matched page row, or undefined if no access.
 */
export async function checkPageWriteAccess(pageId, user) {
  const [page] = await c2_query(
    `SELECT pg.id
       FROM pages pg
 INNER JOIN projects p ON pg.project_id = p.id
      WHERE pg.id = ?
        AND ${writeAccessWhere('p')}
      LIMIT 1`,
    [pageId, ...writeAccessParams(user)]
  );
  return page;
}

// --- Publish permission check ---

/**
 * Check whether a user is allowed to publish versions for a page.
 * Allowed when: no team context, user is org owner, team owner,
 * project creator, or has can_publish permission.
 *
 * @param {number} teamId - The team_id from the page's project (may be null)
 * @param {number} projectCreatorId - The created_by of the project
 * @param {{id: number, email: string}} user
 * @returns {Promise<boolean>}
 */
export async function canPublish(teamId, projectCreatorId, user) {
  if (!teamId) return true;

  // Org owner bypass
  const [orgOwner] = await c2_query(
    `SELECT 1 FROM teams t
     JOIN organizations o ON t.organization_id = o.id
     WHERE t.id = ? AND o.owner = ?
     LIMIT 1`,
    [teamId, user.email]
  );
  if (orgOwner) return true;

  // Team member check
  const [member] = await c2_query(
    `SELECT can_publish, role FROM team_members WHERE team_id = ? AND user_id = ? LIMIT 1`,
    [teamId, user.id]
  );
  if (member?.can_publish || member?.role === 'owner') return true;

  // Project creator bypass
  if (projectCreatorId === user.id) return true;

  return false;
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
