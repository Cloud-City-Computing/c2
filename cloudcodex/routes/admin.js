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

// ─── Admin overview stats ───────────────────────────────────

/**
 * GET /api/admin/stats
 * Overview statistics for the admin console.
 */
router.get('/admin/stats', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const [[{ userCount }]] = await Promise.all([
    c2_query(`SELECT COUNT(*) AS userCount FROM users`),
  ]);
  const [[{ workspaceCount }]] = await Promise.all([
    c2_query(`SELECT COUNT(*) AS workspaceCount FROM workspaces`),
  ]);
  const [[{ squadCount }]] = await Promise.all([
    c2_query(`SELECT COUNT(*) AS squadCount FROM squads`),
  ]);
  const [[{ archiveCount }]] = await Promise.all([
    c2_query(`SELECT COUNT(*) AS archiveCount FROM archives`),
  ]);
  const [[{ logCount }]] = await Promise.all([
    c2_query(`SELECT COUNT(*) AS logCount FROM logs`),
  ]);
  const [[{ pendingInviteCount }]] = await Promise.all([
    c2_query(`SELECT COUNT(*) AS pendingInviteCount FROM user_invitations WHERE accepted = FALSE AND expires_at > NOW()`),
  ]);

  res.json({
    success: true,
    stats: { userCount, workspaceCount, squadCount, archiveCount, logCount, pendingInviteCount },
  });
}));

router.use(errorHandler);

export default router;
