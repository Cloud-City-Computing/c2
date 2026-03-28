/**
 * Ownership-aware access helpers for Cloud Codex
 *
 * Provides SQL WHERE fragments and helpers that cascade access through
 * org ownership and team ownership, ensuring that org owners and team
 * owners always have full access to resources within their scope.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { c2_query } from '../../mysql_connect.js';

/**
 * SQL WHERE fragment for read access, including owner cascade:
 *   1. User is in the project's read_access JSON array
 *   2. User is the project creator
 *   3. User is the org owner (via team → organization)
 *   4. User is a team member with owner role OR can_read permission
 *
 * Use with readAccessParams(user) — always 4 params.
 */
export function readAccessWhere(alias = 'p') {
  return `(
    JSON_CONTAINS(${alias}.read_access, ?) OR ${alias}.created_by = ?
    OR EXISTS (SELECT 1 FROM teams _ot JOIN organizations _oo ON _ot.organization_id = _oo.id WHERE _ot.id = ${alias}.team_id AND _oo.owner = ?)
    OR EXISTS (SELECT 1 FROM team_members _om WHERE _om.team_id = ${alias}.team_id AND _om.user_id = ? AND (_om.role = 'owner' OR _om.can_read = TRUE))
  )`;
}

export function readAccessParams(user) {
  return [JSON.stringify(user.id), user.id, user.email, user.id];
}

/**
 * SQL WHERE fragment for write access, including owner cascade.
 * Same logic as readAccessWhere but checks write_access column.
 * Use with writeAccessParams(user) — always 4 params.
 */
export function writeAccessWhere(alias = 'p') {
  return `(
    JSON_CONTAINS(${alias}.write_access, ?) OR ${alias}.created_by = ?
    OR EXISTS (SELECT 1 FROM teams _ot JOIN organizations _oo ON _ot.organization_id = _oo.id WHERE _ot.id = ${alias}.team_id AND _oo.owner = ?)
    OR EXISTS (SELECT 1 FROM team_members _om WHERE _om.team_id = ${alias}.team_id AND _om.user_id = ? AND (_om.role = 'owner' OR _om.can_write = TRUE))
  )`;
}

export function writeAccessParams(user) {
  return [JSON.stringify(user.id), user.id, user.email, user.id];
}

/**
 * Check if a user is an owner of a project (creator, org owner, or team owner).
 * Used for destructive/management operations (delete project, manage access).
 */
export async function isProjectOwner(user, projectId) {
  const [result] = await c2_query(
    `SELECT 1 FROM projects p
     WHERE p.id = ?
       AND (
         p.created_by = ?
         OR EXISTS (SELECT 1 FROM teams t JOIN organizations o ON t.organization_id = o.id WHERE t.id = p.team_id AND o.owner = ?)
         OR EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = p.team_id AND tm.user_id = ? AND tm.role = 'owner')
       )
     LIMIT 1`,
    [Number(projectId), user.id, user.email, user.id]
  );
  return Boolean(result);
}
