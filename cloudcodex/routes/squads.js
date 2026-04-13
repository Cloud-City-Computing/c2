/**
 * API routes for squad management in Cloud Codex
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import { c2_query } from '../mysql_connect.js';
import { requireAuth } from '../middleware/auth.js';
import { sendEmail } from '../services/email.js';
import { isValidId, asyncHandler, errorHandler, APP_URL, addSquadOwnerMember } from './helpers/shared.js';

const router = express.Router();

/**
 * GET /api/workspaces/:workspaceId/squads
 * List squads in a workspace
 */
router.get('/workspaces/:workspaceId/squads', requireAuth, asyncHandler(async (req, res) => {
  const { workspaceId } = req.params;
  if (!isValidId(workspaceId)) {
    return res.status(400).json({ success: false, message: 'Invalid workspace ID' });
  }

  // Verify user belongs to this workspace (admin, owner, squad creator, squad member, or has archive access)
  if (!req.user.is_admin) {
    const [access] = await c2_query(
      `SELECT 1 FROM workspaces o
       LEFT JOIN squads t ON t.workspace_id = o.id
       LEFT JOIN squad_members tm ON tm.squad_id = t.id AND tm.user_id = ?
       LEFT JOIN archives p ON p.squad_id = t.id
       WHERE o.id = ?
         AND (o.owner = ? OR t.created_by = ? OR tm.id IS NOT NULL OR JSON_CONTAINS(p.read_access, ?))
       LIMIT 1`,
      [req.user.id, Number(workspaceId), req.user.email, req.user.id, JSON.stringify(req.user.id)]
    );
    if (!access) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
  }

  const squads = await c2_query(
    `SELECT t.id, t.name, t.created_at, u.name AS created_by
     FROM squads t
     LEFT JOIN users u ON t.created_by = u.id
     WHERE t.workspace_id = ?
     ORDER BY t.created_at DESC`,
    [Number(workspaceId)]
  );

  res.json({ success: true, squads });
}));

/**
 * POST /api/workspaces/:workspaceId/squads
 * Create a squad within a workspace.
 * Workspace owners can always create squads; other users need create_squad permission.
 */
router.post(
  '/workspaces/:workspaceId/squads',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.params;
    if (!isValidId(workspaceId)) {
      return res.status(400).json({ success: false, message: 'Invalid workspace ID' });
    }

    const { name, archiveName } = req.body;
    if (!name?.trim()) {
      return res.status(400).json({ success: false, message: 'Squad name is required' });
    }

    // Verify workspace exists and check ownership
    const [workspace] = await c2_query(
      `SELECT id, owner FROM workspaces WHERE id = ? LIMIT 1`,
      [Number(workspaceId)]
    );
    if (!workspace) {
      return res.status(404).json({ success: false, message: 'Workspace not found' });
    }

    // Workspace owners bypass the create_squad permission check
    const isOwner = req.user.is_admin || workspace.owner === req.user.email;
    if (!isOwner) {
      const [perms] = await c2_query(
        `SELECT create_squad FROM permissions WHERE user_id = ? LIMIT 1`,
        [req.user.id]
      );
      if (!perms?.create_squad) {
        return res.status(403).json({ success: false, message: "You do not have the 'create_squad' permission" });
      }
    }

    const result = await c2_query(
      `INSERT INTO squads (workspace_id, name, created_by) VALUES (?, ?, ?)`,
      [Number(workspaceId), name.trim(), req.user.id]
    );

    const newSquadId = result.insertId;

    // Auto-add the creator as a squad owner with full permissions
    await addSquadOwnerMember(newSquadId, req.user.id);

    // If the workspace owner is someone else, also add them as a squad owner
    if (!isOwner) {
      const [ownerUser] = await c2_query(
        `SELECT id FROM users WHERE email = ? LIMIT 1`,
        [workspace.owner]
      );
      if (ownerUser) {
        await addSquadOwnerMember(newSquadId, ownerUser.id);
      }
    }

    let archiveId = null;

    // Optionally create a archive alongside the squad
    if (archiveName?.trim()) {
      const projResult = await c2_query(
        `INSERT INTO archives (name, squad_id, created_by, read_access, write_access)
         VALUES (?, ?, ?, JSON_ARRAY(?), JSON_ARRAY(?))`,
        [archiveName.trim(), newSquadId, req.user.id, req.user.id, req.user.id]
      );
      archiveId = projResult.insertId;
    }

    res.status(201).json({ success: true, squadId: newSquadId, archiveId });
  })
);

