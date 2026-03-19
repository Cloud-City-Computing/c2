/**
 * API routes for team management in Cloud Codex
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import { c2_query } from '../mysql_connect.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const isValidId = (id) => Number.isInteger(Number(id)) && Number(id) > 0;

/**
 * GET /api/organizations/:orgId/teams
 * List teams in an organization
 */
router.get('/organizations/:orgId/teams', requireAuth, asyncHandler(async (req, res) => {
  const { orgId } = req.params;
  if (!isValidId(orgId)) {
    return res.status(400).json({ success: false, message: 'Invalid organization ID' });
  }

  // Verify user belongs to this org (owner, team creator, team member, or has project access)
  const [access] = await c2_query(
    `SELECT 1 FROM organizations o
     LEFT JOIN teams t ON t.organization_id = o.id
     LEFT JOIN team_members tm ON tm.team_id = t.id AND tm.user_id = ?
     LEFT JOIN projects p ON p.team_id = t.id
     WHERE o.id = ?
       AND (o.owner = ? OR t.created_by = ? OR tm.id IS NOT NULL OR JSON_CONTAINS(p.read_access, ?))
     LIMIT 1`,
    [req.user.id, Number(orgId), req.user.email, req.user.id, JSON.stringify(req.user.id)]
  );
  if (!access) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }

  const teams = await c2_query(
    `SELECT t.id, t.name, t.created_at, u.name AS created_by
     FROM teams t
     LEFT JOIN users u ON t.created_by = u.id
     WHERE t.organization_id = ?
     ORDER BY t.created_at DESC`,
    [Number(orgId)]
  );

  res.json({ success: true, teams });
}));

/**
 * POST /api/organizations/:orgId/teams
 * Create a team within an organization.
 * Org owners can always create teams; other users need create_team permission.
 */
router.post(
  '/organizations/:orgId/teams',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { orgId } = req.params;
    if (!isValidId(orgId)) {
      return res.status(400).json({ success: false, message: 'Invalid organization ID' });
    }

    const { name } = req.body;
    if (!name?.trim()) {
      return res.status(400).json({ success: false, message: 'Team name is required' });
    }

    // Verify org exists and check ownership
    const [org] = await c2_query(
      `SELECT id, owner FROM organizations WHERE id = ? LIMIT 1`,
      [Number(orgId)]
    );
    if (!org) {
      return res.status(404).json({ success: false, message: 'Organization not found' });
    }

    // Org owners bypass the create_team permission check
    const isOwner = org.owner === req.user.email;
    if (!isOwner) {
      const [perms] = await c2_query(
        `SELECT create_team FROM permissions WHERE user_id = ? LIMIT 1`,
        [req.user.id]
      );
      if (!perms?.create_team) {
        return res.status(403).json({ success: false, message: "You do not have the 'create_team' permission" });
      }
    }

    const result = await c2_query(
      `INSERT INTO teams (organization_id, name, created_by) VALUES (?, ?, ?)`,
      [Number(orgId), name.trim(), req.user.id]
    );

    const newTeamId = result.insertId;

    // Auto-add the creator as a team owner with full permissions
    await c2_query(
      `INSERT INTO team_members (team_id, user_id, role, can_read, can_write, can_create_page, can_create_project, can_manage_members, can_delete_version)
       VALUES (?, ?, 'owner', TRUE, TRUE, TRUE, TRUE, TRUE, TRUE)`,
      [newTeamId, req.user.id]
    );

    // If the org owner is someone else, also add them as a team owner
    if (!isOwner) {
      const [ownerUser] = await c2_query(
        `SELECT id FROM users WHERE email = ? LIMIT 1`,
        [org.owner]
      );
      if (ownerUser) {
        await c2_query(
          `INSERT INTO team_members (team_id, user_id, role, can_read, can_write, can_create_page, can_create_project, can_manage_members, can_delete_version)
           VALUES (?, ?, 'owner', TRUE, TRUE, TRUE, TRUE, TRUE, TRUE)`,
          [newTeamId, ownerUser.id]
        );
      }
    }

    res.status(201).json({ success: true, teamId: newTeamId });
  })
);

/**
 * PUT /api/teams/:id
 * Rename a team (creator or org owner only)
 */
