/**
 * Ownership-aware access helpers for Cloud Codex
 *
 * Provides SQL WHERE fragments and helpers that cascade access through
 * workspace ownership and squad ownership, ensuring that workspace owners and squad
 * owners always have full access to resources within their scope.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { c2_query } from '../../mysql_connect.js';

/**
 * SQL WHERE fragment for read access, including owner cascade:
 *   1. User is an admin (full access)
 *   2. User is in the archive's read_access JSON array
 *   3. User is the archive creator
 *   4. User is the workspace owner (via squad → workspace)
 *   5. User is a squad member with owner role OR can_read permission
 *   6. User is a member of a squad listed in read_access_squads
 *   7. read_access_workspace is TRUE and user is in any squad of the same workspace
 *
 * Use with readAccessParams(user) — always 7 params.
 */
export function readAccessWhere(alias = 'p') {
  return `(
    ? = TRUE
    OR JSON_CONTAINS(${alias}.read_access, ?) OR ${alias}.created_by = ?
    OR EXISTS (SELECT 1 FROM squads _ot JOIN workspaces _oo ON _ot.workspace_id = _oo.id WHERE _ot.id = ${alias}.squad_id AND _oo.owner = ?)
    OR EXISTS (SELECT 1 FROM squad_members _om WHERE _om.squad_id = ${alias}.squad_id AND _om.user_id = ? AND (_om.role = 'owner' OR _om.can_read = TRUE))
    OR EXISTS (SELECT 1 FROM squad_members _sm WHERE _sm.user_id = ? AND JSON_CONTAINS(${alias}.read_access_squads, CAST(_sm.squad_id AS JSON)))
    OR (${alias}.read_access_workspace = TRUE AND EXISTS (
      SELECT 1 FROM squads _ws
      JOIN squad_members _wsm ON _wsm.squad_id = _ws.id
      WHERE _ws.workspace_id = (SELECT workspace_id FROM squads WHERE id = ${alias}.squad_id)
        AND _wsm.user_id = ?
    ))
  )`;
}

export function readAccessParams(user) {
  return [Boolean(user.is_admin), JSON.stringify(user.id), user.id, user.email, user.id, user.id, user.id];
}

/**
 * SQL WHERE fragment for write access, including owner cascade.
 * Same logic as readAccessWhere but checks write_access / write_access_squads /
 * write_access_workspace columns.
 * Use with writeAccessParams(user) — always 7 params.
 */
export function writeAccessWhere(alias = 'p') {
  return `(
    ? = TRUE
    OR JSON_CONTAINS(${alias}.write_access, ?) OR ${alias}.created_by = ?
    OR EXISTS (SELECT 1 FROM squads _ot JOIN workspaces _oo ON _ot.workspace_id = _oo.id WHERE _ot.id = ${alias}.squad_id AND _oo.owner = ?)
    OR EXISTS (SELECT 1 FROM squad_members _om WHERE _om.squad_id = ${alias}.squad_id AND _om.user_id = ? AND (_om.role = 'owner' OR _om.can_write = TRUE))
    OR EXISTS (SELECT 1 FROM squad_members _sm WHERE _sm.user_id = ? AND JSON_CONTAINS(${alias}.write_access_squads, CAST(_sm.squad_id AS JSON)))
    OR (${alias}.write_access_workspace = TRUE AND EXISTS (
      SELECT 1 FROM squads _ws
      JOIN squad_members _wsm ON _wsm.squad_id = _ws.id
      WHERE _ws.workspace_id = (SELECT workspace_id FROM squads WHERE id = ${alias}.squad_id)
        AND _wsm.user_id = ?
    ))
  )`;
}

export function writeAccessParams(user) {
  return [Boolean(user.is_admin), JSON.stringify(user.id), user.id, user.email, user.id, user.id, user.id];
}

/**
 * Check if a user is an owner of a archive (creator, workspace owner, or squad owner).
 * Used for destructive/management operations (delete archive, manage access).
 */
export async function isArchiveOwner(user, archiveId) {
  if (user.is_admin) return true;

  const [result] = await c2_query(
    `SELECT 1 FROM archives p
     WHERE p.id = ?
       AND (
         p.created_by = ?
         OR EXISTS (SELECT 1 FROM squads t JOIN workspaces o ON t.workspace_id = o.id WHERE t.id = p.squad_id AND o.owner = ?)
         OR EXISTS (SELECT 1 FROM squad_members tm WHERE tm.squad_id = p.squad_id AND tm.user_id = ? AND tm.role = 'owner')
       )
     LIMIT 1`,
    [Number(archiveId), user.id, user.email, user.id]
  );
  return Boolean(result);
}