/**
 * PUT /api/squads/:id
 * Rename a squad (creator or workspace owner only)
 */
router.put('/squads/:id', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: 'Invalid squad ID' });
  }

  const { name } = req.body;
  if (!name?.trim()) {
    return res.status(400).json({ success: false, message: 'Squad name is required' });
  }

  const [squad] = await c2_query(
    `SELECT t.id, t.created_by, o.owner
     FROM squads t
     LEFT JOIN workspaces o ON t.workspace_id = o.id
     WHERE t.id = ? LIMIT 1`,
    [Number(id)]
  );
  if (!squad) {
    return res.status(404).json({ success: false, message: 'Squad not found' });
  }
  if (!req.user.is_admin && squad.created_by !== req.user.id && squad.owner !== req.user.email) {
    return res.status(403).json({ success: false, message: 'Only the squad creator or workspace owner can rename this squad' });
  }

  await c2_query(`UPDATE squads SET name = ? WHERE id = ?`, [name.trim(), Number(id)]);
  res.json({ success: true });
}));

/**
 * DELETE /api/squads/:id
 * Delete a squad (creator or workspace owner only, cascades)
 */
router.delete('/squads/:id', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: 'Invalid squad ID' });
  }

  const [squad] = await c2_query(
    `SELECT t.id, t.created_by, o.owner
     FROM squads t
     LEFT JOIN workspaces o ON t.workspace_id = o.id
     WHERE t.id = ? LIMIT 1`,
    [Number(id)]
  );
  if (!squad) {
    return res.status(404).json({ success: false, message: 'Squad not found' });
  }
  if (!req.user.is_admin && squad.created_by !== req.user.id && squad.owner !== req.user.email) {
    return res.status(403).json({ success: false, message: 'Only the squad creator or workspace owner can delete this squad' });
  }

  await c2_query(`DELETE FROM squads WHERE id = ?`, [Number(id)]);
  res.json({ success: true });
}));

/**
 * GET /api/squads/:id/permissions
 * Get permissions for a squad (workspace owner only)
 */
router.get('/squads/:id/permissions', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: 'Invalid squad ID' });
  }

  const [squad] = await c2_query(
    `SELECT t.id, o.owner
     FROM squads t
     LEFT JOIN workspaces o ON t.workspace_id = o.id
     WHERE t.id = ? LIMIT 1`,
    [Number(id)]
  );
  if (!squad) return res.status(404).json({ success: false, message: 'Squad not found' });
  if (!req.user.is_admin && squad.owner !== req.user.email) {
    return res.status(403).json({ success: false, message: 'Only the workspace owner can view squad permissions' });
  }

  const [perms] = await c2_query(
    `SELECT create_archive, create_log FROM squad_permissions WHERE squad_id = ? LIMIT 1`,
    [Number(id)]
  );

  res.json({
    success: true,
    permissions: perms || { create_archive: false, create_log: true }
  });
}));

/**
 * PUT /api/squads/:id/permissions
 * Update permissions for a squad (workspace owner only)
 * Body: { create_archive?, create_log? }
 */
router.put('/squads/:id/permissions', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: 'Invalid squad ID' });
  }

  const [squad] = await c2_query(
    `SELECT t.id, o.owner
     FROM squads t
     LEFT JOIN workspaces o ON t.workspace_id = o.id
     WHERE t.id = ? LIMIT 1`,
    [Number(id)]
  );
  if (!squad) return res.status(404).json({ success: false, message: 'Squad not found' });
  if (!req.user.is_admin && squad.owner !== req.user.email) {
    return res.status(403).json({ success: false, message: 'Only the workspace owner can update squad permissions' });
  }

  const { create_archive, create_log } = req.body;

  // Upsert
  const [existing] = await c2_query(
    `SELECT id FROM squad_permissions WHERE squad_id = ? LIMIT 1`,
    [Number(id)]
  );

  if (existing) {
    const fields = [];
    const params = [];
    if (create_archive !== undefined) { fields.push('create_archive = ?'); params.push(Boolean(create_archive)); }
    if (create_log !== undefined)    { fields.push('create_log = ?');    params.push(Boolean(create_log));    }
    if (fields.length) {
      params.push(Number(id));
      await c2_query(`UPDATE squad_permissions SET ${fields.join(', ')} WHERE squad_id = ?`, params);
    }
  } else {
    await c2_query(
      `INSERT INTO squad_permissions (squad_id, create_archive, create_log) VALUES (?, ?, ?)`,
      [Number(id), Boolean(create_archive), create_log !== false]
    );
  }

  res.json({ success: true });
}));

