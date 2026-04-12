/**
 * API routes for admin console in Cloud Codex
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { c2_query } from '../mysql_connect.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { sendEmail } from '../services/email.js';
import { isValidId, asyncHandler, errorHandler, BCRYPT_ROUNDS, APP_URL, isValidEmail, createDefaultPermissions, addSquadOwnerMember } from './helpers/shared.js';
import { getAllPresence, getActiveDocCount } from '../services/collab.js';

const router = express.Router();

/**
 * Ensures the admin super user exists in the database.
 * Called on server startup.
 */
export async function ensureAdminUser() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  const email = process.env.ADMIN_EMAIL;

  const [existing] = await c2_query(
    `SELECT id, is_admin FROM users WHERE LOWER(name) = LOWER(?) OR email = ? LIMIT 1`,
    [username, email]
  );

  if (existing) {
    // Always sync password and email from .env (the source of truth for admin creds)
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await c2_query(
      `UPDATE users SET is_admin = TRUE, password_hash = ?, email = ? WHERE id = ?`,
      [passwordHash, email, existing.id]
    );
    console.log('✔ Admin super user synced');
    return;
  }

  // Create the admin user
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const result = await c2_query(
    `INSERT INTO users (name, password_hash, email, is_admin, created_at)
     VALUES (?, ?, ?, TRUE, NOW())`,
    [username, passwordHash, email]
  );

  // Create default permissions row
  await createDefaultPermissions(result.insertId);

  console.log('✔ Admin super user created');
}

// ─── Admin status check ─────────────────────────────────────

/**
 * GET /api/admin/status
 * Returns whether the current user is an admin.
 */
router.get('/admin/status', requireAuth, asyncHandler(async (req, res) => {
  res.json({ success: true, isAdmin: Boolean(req.user.is_admin) });
}));

// ─── Workspace management (admin only) ───────────────────

/**
 * GET /api/admin/workspaces
 * List all workspaces (admin only).
 */
router.get('/admin/workspaces', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const workspaces = await c2_query(
    `SELECT o.id, o.name, o.owner, o.created_at,
            (SELECT COUNT(*) FROM squads t WHERE t.workspace_id = o.id) AS squad_count,
            (SELECT COUNT(DISTINCT tm.user_id) FROM squads t2 JOIN squad_members tm ON tm.squad_id = t2.id WHERE t2.workspace_id = o.id) AS member_count
     FROM workspaces o
     ORDER BY o.created_at DESC`
  );
  res.json({ success: true, workspaces: workspaces });
}));

/**
 * POST /api/admin/workspaces
 * Create a workspace (admin only).
 */
router.post('/admin/workspaces', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { name, ownerEmail, squadName, archiveName } = req.body;
  if (!name?.trim()) {
    return res.status(400).json({ success: false, message: 'Workspace name is required' });
  }
  if (name.trim().length > 255) {
    return res.status(400).json({ success: false, message: 'Workspace name must be 255 characters or less' });
  }
  if (!ownerEmail?.trim() || !isValidEmail(ownerEmail.trim())) {
    return res.status(400).json({ success: false, message: 'A valid owner email is required' });
  }

  // Verify owner user exists
  const [owner] = await c2_query(
    `SELECT id FROM users WHERE email = ? LIMIT 1`,
    [ownerEmail.trim()]
  );
  if (!owner) {
    return res.status(400).json({ success: false, message: 'No user found with that email' });
  }

  const workspaceResult = await c2_query(
    `INSERT INTO workspaces (name, owner) VALUES (?, ?)`,
    [name.trim(), ownerEmail.trim()]
  );
  const workspaceId = workspaceResult.insertId;

  let squadId = null;
  let archiveId = null;

  if (squadName?.trim()) {
    const squadResult = await c2_query(
      `INSERT INTO squads (workspace_id, name, created_by) VALUES (?, ?, ?)`,
      [workspaceId, squadName.trim(), owner.id]
    );
    squadId = squadResult.insertId;

    await addSquadOwnerMember(squadId, owner.id);

    if (archiveName?.trim()) {
      const projResult = await c2_query(
        `INSERT INTO archives (name, squad_id, created_by, read_access, write_access)
         VALUES (?, ?, ?, JSON_ARRAY(?), JSON_ARRAY(?))`,
        [archiveName.trim(), squadId, owner.id, owner.id, owner.id]
      );
      archiveId = projResult.insertId;
    }
  }

  res.status(201).json({ success: true, workspaceId, squadId, archiveId });
}));

/**
 * DELETE /api/admin/workspaces/:id
 * Delete a workspace (admin only).
 */