router.put('/teams/:id', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: 'Invalid team ID' });
  }

  const { name } = req.body;
  if (!name?.trim()) {
    return res.status(400).json({ success: false, message: 'Team name is required' });
  }

  const [team] = await c2_query(
    `SELECT t.id, t.created_by, o.owner
     FROM teams t
     LEFT JOIN organizations o ON t.organization_id = o.id
     WHERE t.id = ? LIMIT 1`,
    [Number(id)]
  );
  if (!team) {
    return res.status(404).json({ success: false, message: 'Team not found' });
  }
  if (team.created_by !== req.user.id && team.owner !== req.user.email) {
    return res.status(403).json({ success: false, message: 'Only the team creator or org owner can rename this team' });
  }

  await c2_query(`UPDATE teams SET name = ? WHERE id = ?`, [name.trim(), Number(id)]);
  res.json({ success: true });
}));

/**
 * DELETE /api/teams/:id
 * Delete a team (creator or org owner only, cascades)
 */
router.delete('/teams/:id', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: 'Invalid team ID' });
  }

  const [team] = await c2_query(
    `SELECT t.id, t.created_by, o.owner
     FROM teams t
     LEFT JOIN organizations o ON t.organization_id = o.id
     WHERE t.id = ? LIMIT 1`,
    [Number(id)]
  );
  if (!team) {
    return res.status(404).json({ success: false, message: 'Team not found' });
  }
  if (team.created_by !== req.user.id && team.owner !== req.user.email) {
    return res.status(403).json({ success: false, message: 'Only the team creator or org owner can delete this team' });
  }

  await c2_query(`DELETE FROM teams WHERE id = ?`, [Number(id)]);
  res.json({ success: true });
}));

/**
 * GET /api/teams/:id/permissions
 * Get permissions for a team (org owner only)
 */
router.get('/teams/:id/permissions', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: 'Invalid team ID' });
  }

  const [team] = await c2_query(
    `SELECT t.id, o.owner
     FROM teams t
     LEFT JOIN organizations o ON t.organization_id = o.id
     WHERE t.id = ? LIMIT 1`,
    [Number(id)]
  );
  if (!team) return res.status(404).json({ success: false, message: 'Team not found' });
  if (team.owner !== req.user.email) {
    return res.status(403).json({ success: false, message: 'Only the org owner can view team permissions' });
  }

  const [perms] = await c2_query(
    `SELECT create_project, create_page FROM team_permissions WHERE team_id = ? LIMIT 1`,
    [Number(id)]
  );

  res.json({
    success: true,
    permissions: perms || { create_project: false, create_page: true }
  });
}));

/**
 * PUT /api/teams/:id/permissions
 * Update permissions for a team (org owner only)
 * Body: { create_project?, create_page? }
 */
router.put('/teams/:id/permissions', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: 'Invalid team ID' });
  }

  const [team] = await c2_query(
    `SELECT t.id, o.owner
     FROM teams t
     LEFT JOIN organizations o ON t.organization_id = o.id
     WHERE t.id = ? LIMIT 1`,
    [Number(id)]
  );
  if (!team) return res.status(404).json({ success: false, message: 'Team not found' });
  if (team.owner !== req.user.email) {
    return res.status(403).json({ success: false, message: 'Only the org owner can update team permissions' });
  }

  const { create_project, create_page } = req.body;

  // Upsert
  const [existing] = await c2_query(
    `SELECT id FROM team_permissions WHERE team_id = ? LIMIT 1`,
    [Number(id)]
  );

  if (existing) {
    const fields = [];
    const params = [];
    if (create_project !== undefined) { fields.push('create_project = ?'); params.push(!!create_project); }
    if (create_page !== undefined)    { fields.push('create_page = ?');    params.push(!!create_page);    }
    if (fields.length) {
      params.push(Number(id));
      await c2_query(`UPDATE team_permissions SET ${fields.join(', ')} WHERE team_id = ?`, params);
    }
  } else {
    await c2_query(
      `INSERT INTO team_permissions (team_id, create_project, create_page) VALUES (?, ?, ?)`,
      [Number(id), !!create_project, create_page !== false]
    );
  }

  res.json({ success: true });
}));