// =============================================
// Squad Members
// =============================================

/**
 * Helper: check if user can manage a squad (workspace owner, squad creator, or member with can_manage_members)
 */
async function canManageSquad(squadId, user) {
  const [squad] = await c2_query(
    `SELECT t.id, t.created_by, o.owner
     FROM squads t LEFT JOIN workspaces o ON t.workspace_id = o.id
     WHERE t.id = ? LIMIT 1`,
    [squadId]
  );
  if (!squad) return { squad: null, allowed: false };
  if (user.is_admin || squad.owner === user.email || squad.created_by === user.id) return { squad, allowed: true };
  const [membership] = await c2_query(
    `SELECT can_manage_members FROM squad_members WHERE squad_id = ? AND user_id = ? LIMIT 1`,
    [squadId, user.id]
  );
  return { squad, allowed: Boolean(membership?.can_manage_members) };
}

/**
 * GET /api/squads/:id/members
 * List members of a squad (requires workspace owner, squad creator, or squad membership)
 */
router.get('/squads/:id/members', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ success: false, message: 'Invalid squad ID' });

  // Verify caller has visibility into this squad
  const [squad] = await c2_query(
    `SELECT t.id, t.created_by, o.owner
     FROM squads t LEFT JOIN workspaces o ON t.workspace_id = o.id
     WHERE t.id = ? LIMIT 1`,
    [Number(id)]
  );
  if (!squad) return res.status(404).json({ success: false, message: 'Squad not found' });

  const isOwnerOrCreator = req.user.is_admin || squad.owner === req.user.email || squad.created_by === req.user.id;
  if (!isOwnerOrCreator) {
    const [membership] = await c2_query(
      `SELECT id FROM squad_members WHERE squad_id = ? AND user_id = ? LIMIT 1`,
      [Number(id), req.user.id]
    );
    if (!membership) return res.status(403).json({ success: false, message: 'Access denied' });
  }

  const members = await c2_query(
    `SELECT tm.id, tm.user_id, u.name, u.email, tm.role,
            tm.can_read, tm.can_write, tm.can_create_log,
            tm.can_create_archive, tm.can_manage_members, tm.can_delete_version, tm.can_publish, tm.joined_at
     FROM squad_members tm
     JOIN users u ON tm.user_id = u.id
     WHERE tm.squad_id = ?
     ORDER BY tm.joined_at ASC`,
    [Number(id)]
  );

  res.json({ success: true, members });
}));

/**
 * POST /api/squads/:id/members/invite
 * Invite a user to a squad. Body: { userId, role?, can_read?, can_write?, can_create_log?, can_create_archive?, can_manage_members? }
 */