router.delete('/admin/workspaces/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: 'Invalid workspace ID' });
  }

  const [workspace] = await c2_query(`SELECT id FROM workspaces WHERE id = ? LIMIT 1`, [Number(id)]);
  if (!workspace) {
    return res.status(404).json({ success: false, message: 'Workspace not found' });
  }

  await c2_query(`DELETE FROM workspaces WHERE id = ?`, [Number(id)]);
  res.json({ success: true });
}));

// ─── User management (admin only) ───────────────────────────

/**
 * GET /api/admin/users
 * List all users (admin only).
 */
router.get('/admin/users', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const users = await c2_query(
    `SELECT u.id, u.name, u.email, u.avatar_url, u.is_admin, u.created_at,
            (SELECT COUNT(*) FROM squad_members tm WHERE tm.user_id = u.id) AS squad_count
     FROM users u
     ORDER BY u.created_at DESC`
  );
  res.json({ success: true, users });
}));

/**
 * DELETE /api/admin/users/:id
 * Delete a user (admin only, cannot delete self).
 */
router.delete('/admin/users/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: 'Invalid user ID' });
  }
  if (Number(id) === req.user.id) {
    return res.status(400).json({ success: false, message: 'Cannot delete your own account' });
  }

  const [user] = await c2_query(`SELECT id, is_admin FROM users WHERE id = ? LIMIT 1`, [Number(id)]);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }
  if (user.is_admin) {
    return res.status(400).json({ success: false, message: 'Cannot delete an admin user' });
  }

  await c2_query(`DELETE FROM users WHERE id = ?`, [Number(id)]);
  res.json({ success: true });
}));

// ─── User invitation (admin only) ───────────────────────────

/**
 * GET /api/admin/invitations
 * List all pending user invitations (admin only).
 */
router.get('/admin/invitations', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const invitations = await c2_query(
    `SELECT ui.id, ui.email, ui.accepted, ui.created_at, ui.expires_at,
            u.name AS invited_by_name
     FROM user_invitations ui
     JOIN users u ON u.id = ui.invited_by
     ORDER BY ui.created_at DESC`
  );
  res.json({ success: true, invitations });
}));

/**
 * POST /api/admin/invitations
 * Invite a new user by email (admin only). Sends a signup link.
 */
router.post('/admin/invitations', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email?.trim() || !isValidEmail(email.trim())) {
    return res.status(400).json({ success: false, message: 'A valid email address is required' });
  }

  const trimmedEmail = email.trim();

  // Check if user already exists
  const [existingUser] = await c2_query(
    `SELECT id FROM users WHERE email = ? LIMIT 1`,
    [trimmedEmail]
  );
  if (existingUser) {
    return res.status(409).json({ success: false, message: 'A user with this email already exists' });
  }

  // Check for existing pending invitation
  const [existingInvite] = await c2_query(
    `SELECT id FROM user_invitations WHERE email = ? AND accepted = FALSE AND expires_at > NOW() LIMIT 1`,
    [trimmedEmail]
  );
  if (existingInvite) {
    return res.status(409).json({ success: false, message: 'An invitation has already been sent to this email' });
  }

  const token = crypto.randomBytes(32).toString('hex');

  await c2_query(
    `INSERT INTO user_invitations (email, token, invited_by, expires_at)
     VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))`,
    [trimmedEmail, token, req.user.id]
  );

  const signupUrl = `${APP_URL}/?invite=${token}`;

  try {
    await sendEmail({
      to: trimmedEmail,
      subject: 'Cloud Codex — You\'ve Been Invited!',
      text: `You've been invited to join Cloud Codex!\n\nClick the link below to create your account (expires in 7 days):\n${signupUrl}\n\nIf you did not expect this invitation, you can safely ignore this email.`,
      html: `
        <h2>You're Invited to Cloud Codex!</h2>
        <p>You've been invited to join Cloud Codex, a collaborative document workspace.</p>
        <p><a href="${signupUrl}" style="display:inline-block;padding:12px 24px;background:#2ca7db;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">Create Your Account</a></p>
        <p style="color:#999;font-size:13px;">This invitation expires in 7 days. If you did not expect this, you can safely ignore this email.</p>
      `,
    });
  } catch (err) {
    console.error('Failed to send user invitation email:', err);
    return res.status(500).json({ success: false, message: 'Failed to send invitation email' });
  }

  res.status(201).json({ success: true, message: `Invitation sent to ${trimmedEmail}` });
}));

/**
 * DELETE /api/admin/invitations/:id
 * Cancel/revoke a user invitation (admin only).
 */
router.delete('/admin/invitations/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: 'Invalid invitation ID' });
  }

  await c2_query(`DELETE FROM user_invitations WHERE id = ?`, [Number(id)]);
  res.json({ success: true });
}));

/**
 * GET /api/invite/validate/:token
 * Validate an invitation token (public — used during signup).
 */
