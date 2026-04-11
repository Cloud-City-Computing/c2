/**
 * API routes for archive and log navigation in Cloud Codex
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import { c2_query } from '../mysql_connect.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { readAccessWhere, readAccessParams, writeAccessWhere, writeAccessParams, isArchiveOwner } from './helpers/ownership.js';
import { isValidId, asyncHandler, errorHandler } from './helpers/shared.js';

const router = express.Router();

/** Safely parse a value that may already be a JS array (mysql2 JSON columns) or a JSON string. */
function parseJsonArray(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') { try { return JSON.parse(val); } catch { return []; } }
  return [];
}

// --- Routes ---

/**
 * GET /api/archives
 * Returns all archives the authenticated user has read access to
 */
router.get('/archives', requireAuth, asyncHandler(async (req, res) => {
  const archives = await c2_query(
    `SELECT p.id,
            p.name,
            p.created_at,
            u.name AS created_by,
            p.created_by AS created_by_id,
            t.name AS squad_name,
            t.id AS squad_id,
            o.id AS workspace_id,
            o.name AS workspace_name
     FROM archives p
     LEFT JOIN users u  ON p.created_by  = u.id
     LEFT JOIN squads t  ON p.squad_id     = t.id
     LEFT JOIN workspaces o ON t.workspace_id = o.id
     WHERE ${readAccessWhere('p')}
     ORDER BY p.created_at DESC`,
    [...readAccessParams(req.user)]
  );

  res.json({ success: true, archives });
}));

/**
 * GET /api/archives/:archiveId/logs
 * Returns the log tree for a archive the user has access to
 */
router.get('/archives/:archiveId/logs', requireAuth, asyncHandler(async (req, res) => {
  const { archiveId } = req.params;
  if (!isValidId(archiveId)) {
    return res.status(400).json({ success: false, message: 'Invalid archiveId' });
  }

  // Verify user has read access to the archive
  const [archive] = await c2_query(
    `SELECT p.id FROM archives p
     WHERE p.id = ?
       AND ${readAccessWhere('p')}
     LIMIT 1`,
    [Number(archiveId), ...readAccessParams(req.user)]
  );

  if (!archive) return res.status(403).json({ success: false, message: 'Access denied' });

  const logs = await c2_query(
    `SELECT p.id,
            p.title,
            p.parent_id,
            p.version,
            p.created_at,
            p.updated_at,
            u.name AS created_by,
            p.archive_id
     FROM logs p
     LEFT JOIN users u ON p.created_by = u.id
     WHERE p.archive_id = ?
     ORDER BY p.parent_id ASC, p.created_at ASC`,
    [Number(archiveId)]
  );

  // Build a nested tree from the flat list
  const map = {};
  const roots = [];
  logs.forEach(log => { map[log.id] = { ...log, children: [] }; });
  logs.forEach(log => {
    if (log.parent_id && map[log.parent_id]) {
      map[log.parent_id].children.push(map[log.id]);
    } else {
      roots.push(map[log.id]);
    }
  });

  res.json({ success: true, logs: roots });
}));

/**
 * POST /api/archives
 * Creates a new archive (requires create_archive permission)
 */
router.post('/archives', requireAuth, requirePermission('create_archive'), asyncHandler(async (req, res) => {
  const { name, squad_id } = req.body;
  if (!name?.trim()) {
    return res.status(400).json({ success: false, message: 'Archive name is required' });
  }
  if (name.trim().length > 255) {
    return res.status(400).json({ success: false, message: 'Archive name must be 255 characters or less' });
  }
  if (squad_id !== undefined && squad_id !== null && !isValidId(squad_id)) {
    return res.status(400).json({ success: false, message: 'Invalid squad_id' });
  }

  const result = await c2_query(
    `INSERT INTO archives (name, squad_id, created_by, read_access, write_access)
     VALUES (?, ?, ?, JSON_ARRAY(?), JSON_ARRAY(?))`,
    [name.trim(), squad_id ?? null, req.user.id, req.user.id, req.user.id]
  );

  res.status(201).json({ success: true, archiveId: result.insertId });
}));

/**
 * PUT /api/archives/:id
 * Rename a archive (write_access required)
 */