router.post('/squads/:id/members/invite', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ success: false, message: 'Invalid squad ID' });

  const { userId, role, can_read, can_write, can_create_log, can_create_archive, can_manage_members, can_delete_version, can_publish } = req.body;
  if (!isValidId(userId)) return res.status(400).json({ success: false, message: 'Invalid user ID' });

  const { squad, allowed } = await canManageSquad(Number(id), req.user);
  if (!squad) return res.status(404).json({ success: false, message: 'Squad not found' });
  if (!allowed) return res.status(403).json({ success: false, message: 'You do not have permission to invite members to this squad' });

  // Prevent privilege escalation: only workspace owners / squad creators can grant
  // can_manage_members or invite as admin
  const isOrgOwnerOrCreator = squad.owner === req.user.email || squad.created_by === req.user.id;
  if (!isOrgOwnerOrCreator) {
    if (can_manage_members === true) {
      return res.status(403).json({ success: false, message: 'Only workspace owners and squad creators can grant member management permissions' });
    }
    if (role === 'admin') {
      return res.status(403).json({ success: false, message: 'Only workspace owners and squad creators can invite members as admin' });
    }
  }

  // Check user exists
  const [targetUser] = await c2_query(`SELECT id FROM users WHERE id = ? LIMIT 1`, [Number(userId)]);
  if (!targetUser) return res.status(404).json({ success: false, message: 'User not found' });

  // Check if already a member
  const [existing] = await c2_query(
    `SELECT id FROM squad_members WHERE squad_id = ? AND user_id = ? LIMIT 1`,
    [Number(id), Number(userId)]
  );
  if (existing) return res.status(409).json({ success: false, message: 'User is already a member of this squad' });

  // Check if pending invitation already exists
  const [pendingInv] = await c2_query(
    `SELECT id FROM squad_invitations WHERE squad_id = ? AND invited_user_id = ? AND status = 'pending' LIMIT 1`,
    [Number(id), Number(userId)]
  );
  if (pendingInv) return res.status(409).json({ success: false, message: 'An invitation is already pending for this user' });

  const safeRole = role === 'admin' ? 'admin' : 'member';

  await c2_query(
    `INSERT INTO squad_invitations (squad_id, invited_by, invited_user_id, role, can_read, can_write, can_create_log, can_create_archive, can_manage_members, can_delete_version, can_publish)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [Number(id), req.user.id, Number(userId), safeRole,
     can_read !== false, Boolean(can_write), Boolean(can_create_log), Boolean(can_create_archive), Boolean(can_manage_members), Boolean(can_delete_version), Boolean(can_publish)]
  );

  // Send email notification to the invited user
  const [invitedUser] = await c2_query(`SELECT email, name FROM users WHERE id = ? LIMIT 1`, [Number(userId)]);
  if (invitedUser?.email) {
    try {
      await sendEmail({
        to: invitedUser.email,
        subject: `Cloud Codex — You've been invited to ${squad.name}`,
        text: `Hi ${invitedUser.name},\n\n${req.user.name} has invited you to join the squad "${squad.name}" as ${safeRole === 'admin' ? 'an admin' : 'a member'}.\n\nLog in to accept or decline: ${APP_URL}\n`,
        html: `
          <h2>Squad Invitation</h2>
          <p>Hi ${invitedUser.name},</p>
          <p><strong>${req.user.name}</strong> has invited you to join the squad <strong>${squad.name}</strong> as ${safeRole === 'admin' ? 'an admin' : 'a member'}.</p>
          <p><a href="${APP_URL}" style="display:inline-block;padding:10px 20px;background:#2ca7db;color:#fff;text-decoration:none;border-radius:6px;">View Invitation</a></p>
        `,
      });
    } catch (err) {
      console.error('Failed to send squad invitation email:', err);
    }
  }

  res.status(201).json({ success: true });
}));

/**
 * PUT /api/squads/:id/members/:userId
 * Update a member's role/permissions. Body: { role?, can_read?, can_write?, can_create_log?, can_create_archive?, can_manage_members? }
 */