router.get('/invite/validate/:token', asyncHandler(async (req, res) => {
  const { token } = req.params;

  const [invitation] = await c2_query(
    `SELECT id, email, accepted, expires_at FROM user_invitations WHERE token = ? LIMIT 1`,
    [token]
  );

  if (!invitation || invitation.accepted || invitation.expires_at <= new Date()) {
    return res.json({ valid: false, message: 'Invalid or expired invitation' });
  }

  res.json({ valid: true, email: invitation.email });
}));

// ─── User permissions management (admin only) ──────────────

/**
 * GET /api/admin/users/:id/permissions
 * Get a user's global permissions.
 */
router.get('/admin/users/:id/permissions', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: 'Invalid user ID' });
  }

  const [user] = await c2_query(`SELECT id FROM users WHERE id = ? LIMIT 1`, [Number(id)]);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  const [perms] = await c2_query(
    `SELECT create_squad, create_archive, create_log FROM permissions WHERE user_id = ? LIMIT 1`,
    [Number(id)]
  );

  res.json({
    success: true,
    permissions: perms || { create_squad: false, create_archive: false, create_log: true },
  });
}));

/**
 * PUT /api/admin/users/:id/permissions
 * Update a user's global permissions.
 */
router.put('/admin/users/:id/permissions', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: 'Invalid user ID' });
  }

  const [user] = await c2_query(`SELECT id FROM users WHERE id = ? LIMIT 1`, [Number(id)]);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  const { create_squad, create_archive, create_log } = req.body;

  // Upsert the permissions row
  await c2_query(
    `INSERT INTO permissions (user_id, create_squad, create_archive, create_log)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE create_squad = VALUES(create_squad), create_archive = VALUES(create_archive), create_log = VALUES(create_log)`,
    [Number(id), Boolean(create_squad), Boolean(create_archive), Boolean(create_log)]
  );

  res.json({ success: true });
}));

/**
 * PUT /api/admin/users/:id/admin
 * Toggle a user's admin status.
 */
router.put('/admin/users/:id/admin', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: 'Invalid user ID' });
  }
  if (Number(id) === req.user.id) {
    return res.status(400).json({ success: false, message: 'Cannot change your own admin status' });
  }

  const [user] = await c2_query(`SELECT id, is_admin FROM users WHERE id = ? LIMIT 1`, [Number(id)]);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  const { is_admin } = req.body;
  await c2_query(`UPDATE users SET is_admin = ? WHERE id = ?`, [Boolean(is_admin), Number(id)]);

  res.json({ success: true });
}));

// ─── Squad management (admin only) ─────────────────────────

/**
 * GET /api/admin/squads
 * List all squads with member counts and workspace info.
 */
router.get('/admin/squads', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const squads = await c2_query(
    `SELECT t.id, t.name, t.created_at, o.name AS workspace_name, o.id AS workspace_id,
            u.name AS created_by_name,
            (SELECT COUNT(*) FROM squad_members tm WHERE tm.squad_id = t.id) AS member_count,
            (SELECT COUNT(*) FROM archives p WHERE p.squad_id = t.id) AS archive_count
     FROM squads t
     LEFT JOIN workspaces o ON t.workspace_id = o.id
     LEFT JOIN users u ON t.created_by = u.id
     ORDER BY t.created_at DESC`
  );
  res.json({ success: true, squads });
}));

/**
 * GET /api/admin/squads/:id/members
 * List all members of a squad with their roles and permissions.
 */
router.get('/admin/squads/:id/members', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: 'Invalid squad ID' });
  }

  const [squad] = await c2_query(`SELECT id, name FROM squads WHERE id = ? LIMIT 1`, [Number(id)]);
  if (!squad) {
    return res.status(404).json({ success: false, message: 'Squad not found' });
  }

  const members = await c2_query(
    `SELECT tm.id, tm.user_id, tm.role, tm.can_read, tm.can_write, tm.can_create_log,
            tm.can_create_archive, tm.can_manage_members, tm.can_delete_version, tm.can_publish,
            u.name, u.email, u.avatar_url
     FROM squad_members tm
     JOIN users u ON u.id = tm.user_id
     WHERE tm.squad_id = ?
     ORDER BY tm.role = 'owner' DESC, u.name ASC`,
    [Number(id)]
  );

  res.json({ success: true, squad: squad.name, members });
}));

/**
 * PUT /api/admin/squads/:id/members/:userId
 * Update a squad member's role and permissions.
 */