// =============================================
// Team Members
// =============================================

/**
 * Helper: check if user can manage a team (org owner, team creator, or member with can_manage_members)
 */
async function canManageTeam(teamId, user) {
  const [team] = await c2_query(
    `SELECT t.id, t.created_by, o.owner
     FROM teams t LEFT JOIN organizations o ON t.organization_id = o.id
     WHERE t.id = ? LIMIT 1`,
    [teamId]
  );
  if (!team) return { team: null, allowed: false };
  if (team.owner === user.email || team.created_by === user.id) return { team, allowed: true };
  const [membership] = await c2_query(
    `SELECT can_manage_members FROM team_members WHERE team_id = ? AND user_id = ? LIMIT 1`,
    [teamId, user.id]
  );
  return { team, allowed: !!membership?.can_manage_members };
}

/**
 * GET /api/teams/:id/members
 * List members of a team (requires org owner, team creator, or team membership)
 */
router.get('/teams/:id/members', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ success: false, message: 'Invalid team ID' });

  // Verify caller has visibility into this team
  const [team] = await c2_query(
    `SELECT t.id, t.created_by, o.owner
     FROM teams t LEFT JOIN organizations o ON t.organization_id = o.id
     WHERE t.id = ? LIMIT 1`,
    [Number(id)]
  );
  if (!team) return res.status(404).json({ success: false, message: 'Team not found' });

  const isOwnerOrCreator = team.owner === req.user.email || team.created_by === req.user.id;
  if (!isOwnerOrCreator) {
    const [membership] = await c2_query(
      `SELECT id FROM team_members WHERE team_id = ? AND user_id = ? LIMIT 1`,
      [Number(id), req.user.id]
    );
    if (!membership) return res.status(403).json({ success: false, message: 'Access denied' });
  }

  const members = await c2_query(
    `SELECT tm.id, tm.user_id, u.name, u.email, tm.role,
            tm.can_read, tm.can_write, tm.can_create_page,
            tm.can_create_project, tm.can_manage_members, tm.can_delete_version, tm.joined_at
     FROM team_members tm
     JOIN users u ON tm.user_id = u.id
     WHERE tm.team_id = ?
     ORDER BY tm.joined_at ASC`,
    [Number(id)]
  );

  res.json({ success: true, members });
}));

/**
 * POST /api/teams/:id/members/invite
 * Invite a user to a team. Body: { userId, role?, can_read?, can_write?, can_create_page?, can_create_project?, can_manage_members? }
 */