router.put('/archives/:id', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: 'Invalid archiveId' });
  }

  const { name } = req.body;
  if (!name?.trim()) {
    return res.status(400).json({ success: false, message: 'Archive name is required' });
  }
  if (name.trim().length > 255) {
    return res.status(400).json({ success: false, message: 'Archive name must be 255 characters or less' });
  }

  const [archive] = await c2_query(
    `SELECT p.id FROM archives p
     WHERE p.id = ?
       AND ${writeAccessWhere('p')}
     LIMIT 1`,
    [Number(id), ...writeAccessParams(req.user)]
  );
  if (!archive) return res.status(403).json({ success: false, message: 'Write access denied' });

  await c2_query(`UPDATE archives SET name = ? WHERE id = ?`, [name.trim(), Number(id)]);
  res.json({ success: true });
}));

/**
 * DELETE /api/archives/:id
 * Delete a archive (creator only, cascades)
 */
router.delete('/archives/:id', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: 'Invalid archiveId' });
  }

  const allowed = await isArchiveOwner(req.user, id);
  if (!allowed) return res.status(403).json({ success: false, message: 'Only a archive or squad owner can delete this archive' });

  await c2_query(`DELETE FROM archives WHERE id = ?`, [Number(id)]);
  res.json({ success: true });
}));

/**
 * POST /api/archives/:id/access
 * Add/remove user, squad, or workspace-level access.
 * Body (user):      { userId, accessType: 'read'|'write', action: 'add'|'remove' }
 * Body (squad):     { squadId, accessType: 'read'|'write', action: 'add'|'remove' }
 * Body (workspace): { workspace: true, accessType: 'read'|'write', action: 'add'|'remove' }
 */
router.post('/archives/:id/access', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: 'Invalid archiveId' });
  }

  const { userId, squadId, workspace, accessType, action } = req.body;
  if (!['read', 'write'].includes(accessType) || !['add', 'remove'].includes(action)) {
    return res.status(400).json({ success: false, message: 'Invalid parameters' });
  }

  // Determine target type
  const hasUser = userId !== undefined && userId !== null;
  const hasSquad = squadId !== undefined && squadId !== null;
  const hasWorkspace = workspace === true;

  // Exactly one target type must be provided
  const targetCount = [hasUser, hasSquad, hasWorkspace].filter(Boolean).length;
  if (targetCount !== 1) {
    return res.status(400).json({ success: false, message: 'Provide exactly one of userId, squadId, or workspace' });
  }

  if (hasUser && !isValidId(userId)) {
    return res.status(400).json({ success: false, message: 'Invalid userId' });
  }
  if (hasSquad && !isValidId(squadId)) {
    return res.status(400).json({ success: false, message: 'Invalid squadId' });
  }

  // Only archive/squad/workspace owners can manage access
  const allowed = await isArchiveOwner(req.user, id);
  if (!allowed) return res.status(403).json({ success: false, message: 'Only a archive or squad owner can manage access' });

  if (hasWorkspace) {
    // Toggle the workspace-level boolean
    const column = accessType === 'read' ? 'read_access_workspace' : 'write_access_workspace';
    const value = action === 'add';
    await c2_query(`UPDATE archives SET ${column} = ? WHERE id = ?`, [value, Number(id)]);
  } else if (hasSquad) {
    // Modify the squad access JSON array
    const column = accessType === 'read' ? 'read_access_squads' : 'write_access_squads';
    const [proj] = await c2_query(`SELECT ${column} AS acl FROM archives WHERE id = ?`, [Number(id)]);
    const arr = parseJsonArray(proj.acl);
    const targetSid = Number(squadId);

    if (action === 'add') {
      if (!arr.includes(targetSid)) {
        arr.push(targetSid);
        await c2_query(`UPDATE archives SET ${column} = ? WHERE id = ?`, [JSON.stringify(arr), Number(id)]);
      }
    } else {
      const filtered = arr.filter(sid => sid !== targetSid);
      if (filtered.length !== arr.length) {
        await c2_query(`UPDATE archives SET ${column} = ? WHERE id = ?`, [JSON.stringify(filtered), Number(id)]);
      }
    }
  } else {
    // User-level access (original behaviour)
    const column = accessType === 'read' ? 'read_access' : 'write_access';
    const [proj] = await c2_query(`SELECT ${column} AS acl FROM archives WHERE id = ?`, [Number(id)]);
    const arr = parseJsonArray(proj.acl);
    const targetUid = Number(userId);

    if (action === 'add') {
      if (!arr.includes(targetUid)) {
        arr.push(targetUid);
        await c2_query(`UPDATE archives SET ${column} = ? WHERE id = ?`, [JSON.stringify(arr), Number(id)]);
      }
    } else {
      const filtered = arr.filter(uid => uid !== targetUid);
      if (filtered.length !== arr.length) {
        await c2_query(`UPDATE archives SET ${column} = ? WHERE id = ?`, [JSON.stringify(filtered), Number(id)]);
      }
    }
  }

  res.json({ success: true });
}));