router.put('/admin/squads/:id/members/:userId', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { id, userId } = req.params;
  if (!isValidId(id) || !isValidId(userId)) {
    return res.status(400).json({ success: false, message: 'Invalid IDs' });
  }

  const [member] = await c2_query(
    `SELECT id FROM squad_members WHERE squad_id = ? AND user_id = ? LIMIT 1`,
    [Number(id), Number(userId)]
  );
  if (!member) {
    return res.status(404).json({ success: false, message: 'Member not found' });
  }

  const { role, can_read, can_write, can_create_log, can_create_archive, can_manage_members, can_delete_version, can_publish } = req.body;

  const validRoles = ['member', 'admin', 'owner'];
  if (role && !validRoles.includes(role)) {
    return res.status(400).json({ success: false, message: 'Invalid role' });
  }

  await c2_query(
    `UPDATE squad_members
     SET role = COALESCE(?, role),
         can_read = COALESCE(?, can_read),
         can_write = COALESCE(?, can_write),
         can_create_log = COALESCE(?, can_create_log),
         can_create_archive = COALESCE(?, can_create_archive),
         can_manage_members = COALESCE(?, can_manage_members),
         can_delete_version = COALESCE(?, can_delete_version),
         can_publish = COALESCE(?, can_publish)
     WHERE squad_id = ? AND user_id = ?`,
    [role || null, can_read ?? null, can_write ?? null, can_create_log ?? null, can_create_archive ?? null,
     can_manage_members ?? null, can_delete_version ?? null, can_publish ?? null,
     Number(id), Number(userId)]
  );

  res.json({ success: true });
}));

/**
 * DELETE /api/admin/squads/:id/members/:userId
 * Remove a member from a squad.
 */
router.delete('/admin/squads/:id/members/:userId', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { id, userId } = req.params;
  if (!isValidId(id) || !isValidId(userId)) {
    return res.status(400).json({ success: false, message: 'Invalid IDs' });
  }

  const result = await c2_query(
    `DELETE FROM squad_members WHERE squad_id = ? AND user_id = ?`,
    [Number(id), Number(userId)]
  );

  if (result.affectedRows === 0) {
    return res.status(404).json({ success: false, message: 'Member not found' });
  }

  res.json({ success: true });
}));

// ─── Live presence (admin only) ────────────────────────────

/**
 * GET /api/admin/presence
 * Returns all online users and what they are editing (admin-only, unfiltered).
 */
router.get('/admin/presence', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const allPresence = getAllPresence();
  const logIds = Object.keys(allPresence).map(Number).filter(id => id > 0);

  const logInfo = {};
  if (logIds.length > 0) {
    const placeholders = logIds.map(() => '?').join(',');
    const logs = await c2_query(
      `SELECT pg.id, pg.title, p.name AS archive_name, p.id AS archive_id
       FROM logs pg
       JOIN archives p ON pg.archive_id = p.id
       WHERE pg.id IN (${placeholders})`,
      logIds
    );
    for (const log of logs) {
      logInfo[log.id] = { title: log.title, archive_name: log.archive_name, archive_id: log.archive_id };
    }
  }

  // Build a flat list of unique online users + an enriched presence map
  const onlineUsersMap = new Map();
  const sessions = {};

  for (const [logId, users] of Object.entries(allPresence)) {
    const info = logInfo[logId] || { title: 'Unknown', archive_name: 'Unknown', archive_id: null };
    sessions[logId] = { ...info, users };
    for (const u of users) {
      if (!onlineUsersMap.has(u.id)) {
        onlineUsersMap.set(u.id, { id: u.id, name: u.name, avatar_url: u.avatar_url, editing: [] });
      }
      onlineUsersMap.get(u.id).editing.push({ logId: Number(logId), title: info.title, archive_name: info.archive_name });
    }
  }

  res.json({
    success: true,
    activeDocCount: getActiveDocCount(),
    onlineUsers: Array.from(onlineUsersMap.values()),
    sessions,
  });
}));

// ─── Admin overview stats ───────────────────────────────────

/**
 * GET /api/admin/stats
 * Overview statistics for the admin console.
 */
router.get('/admin/stats', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const [[counts]] = await Promise.all([
    c2_query(
      `SELECT
         (SELECT COUNT(*) FROM users) AS userCount,
         (SELECT COUNT(*) FROM workspaces) AS workspaceCount,
         (SELECT COUNT(*) FROM squads) AS squadCount,
         (SELECT COUNT(*) FROM archives) AS archiveCount,
         (SELECT COUNT(*) FROM logs) AS logCount,
         (SELECT COUNT(*) FROM user_invitations WHERE accepted = FALSE AND expires_at > NOW()) AS pendingInviteCount`
    ),
  ]);

  res.json({
    success: true,
    stats: { ...counts, onlineUserCount: getAllPresence() ? Object.values(getAllPresence()).reduce((s, u) => { u.forEach(x => s.add(x.id)); return s; }, new Set()).size : 0, activeDocCount: getActiveDocCount() },
  });
}));

router.use(errorHandler);

export default router;