router.put('/squads/:id/members/:userId', requireAuth, asyncHandler(async (req, res) => {
  const { id, userId } = req.params;
  if (!isValidId(id) || !isValidId(userId)) return res.status(400).json({ success: false, message: 'Invalid ID' });

  const { squad, allowed } = await canManageSquad(Number(id), req.user);
  if (!squad) return res.status(404).json({ success: false, message: 'Squad not found' });
  if (!allowed) return res.status(403).json({ success: false, message: 'You do not have permission to manage this squad' });

  // Members cannot modify their own role or permissions
  if (Number(userId) === req.user.id) {
    return res.status(403).json({ success: false, message: 'You cannot modify your own permissions' });
  }

  const [member] = await c2_query(
    `SELECT id, role FROM squad_members WHERE squad_id = ? AND user_id = ? LIMIT 1`,
    [Number(id), Number(userId)]
  );
  if (!member) return res.status(404).json({ success: false, message: 'Member not found' });

  // Owners cannot be modified
  if (member.role === 'owner') {
    return res.status(403).json({ success: false, message: 'Cannot modify the permissions of a squad owner' });
  }

  // Only workspace owners and squad creators can grant can_manage_members or set role to admin
  // (prevents privilege escalation by members who only have can_manage_members)
  const isOrgOwnerOrCreator = squad.owner === req.user.email || squad.created_by === req.user.id;
  const { role, can_read, can_write, can_create_log, can_create_archive, can_manage_members, can_delete_version, can_publish } = req.body;

  if (!isOrgOwnerOrCreator) {
    if (can_manage_members === true) {
      return res.status(403).json({ success: false, message: 'Only workspace owners and squad creators can grant member management permissions' });
    }
    if (role === 'admin') {
      return res.status(403).json({ success: false, message: 'Only workspace owners and squad creators can promote members to admin' });
    }
  }
  const fields = [];
  const params = [];

  if (role !== undefined) { fields.push('role = ?'); params.push(role === 'admin' ? 'admin' : 'member'); }
  if (can_read !== undefined) { fields.push('can_read = ?'); params.push(Boolean(can_read)); }
  if (can_write !== undefined) { fields.push('can_write = ?'); params.push(Boolean(can_write)); }
  if (can_create_log !== undefined) { fields.push('can_create_log = ?'); params.push(Boolean(can_create_log)); }
  if (can_create_archive !== undefined) { fields.push('can_create_archive = ?'); params.push(Boolean(can_create_archive)); }
  if (can_manage_members !== undefined) { fields.push('can_manage_members = ?'); params.push(Boolean(can_manage_members)); }
  if (can_delete_version !== undefined) { fields.push('can_delete_version = ?'); params.push(Boolean(can_delete_version)); }
  if (can_publish !== undefined) { fields.push('can_publish = ?'); params.push(Boolean(can_publish)); }

  if (fields.length) {
    params.push(Number(id), Number(userId));
    await c2_query(`UPDATE squad_members SET ${fields.join(', ')} WHERE squad_id = ? AND user_id = ?`, params);
  }

  res.json({ success: true });
}));

/**
 * DELETE /api/squads/:id/members/:userId
 * Remove a member from a squad
 */
router.delete('/squads/:id/members/:userId', requireAuth, asyncHandler(async (req, res) => {
  const { id, userId } = req.params;
  if (!isValidId(id) || !isValidId(userId)) return res.status(400).json({ success: false, message: 'Invalid ID' });

  const { squad, allowed } = await canManageSquad(Number(id), req.user);
  if (!squad) return res.status(404).json({ success: false, message: 'Squad not found' });
  if (!allowed) return res.status(403).json({ success: false, message: 'You do not have permission to manage this squad' });

  // Owners cannot be removed
  const [member] = await c2_query(
    `SELECT role FROM squad_members WHERE squad_id = ? AND user_id = ? LIMIT 1`,
    [Number(id), Number(userId)]
  );
  if (member?.role === 'owner') {
    return res.status(403).json({ success: false, message: 'Cannot remove a squad owner' });
  }

  await c2_query(`DELETE FROM squad_members WHERE squad_id = ? AND user_id = ?`, [Number(id), Number(userId)]);
  res.json({ success: true });
}));

// =============================================
// Invitations
// =============================================

/**
 * GET /api/invitations
 * List pending invitations for the current user
 */
router.get('/invitations', requireAuth, asyncHandler(async (req, res) => {
  const invitations = await c2_query(
    `SELECT ti.id, ti.squad_id, t.name AS squad_name, o.name AS workspace_name,
            inviter.name AS invited_by_name, ti.role,
            ti.can_read, ti.can_write, ti.can_create_log,
            ti.can_create_archive, ti.can_manage_members, ti.can_delete_version, ti.created_at
     FROM squad_invitations ti
     JOIN squads t ON ti.squad_id = t.id
     LEFT JOIN workspaces o ON t.workspace_id = o.id
     JOIN users inviter ON ti.invited_by = inviter.id
     WHERE ti.invited_user_id = ? AND ti.status = 'pending'
     ORDER BY ti.created_at DESC`,
    [req.user.id]
  );

  res.json({ success: true, invitations });
}));

/**
 * GET /api/squads/:id/invitations
 * List pending invitations for a squad (managers only)
 */