/**
 * GET /api/archives/:id/access
 * Returns the current access configuration for an archive (read access required).
 * Includes owner squad members (inherited access) and explicit grants.
 */
router.get('/archives/:id/access', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: 'Invalid archiveId' });
  }

  const [hasAccess] = await c2_query(
    `SELECT p.id FROM archives p WHERE p.id = ? AND ${readAccessWhere('p')} LIMIT 1`,
    [Number(id), ...readAccessParams(req.user)]
  );
  if (!hasAccess) return res.status(403).json({ success: false, message: 'Access denied' });

  const [archive] = await c2_query(
    `SELECT a.read_access, a.write_access,
            a.read_access_squads, a.write_access_squads,
            a.read_access_workspace, a.write_access_workspace,
            a.squad_id, a.created_by,
            u.name AS created_by_name
     FROM archives a
     LEFT JOIN users u ON a.created_by = u.id
     WHERE a.id = ?`,
    [Number(id)]
  );
  if (!archive) return res.status(404).json({ success: false, message: 'Archive not found' });

  const readUserIds = parseJsonArray(archive.read_access);
  const writeUserIds = parseJsonArray(archive.write_access);
  const readSquadIds = parseJsonArray(archive.read_access_squads);
  const writeSquadIds = parseJsonArray(archive.write_access_squads);

  // Resolve user names
  let readUsers = [];
  let writeUsers = [];
  const allUserIds = [...new Set([...readUserIds, ...writeUserIds])];
  if (allUserIds.length > 0) {
    const users = await c2_query(
      `SELECT id, name, email FROM users WHERE id IN (${allUserIds.map(() => '?').join(',')})`,
      allUserIds
    );
    const userMap = Object.fromEntries(users.map(u => [u.id, u]));
    readUsers = readUserIds.map(uid => userMap[uid]).filter(Boolean);
    writeUsers = writeUserIds.map(uid => userMap[uid]).filter(Boolean);
  }

  // Resolve squad names
  let readSquads = [];
  let writeSquads = [];
  const allSquadIds = [...new Set([...readSquadIds, ...writeSquadIds])];
  if (allSquadIds.length > 0) {
    const squads = await c2_query(
      `SELECT id, name FROM squads WHERE id IN (${allSquadIds.map(() => '?').join(',')})`,
      allSquadIds
    );
    const squadMap = Object.fromEntries(squads.map(s => [s.id, s]));
    readSquads = readSquadIds.map(sid => squadMap[sid]).filter(Boolean);
    writeSquads = writeSquadIds.map(sid => squadMap[sid]).filter(Boolean);
  }

  // Get available squads in the same workspace (for the UI picker)
  let workspaceSquads = [];
  if (archive.squad_id) {
    workspaceSquads = await c2_query(
      `SELECT s.id, s.name FROM squads s
       WHERE s.workspace_id = (SELECT workspace_id FROM squads WHERE id = ?)
       ORDER BY s.name`,
      [archive.squad_id]
    );
  }

  // Collect user IDs covered by granted squad membership (read or write squads)
  let grantedSquadUserIds = [];
  const grantedSquadIds = [...new Set([...readSquadIds, ...writeSquadIds])];
  if (grantedSquadIds.length > 0) {
    const members = await c2_query(
      `SELECT DISTINCT sm.user_id FROM squad_members sm
       WHERE sm.squad_id IN (${grantedSquadIds.map(() => '?').join(',')})`,
      grantedSquadIds
    );
    grantedSquadUserIds = members.map(m => m.user_id);
  }

  // Also include owner squad member IDs as covered
  let ownerSquadMembers = [];
  let ownerSquadName = null;
  if (archive.squad_id) {
    const [squad] = await c2_query(`SELECT name FROM squads WHERE id = ?`, [archive.squad_id]);
    ownerSquadName = squad?.name || null;
    ownerSquadMembers = await c2_query(
      `SELECT sm.user_id, u.name, u.email, sm.role, sm.can_read, sm.can_write
       FROM squad_members sm
       JOIN users u ON sm.user_id = u.id
       WHERE sm.squad_id = ?
       ORDER BY sm.role DESC, u.name ASC`,
      [archive.squad_id]
    );
    const ownerMemberIds = ownerSquadMembers.map(m => m.user_id);
    grantedSquadUserIds = [...new Set([...grantedSquadUserIds, ...ownerMemberIds])];
  }

  res.json({
    success: true,
    access: {
      read_users: readUsers,
      write_users: writeUsers,
      read_squads: readSquads,
      write_squads: writeSquads,
      read_workspace: Boolean(archive.read_access_workspace),
      write_workspace: Boolean(archive.write_access_workspace),
      squad_id: archive.squad_id,
      workspace_squads: workspaceSquads,
      owner_squad_name: ownerSquadName,
      owner_squad_members: ownerSquadMembers,
      granted_squad_user_ids: grantedSquadUserIds,
      created_by: archive.created_by,
      created_by_name: archive.created_by_name,
    },
  });
}));