router.post('/teams/:id/members/invite', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ success: false, message: 'Invalid team ID' });

  const { userId, role, can_read, can_write, can_create_page, can_create_project, can_manage_members, can_delete_version } = req.body;
  if (!isValidId(userId)) return res.status(400).json({ success: false, message: 'Invalid user ID' });

  const { team, allowed } = await canManageTeam(Number(id), req.user);
  if (!team) return res.status(404).json({ success: false, message: 'Team not found' });
  if (!allowed) return res.status(403).json({ success: false, message: 'You do not have permission to invite members to this team' });

  // Check user exists
  const [targetUser] = await c2_query(`SELECT id FROM users WHERE id = ? LIMIT 1`, [Number(userId)]);
  if (!targetUser) return res.status(404).json({ success: false, message: 'User not found' });

  // Check if already a member
  const [existing] = await c2_query(
    `SELECT id FROM team_members WHERE team_id = ? AND user_id = ? LIMIT 1`,
    [Number(id), Number(userId)]
  );
  if (existing) return res.status(409).json({ success: false, message: 'User is already a member of this team' });

  // Check if pending invitation already exists
  const [pendingInv] = await c2_query(
    `SELECT id FROM team_invitations WHERE team_id = ? AND invited_user_id = ? AND status = 'pending' LIMIT 1`,
    [Number(id), Number(userId)]
  );
  if (pendingInv) return res.status(409).json({ success: false, message: 'An invitation is already pending for this user' });

  const safeRole = role === 'admin' ? 'admin' : 'member';

  await c2_query(
    `INSERT INTO team_invitations (team_id, invited_by, invited_user_id, role, can_read, can_write, can_create_page, can_create_project, can_manage_members, can_delete_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [Number(id), req.user.id, Number(userId), safeRole,
     can_read !== false, !!can_write, !!can_create_page, !!can_create_project, !!can_manage_members, !!can_delete_version]
  );

  res.status(201).json({ success: true });
}));

/**
 * PUT /api/teams/:id/members/:userId
 * Update a member's role/permissions. Body: { role?, can_read?, can_write?, can_create_page?, can_create_project?, can_manage_members? }
 */
router.put('/teams/:id/members/:userId', requireAuth, asyncHandler(async (req, res) => {
  const { id, userId } = req.params;
  if (!isValidId(id) || !isValidId(userId)) return res.status(400).json({ success: false, message: 'Invalid ID' });

  const { team, allowed } = await canManageTeam(Number(id), req.user);
  if (!team) return res.status(404).json({ success: false, message: 'Team not found' });
  if (!allowed) return res.status(403).json({ success: false, message: 'You do not have permission to manage this team' });

  const [member] = await c2_query(
    `SELECT id, role FROM team_members WHERE team_id = ? AND user_id = ? LIMIT 1`,
    [Number(id), Number(userId)]
  );
  if (!member) return res.status(404).json({ success: false, message: 'Member not found' });

  // Owners cannot be modified
  if (member.role === 'owner') {
    return res.status(403).json({ success: false, message: 'Cannot modify the permissions of a team owner' });
  }

  const { role, can_read, can_write, can_create_page, can_create_project, can_manage_members, can_delete_version } = req.body;
  const fields = [];
  const params = [];

  if (role !== undefined) { fields.push('role = ?'); params.push(role === 'admin' ? 'admin' : 'member'); }
  if (can_read !== undefined) { fields.push('can_read = ?'); params.push(!!can_read); }
  if (can_write !== undefined) { fields.push('can_write = ?'); params.push(!!can_write); }
  if (can_create_page !== undefined) { fields.push('can_create_page = ?'); params.push(!!can_create_page); }
  if (can_create_project !== undefined) { fields.push('can_create_project = ?'); params.push(!!can_create_project); }
  if (can_manage_members !== undefined) { fields.push('can_manage_members = ?'); params.push(!!can_manage_members); }
  if (can_delete_version !== undefined) { fields.push('can_delete_version = ?'); params.push(!!can_delete_version); }

  if (fields.length) {
    params.push(Number(id), Number(userId));
    await c2_query(`UPDATE team_members SET ${fields.join(', ')} WHERE team_id = ? AND user_id = ?`, params);
  }

  res.json({ success: true });
}));

/**
 * DELETE /api/teams/:id/members/:userId
 * Remove a member from a team
 */
router.delete('/teams/:id/members/:userId', requireAuth, asyncHandler(async (req, res) => {
  const { id, userId } = req.params;
  if (!isValidId(id) || !isValidId(userId)) return res.status(400).json({ success: false, message: 'Invalid ID' });

  const { team, allowed } = await canManageTeam(Number(id), req.user);
  if (!team) return res.status(404).json({ success: false, message: 'Team not found' });
  if (!allowed) return res.status(403).json({ success: false, message: 'You do not have permission to manage this team' });

  // Owners cannot be removed
  const [member] = await c2_query(
    `SELECT role FROM team_members WHERE team_id = ? AND user_id = ? LIMIT 1`,
    [Number(id), Number(userId)]
  );
  if (member?.role === 'owner') {
    return res.status(403).json({ success: false, message: 'Cannot remove a team owner' });
  }

  await c2_query(`DELETE FROM team_members WHERE team_id = ? AND user_id = ?`, [Number(id), Number(userId)]);
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
    `SELECT ti.id, ti.team_id, t.name AS team_name, o.name AS org_name,
            inviter.name AS invited_by_name, ti.role,
            ti.can_read, ti.can_write, ti.can_create_page,
            ti.can_create_project, ti.can_manage_members, ti.can_delete_version, ti.created_at
     FROM team_invitations ti
     JOIN teams t ON ti.team_id = t.id
     LEFT JOIN organizations o ON t.organization_id = o.id
     JOIN users inviter ON ti.invited_by = inviter.id
     WHERE ti.invited_user_id = ? AND ti.status = 'pending'
     ORDER BY ti.created_at DESC`,
    [req.user.id]
  );

  res.json({ success: true, invitations });
}));

/**
 * GET /api/teams/:id/invitations
 * List pending invitations for a team (managers only)
 */
router.get('/teams/:id/invitations', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ success: false, message: 'Invalid team ID' });

  const { team, allowed } = await canManageTeam(Number(id), req.user);
  if (!team) return res.status(404).json({ success: false, message: 'Team not found' });
  if (!allowed) return res.status(403).json({ success: false, message: 'Access denied' });

  const pending = await c2_query(
    `SELECT ti.id, ti.invited_user_id, u.name, u.email, ti.role,
            ti.can_read, ti.can_write, ti.can_create_page,
            ti.can_create_project, ti.can_manage_members, ti.can_delete_version,
            inviter.name AS invited_by_name, ti.created_at
     FROM team_invitations ti
     JOIN users u ON ti.invited_user_id = u.id
     JOIN users inviter ON ti.invited_by = inviter.id
     WHERE ti.team_id = ? AND ti.status = 'pending'
     ORDER BY ti.created_at DESC`,
    [Number(id)]
  );

  res.json({ success: true, invitations: pending });
}));

/**
 * POST /api/invitations/:id/accept
 * Accept an invitation — creates the team_members row
 */
router.post('/invitations/:id/accept', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ success: false, message: 'Invalid invitation ID' });

  const [inv] = await c2_query(
    `SELECT * FROM team_invitations WHERE id = ? AND status = 'pending' LIMIT 1`,
    [Number(id)]
  );
  if (!inv) return res.status(404).json({ success: false, message: 'Invitation not found or already responded' });
  if (inv.invited_user_id !== req.user.id) return res.status(403).json({ success: false, message: 'This invitation is not for you' });

  // Create membership
  await c2_query(
    `INSERT INTO team_members (team_id, user_id, role, can_read, can_write, can_create_page, can_create_project, can_manage_members, can_delete_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE role = VALUES(role), can_read = VALUES(can_read), can_write = VALUES(can_write),
       can_create_page = VALUES(can_create_page), can_create_project = VALUES(can_create_project),
       can_manage_members = VALUES(can_manage_members), can_delete_version = VALUES(can_delete_version)`,
    [inv.team_id, inv.invited_user_id, inv.role,
     inv.can_read, inv.can_write, inv.can_create_page, inv.can_create_project, inv.can_manage_members, inv.can_delete_version]
  );

  // Mark invitation accepted
  await c2_query(
    `UPDATE team_invitations SET status = 'accepted', responded_at = NOW() WHERE id = ?`,
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
    `SELECT id, invited_user_id FROM team_invitations WHERE id = ? AND status = 'pending' LIMIT 1`,
    [Number(id)]
  );
  if (!inv) return res.status(404).json({ success: false, message: 'Invitation not found or already responded' });
  if (inv.invited_user_id !== req.user.id) return res.status(403).json({ success: false, message: 'This invitation is not for you' });

  await c2_query(
    `UPDATE team_invitations SET status = 'declined', responded_at = NOW() WHERE id = ?`,
    [Number(id)]
  );

  res.json({ success: true });
}));

/**
 * DELETE /api/invitations/:id
 * Cancel a pending invitation (team managers only)
 */
router.delete('/invitations/:id', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ success: false, message: 'Invalid invitation ID' });

  const [inv] = await c2_query(
    `SELECT ti.id, ti.team_id FROM team_invitations ti WHERE ti.id = ? AND ti.status = 'pending' LIMIT 1`,
    [Number(id)]
  );
  if (!inv) return res.status(404).json({ success: false, message: 'Invitation not found or already responded' });

  const { allowed } = await canManageTeam(inv.team_id, req.user);
  if (!allowed) return res.status(403).json({ success: false, message: 'You do not have permission to cancel this invitation' });

  await c2_query(`DELETE FROM team_invitations WHERE id = ?`, [Number(id)]);
  res.json({ success: true });
}));

// --- Centralized error handler ---
router.use((err, req, res, _next) => {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}:`, err);
  res.status(500).json({ success: false, message: 'An internal server error occurred' });
});

export default router;