router.get('/squads/:id/invitations', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ success: false, message: 'Invalid squad ID' });

  const { squad, allowed } = await canManageSquad(Number(id), req.user);
  if (!squad) return res.status(404).json({ success: false, message: 'Squad not found' });
  if (!allowed) return res.status(403).json({ success: false, message: 'Access denied' });

  const pending = await c2_query(
    `SELECT ti.id, ti.invited_user_id, u.name, u.email, ti.role,
            ti.can_read, ti.can_write, ti.can_create_log,
            ti.can_create_archive, ti.can_manage_members, ti.can_delete_version,
            inviter.name AS invited_by_name, ti.created_at
     FROM squad_invitations ti
     JOIN users u ON ti.invited_user_id = u.id
     JOIN users inviter ON ti.invited_by = inviter.id
     WHERE ti.squad_id = ? AND ti.status = 'pending'
     ORDER BY ti.created_at DESC`,
    [Number(id)]
  );

  res.json({ success: true, invitations: pending });
}));

/**
 * POST /api/invitations/:id/accept
 * Accept an invitation — creates the squad_members row
 */
router.post('/invitations/:id/accept', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ success: false, message: 'Invalid invitation ID' });

  const [inv] = await c2_query(
    `SELECT * FROM squad_invitations WHERE id = ? AND status = 'pending' LIMIT 1`,
    [Number(id)]
  );
  if (!inv) return res.status(404).json({ success: false, message: 'Invitation not found or already responded' });
  if (inv.invited_user_id !== req.user.id) return res.status(403).json({ success: false, message: 'This invitation is not for you' });

  // Create membership
  await c2_query(
    `INSERT INTO squad_members (squad_id, user_id, role, can_read, can_write, can_create_log, can_create_archive, can_manage_members, can_delete_version, can_publish)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE role = VALUES(role), can_read = VALUES(can_read), can_write = VALUES(can_write),
       can_create_log = VALUES(can_create_log), can_create_archive = VALUES(can_create_archive),
       can_manage_members = VALUES(can_manage_members), can_delete_version = VALUES(can_delete_version),
       can_publish = VALUES(can_publish)`,
    [inv.squad_id, inv.invited_user_id, inv.role,
     inv.can_read, inv.can_write, inv.can_create_log, inv.can_create_archive, inv.can_manage_members, inv.can_delete_version, inv.can_publish]
  );

  // Remove old accepted/declined invitations for this squad+user to avoid unique key conflict
  await c2_query(
    `DELETE FROM squad_invitations WHERE squad_id = ? AND invited_user_id = ? AND status IN ('accepted', 'declined') AND id != ?`,
    [inv.squad_id, inv.invited_user_id, Number(id)]
  );

  // Mark invitation accepted
  await c2_query(
    `UPDATE squad_invitations SET status = 'accepted', responded_at = NOW() WHERE id = ?`,
    [Number(id)]
  );

  res.json({ success: true });
}));

/**
 * POST /api/invitations/:id/decline
 * Decline an invitation
 */
router.post('/invitations/:id/decline', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ success: false, message: 'Invalid invitation ID' });

  const [inv] = await c2_query(
    `SELECT id, invited_user_id FROM squad_invitations WHERE id = ? AND status = 'pending' LIMIT 1`,
    [Number(id)]
  );
  if (!inv) return res.status(404).json({ success: false, message: 'Invitation not found or already responded' });
  if (inv.invited_user_id !== req.user.id) return res.status(403).json({ success: false, message: 'This invitation is not for you' });

  await c2_query(
    `UPDATE squad_invitations SET status = 'declined', responded_at = NOW() WHERE id = ?`,
    [Number(id)]
  );

  res.json({ success: true });
}));

/**
 * DELETE /api/invitations/:id
 * Cancel a pending invitation (squad managers only)
 */
router.delete('/invitations/:id', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ success: false, message: 'Invalid invitation ID' });

  const [inv] = await c2_query(
    `SELECT ti.id, ti.squad_id FROM squad_invitations ti WHERE ti.id = ? AND ti.status = 'pending' LIMIT 1`,
    [Number(id)]
  );
  if (!inv) return res.status(404).json({ success: false, message: 'Invitation not found or already responded' });

  const { allowed } = await canManageSquad(inv.squad_id, req.user);
  if (!allowed) return res.status(403).json({ success: false, message: 'You do not have permission to cancel this invitation' });

  await c2_query(`DELETE FROM squad_invitations WHERE id = ?`, [Number(id)]);
  res.json({ success: true });
}));

router.use(errorHandler);

export default router;