/**
 * POST /api/archives/:archiveId/logs
 * Creates a new log inside a archive (requires create_log permission)
 */
router.post('/archives/:archiveId/logs', requireAuth, requirePermission('create_log'), asyncHandler(async (req, res) => {
  const { archiveId } = req.params;
  if (!isValidId(archiveId)) {
    return res.status(400).json({ success: false, message: 'Invalid archiveId' });
  }

  const { title, parent_id } = req.body;
  if (!title?.trim()) {
    return res.status(400).json({ success: false, message: 'Log title is required' });
  }

  const parentId = parent_id ? Number(parent_id) : null;
  if (parentId !== null && !isValidId(parentId)) {
    return res.status(400).json({ success: false, message: 'Invalid parent_id' });
  }

  // Verify write access
  const [archive] = await c2_query(
    `SELECT p.id FROM archives p
     WHERE p.id = ?
       AND ${writeAccessWhere('p')}
     LIMIT 1`,
    [Number(archiveId), ...writeAccessParams(req.user)]
  );

  if (!archive) return res.status(403).json({ success: false, message: 'Write access denied' });

  const result = await c2_query(
    `INSERT INTO logs (archive_id, title, html_content, parent_id, created_by, updated_by)
     VALUES (?, ?, '', ?, ?, ?)`,
    [Number(archiveId), title.trim(), parentId, req.user.id, req.user.id]
  );

  res.status(201).json({ success: true, logId: result.insertId });
}));

/**
 * PUT /api/archives/:archiveId/logs/:logId
 * Rename or move a log (write_access required)
 */
router.put('/archives/:archiveId/logs/:logId', requireAuth, asyncHandler(async (req, res) => {
  const { archiveId, logId } = req.params;
  if (!isValidId(archiveId) || !isValidId(logId)) {
    return res.status(400).json({ success: false, message: 'Invalid IDs' });
  }

  const { title, parent_id } = req.body;

  const [archive] = await c2_query(
    `SELECT p.id FROM archives p
     WHERE p.id = ?
       AND ${writeAccessWhere('p')}
     LIMIT 1`,
    [Number(archiveId), ...writeAccessParams(req.user)]
  );
  if (!archive) return res.status(403).json({ success: false, message: 'Write access denied' });

  const fields = [];
  const params = [];
  if (title !== undefined) { fields.push('title = ?'); params.push(title.trim()); }
  if (parent_id !== undefined) {
    const pid = parent_id === null ? null : Number(parent_id);
    if (pid !== null && !isValidId(pid)) {
      return res.status(400).json({ success: false, message: 'Invalid parent_id' });
    }
    fields.push('parent_id = ?');
    params.push(pid);
  }

  if (!fields.length) {
    return res.status(400).json({ success: false, message: 'No fields to update' });
  }

  params.push(Number(logId), Number(archiveId));
  await c2_query(
    `UPDATE logs SET ${fields.join(', ')} WHERE id = ? AND archive_id = ?`,
    params
  );

  res.json({ success: true });
}));

/**
 * DELETE /api/archives/:archiveId/logs/:logId
 * Delete a log (write_access required, cascades children)
 */
router.delete('/archives/:archiveId/logs/:logId', requireAuth, asyncHandler(async (req, res) => {
  const { archiveId, logId } = req.params;
  if (!isValidId(archiveId) || !isValidId(logId)) {
    return res.status(400).json({ success: false, message: 'Invalid IDs' });
  }

  const [archive] = await c2_query(
    `SELECT p.id FROM archives p
     WHERE p.id = ?
       AND ${writeAccessWhere('p')}
     LIMIT 1`,
    [Number(archiveId), ...writeAccessParams(req.user)]
  );
  if (!archive) return res.status(403).json({ success: false, message: 'Write access denied' });

  await c2_query(
    `DELETE FROM logs WHERE id = ? AND archive_id = ?`,
    [Number(logId), Number(archiveId)]
  );

  res.json({ success: true });
}));

// ─── Archive ↔ GitHub Repo linking ──────────────────────────────

/**
 * GET /api/archives/:archiveId/repos
 * List linked GitHub repos for an archive.
 * Anyone with read access can view.
 */
router.get('/archives/:archiveId/repos', requireAuth, asyncHandler(async (req, res) => {
  const { archiveId } = req.params;
  if (!isValidId(archiveId)) {
    return res.status(400).json({ success: false, message: 'Invalid archive ID' });
  }

  const [archive] = await c2_query(
    `SELECT p.id FROM archives p WHERE p.id = ? AND ${readAccessWhere('p')}`,
    [Number(archiveId), ...readAccessParams(req.user)]
  );
  if (!archive) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }

  const repos = await c2_query(
    `SELECT ar.id, ar.repo_full_name, ar.repo_owner, ar.repo_name, ar.linked_at,
            u.name AS linked_by_name
     FROM archive_repos ar
     LEFT JOIN users u ON ar.linked_by = u.id
     WHERE ar.archive_id = ?
     ORDER BY ar.linked_at DESC`,
    [Number(archiveId)]
  );

  res.json({ success: true, repos });
}));

/**
 * POST /api/archives/:archiveId/repos
 * Link a GitHub repo to an archive.
 * Only archive owner (creator, workspace owner, squad owner, or admin) can link.
 */
router.post('/archives/:archiveId/repos', requireAuth, asyncHandler(async (req, res) => {
  const { archiveId } = req.params;
  if (!isValidId(archiveId)) {
    return res.status(400).json({ success: false, message: 'Invalid archive ID' });
  }

  const owner = await isArchiveOwner(req.user, archiveId);
  if (!owner) {
    return res.status(403).json({ success: false, message: 'Only archive owners can link repos' });
  }

  const { repoFullName, repoOwner, repoName } = req.body;
  if (!repoFullName || !repoOwner || !repoName) {
    return res.status(400).json({ success: false, message: 'repoFullName, repoOwner, and repoName are required' });
  }
  if (repoFullName.length > 255 || repoOwner.length > 255 || repoName.length > 255) {
    return res.status(400).json({ success: false, message: 'Repo name fields must be 255 characters or less' });
  }

  try {
    const result = await c2_query(
      `INSERT INTO archive_repos (archive_id, repo_full_name, repo_owner, repo_name, linked_by)
       VALUES (?, ?, ?, ?, ?)`,
      [Number(archiveId), repoFullName.trim(), repoOwner.trim(), repoName.trim(), req.user.id]
    );
    res.status(201).json({ success: true, repoLinkId: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'This repo is already linked to this archive' });
    }
    throw err;
  }
}));

/**
 * DELETE /api/archives/:archiveId/repos/:repoId
 * Unlink a GitHub repo from an archive.
 * Only archive owner (creator, workspace owner, squad owner, or admin) can unlink.
 */
router.delete('/archives/:archiveId/repos/:repoId', requireAuth, asyncHandler(async (req, res) => {
  const { archiveId, repoId } = req.params;
  if (!isValidId(archiveId) || !isValidId(repoId)) {
    return res.status(400).json({ success: false, message: 'Invalid ID' });
  }

  const owner = await isArchiveOwner(req.user, archiveId);
  if (!owner) {
    return res.status(403).json({ success: false, message: 'Only archive owners can unlink repos' });
  }

  const result = await c2_query(
    `DELETE FROM archive_repos WHERE id = ? AND archive_id = ?`,
    [Number(repoId), Number(archiveId)]
  );
  if (result.affectedRows === 0) {
    return res.status(404).json({ success: false, message: 'Linked repo not found' });
  }

  res.json({ success: true });
}));

// --- Centralized error handler ---

router.use(errorHandler);

export default router;