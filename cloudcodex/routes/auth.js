/**
 * API routes for user authentication in Cloud Codex
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import { c2_query, generateSessionToken, validateAndAutoLogin } from '../mysql_connect.js';
import { sendEmail } from '../services/email.js';
import { requireAuth } from '../middleware/auth.js';
import { isValidId, asyncHandler, errorHandler, DEFAULT_PERMISSIONS, BCRYPT_ROUNDS, APP_URL, isValidEmail, createDefaultPermissions } from './helpers/shared.js';

const router = express.Router();

// --- Helpers ---

const isValidUsername = (name) => /^[a-zA-Z0-9_]{3,32}$/.test(name);

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_RULES = [
  { test: (p) => p.length >= PASSWORD_MIN_LENGTH, msg: 'At least 8 characters' },
  { test: (p) => /[A-Z]/.test(p), msg: 'At least one uppercase letter' },
  { test: (p) => /[a-z]/.test(p), msg: 'At least one lowercase letter' },
  { test: (p) => /[0-9]/.test(p), msg: 'At least one number' },
  { test: (p) => /[^A-Za-z0-9]/.test(p), msg: 'At least one special character' },
];

function validatePassword(password) {
  const failures = PASSWORD_RULES.filter(r => !r.test(password)).map(r => r.msg);
  return failures;
}

/**
 * Generates a cryptographically random 6-digit numeric code for 2FA email verification.
 */
function generate2FACode() {
  const buf = crypto.randomBytes(4);
  const num = buf.readUInt32BE(0) % 1000000;
  return String(num).padStart(6, '0');
}

/**
 * POST /api/create-account
 * Body: { username, password, email, inviteToken }
 * Requires a valid invitation token to create an account.
 */
router.post('/create-account', asyncHandler(async (req, res) => {
  const { username, password, email, inviteToken } = req.body;

  if (!username || !password || !email) {
    return res.status(400).json({
      success: false,
      message: 'Username, password, and email are required'
    });
  }

  if (!inviteToken) {
    return res.status(400).json({
      success: false,
      message: 'An invitation is required to create an account'
    });
  }

  // Validate invitation token
  const [invitation] = await c2_query(
    `SELECT id, email AS invite_email, accepted, expires_at FROM user_invitations WHERE token = ? LIMIT 1`,
    [inviteToken]
  );

  if (!invitation || invitation.accepted || invitation.expires_at <= new Date()) {
    return res.status(400).json({
      success: false,
      message: 'Invalid or expired invitation. Please request a new one from your administrator.'
    });
  }

  // Email must match the invitation
  if (invitation.invite_email.toLowerCase() !== email.toLowerCase()) {
    return res.status(400).json({
      success: false,
      message: 'Email address must match the invitation'
    });
  }

  // Username: alphanumeric + underscores, 3-32 chars, no spaces
  if (!isValidUsername(username)) {
    return res.status(400).json({
      success: false,
      message: 'Username must be 3-32 characters and contain only letters, numbers, and underscores (no spaces)'
    });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, message: 'Invalid email address' });
  }

  // Validate password against all rules
  const passwordFailures = validatePassword(password);
  if (passwordFailures.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Password does not meet requirements',
      failures: passwordFailures
    });
  }

  // Check for duplicate username (case-insensitive)
  const [existingUsername] = await c2_query(
    `SELECT id FROM users WHERE LOWER(name) = LOWER(?) LIMIT 1`,
    [username]
  );
  if (existingUsername) {
    return res.status(409).json({ success: false, message: 'This username is already taken' });
  }

  // Check for duplicate email before inserting
  const [existingUser] = await c2_query(
    `SELECT id FROM users WHERE email = ? LIMIT 1`,
    [email]
  );
  if (existingUser) {
    return res.status(409).json({ success: false, message: 'An account with this email already exists' });
  }

  // Hash password before storing — never store plaintext passwords
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const result = await c2_query(
    `INSERT INTO users (name, password_hash, email, created_at)
     VALUES (?, ?, ?, NOW())`,
    [username, passwordHash, email]
  );

  const user = { id: result.insertId, name: username };
  const sessionToken = await generateSessionToken(user, req.ip, req.headers['user-agent']);

  // Create default permissions row for new user
  await createDefaultPermissions(result.insertId);

  // Mark invitation as accepted
  await c2_query(
    `UPDATE user_invitations SET accepted = TRUE WHERE id = ?`,
    [invitation.id]
  );

  res.status(201).json({ success: true, token: sessionToken, user });
}));

/**
 * GET /api/check-username/:username
 * Returns whether a username is available and valid.
 */
router.get('/check-username/:username', asyncHandler(async (req, res) => {
  const { username } = req.params;

  if (!isValidUsername(username)) {
    return res.json({ available: false, message: 'Username must be 3-32 characters: letters, numbers, and underscores only' });
  }

  const [existing] = await c2_query(
    `SELECT id FROM users WHERE LOWER(name) = LOWER(?) LIMIT 1`,
    [username]
  );

  res.json({ available: !existing, message: existing ? 'Username is already taken' : 'Username is available' });
}));

/**
 * POST /api/setup
 * Quick-start workspace setup for new users.
 * Creates a standalone personal archive. Workspace creation
 * is admin-only and handled via the admin console.
 * Body: { archiveName }
 */
router.post('/setup', requireAuth, asyncHandler(async (req, res) => {
  const { archiveName } = req.body;

  if (!archiveName?.trim()) {
    return res.status(400).json({ success: false, message: 'Provide a archive name' });
  }

  const projResult = await c2_query(
    `INSERT INTO archives (name, squad_id, created_by, read_access, write_access)
     VALUES (?, NULL, ?, JSON_ARRAY(?), JSON_ARRAY(?))`,
    [archiveName.trim(), req.user.id, req.user.id, req.user.id]
  );

  res.status(201).json({ success: true, workspaceId: null, squadId: null, archiveId: projResult.insertId });
}));

/**
 * POST /api/update-account
 * Body: { token, userId, name?, email?, password? }
 */
router.post('/update-account', asyncHandler(async (req, res) => {
  const { token, userId, name, email, password } = req.body;

  if (!token || !userId) {
    return res.status(400).json({ success: false, message: 'Token and userId are required' });
  }

  if (!isValidId(userId)) {
    return res.status(400).json({ success: false, message: 'Invalid userId' });
  }

  const sessionUser = await validateAndAutoLogin(token);
  if (!sessionUser || sessionUser.id !== Number(userId)) {
    return res.status(401).json({ success: false, message: 'Invalid session token' });
  }

  // Only update fields that were actually provided
  const fields = [];
  const params = [];

  if (name !== undefined) {
    if (!isValidUsername(name)) {
      return res.status(400).json({ success: false, message: 'Username must be 3-32 characters: letters, numbers, and underscores only' });
    }
    // Check uniqueness if changing name
    const [dup] = await c2_query(`SELECT id FROM users WHERE LOWER(name) = LOWER(?) AND id != ? LIMIT 1`, [name, Number(userId)]);
    if (dup) {
      return res.status(409).json({ success: false, message: 'This username is already taken' });
    }
    fields.push('name = ?');
    params.push(name);
  }
  if (email !== undefined) {
    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email address' });
    }
    // Check uniqueness if changing email
    const [dupEmail] = await c2_query(`SELECT id FROM users WHERE email = ? AND id != ? LIMIT 1`, [email, Number(userId)]);
    if (dupEmail) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists' });
    }
    fields.push('email = ?');
    params.push(email);
  }
  if (password !== undefined) {
    const pwFailures = validatePassword(password);
    if (pwFailures.length > 0) {
      return res.status(400).json({ success: false, message: 'Password does not meet requirements', failures: pwFailures });
    }
    // Hash updated password before storing
    fields.push('password_hash = ?');
    params.push(await bcrypt.hash(password, BCRYPT_ROUNDS));
  }

  if (!fields.length) {
    return res.status(400).json({ success: false, message: 'No fields provided to update' });
  }

  params.push(Number(userId));

  await c2_query(
    `UPDATE users SET ${fields.join(', ')} WHERE id = ?`,
    params
  );

  // If password was changed, invalidate all other sessions for this user
  if (password !== undefined) {
    await c2_query(`DELETE FROM sessions WHERE user_id = ? AND id != ?`, [Number(userId), token]);
  }

  res.json({ success: true });
}));

/**
 * POST /api/login
 * Body: { username, password }
 * If 2FA is enabled, returns { requires_2fa: true, twoFactorToken } instead of a session.
 */
router.post('/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required' });
  }

  // Fetch by username only — never compare passwords in SQL
  const users = await c2_query(
    `SELECT id, name, email, avatar_url, password_hash, two_factor_method, totp_secret, is_admin FROM users WHERE name = ? LIMIT 1`,
    [username]
  );

  // Use a constant-time comparison to prevent timing attacks.
  // The dummy hash is a real pre-computed bcrypt hash so that bcrypt.compare
  // takes the same amount of time whether or not the user exists.
  const DUMMY_HASH = '$2b$12$ECTURXTU8jI1L8AA/8m.iOiowQDH1nAW3raB55X5cPKzEjL9xDsSe';
  const hashToCompare = (users.length && users[0].password_hash) ? users[0].password_hash : DUMMY_HASH;
  const validPassword = await bcrypt.compare(password, hashToCompare);

  if (!validPassword || !users.length || !users[0].password_hash) {
    // Intentionally vague — don't reveal whether the username exists
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  const { password_hash: _, two_factor_method, totp_secret: __, ...user } = users[0];
  user.is_admin = Boolean(user.is_admin);

  // If 2FA is enabled (email or TOTP), require verification
  if (two_factor_method === 'email' || two_factor_method === 'totp') {
    // Create a short-lived temporary token to tie the 2FA verification back to this login attempt
    const twoFactorToken = crypto.randomBytes(32).toString('hex');
    await c2_query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
      [user.id, twoFactorToken]
    );

    if (two_factor_method === 'email') {
      // Invalidate any existing unused codes for this user
      await c2_query(
        `UPDATE two_factor_codes SET used = TRUE WHERE user_id = ? AND used = FALSE`,
        [user.id]
      );

      const code = generate2FACode();
      await c2_query(
        `INSERT INTO two_factor_codes (user_id, code, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
        [user.id, code]
      );

      try {
        await sendEmail({
          to: user.email,
          subject: 'Cloud Codex — Verification Code',
          text: `Your verification code is: ${code}\n\nThis code expires in 10 minutes. If you did not attempt to log in, please secure your account.`,
          html: `
            <h2>Verification Code</h2>
            <p>Your Cloud Codex verification code is:</p>
            <p style="font-size:32px;font-weight:bold;letter-spacing:6px;color:#2ca7db;margin:20px 0;">${code}</p>
            <p style="color:#999;font-size:13px;">This code expires in 10 minutes. If you did not attempt to log in, please secure your account.</p>
          `,
        });
      } catch (err) {
        console.error('Failed to send 2FA code email:', err);
        return res.status(500).json({ success: false, message: 'Failed to send 2FA code email.' });
      }
    }

    return res.json({ success: true, requires_2fa: true, method: two_factor_method, twoFactorToken });
  }

  const sessionToken = await generateSessionToken(user, req.ip, req.headers['user-agent']);

  res.json({ success: true, token: sessionToken, user });
}));

/**
 * POST /api/logout
 * Body: { token }
 */
router.post('/logout', asyncHandler(async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ success: false, message: 'Token is required' });
  }

  await c2_query(`DELETE FROM sessions WHERE id = ?`, [token]);

  res.json({ success: true });
}));

/**
 * POST /api/validate-session
 * Body: { token }
 */
router.post('/validate-session', asyncHandler(async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ valid: false, message: 'Token is required' });
  }

  const user = await validateAndAutoLogin(token);
  if (user) user.is_admin = Boolean(user.is_admin);

  res.json(user ? { valid: true, user } : { valid: false });
}));

/**
 * POST /api/get-user
 * Body: { token, userId }
 */
router.post('/get-user', asyncHandler(async (req, res) => {
  const { token, userId } = req.body;

  if (!token || !userId) {
    return res.status(400).json({ success: false, message: 'Token and userId are required' });
  }

  if (!isValidId(userId)) {
    return res.status(400).json({ success: false, message: 'Invalid userId' });
  }

  // Validate session ownership via validateAndAutoLogin instead of a raw subquery,
  // keeping auth logic consistent and centralized across routes
  const sessionUser = await validateAndAutoLogin(token);
  if (!sessionUser || sessionUser.id !== Number(userId)) {
    return res.status(401).json({ success: false, message: 'Invalid token or userId' });
  }

  const rows = await c2_query(
    `SELECT id, name, email, avatar_url, is_admin FROM users WHERE id = ? LIMIT 1`,
    [Number(userId)]
  );

  if (!rows.length) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }
  rows[0].is_admin = Boolean(rows[0].is_admin);

  // Include permissions
  const [perms] = await c2_query(
    `SELECT create_squad, create_archive, create_log FROM permissions WHERE user_id = ? LIMIT 1`,
    [Number(userId)]
  );

  res.json({
    success: true,
    user: rows[0],
    permissions: perms || DEFAULT_PERMISSIONS
  });
}));

/**
 * GET /api/users/search?q=...
 * Search for users by name or email (authenticated, min 2 chars)
 */
router.get('/users/search', requireAuth, asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) {
    return res.json({ success: true, users: [] });
  }

  const pattern = `%${q}%`;
  const users = await c2_query(
    `SELECT id, name, email, avatar_url FROM users WHERE name LIKE ? OR email LIKE ? ORDER BY name ASC LIMIT 10`,
    [pattern, pattern]
  );

  res.json({ success: true, users });
}));

/**
 * GET /api/permissions
 * Returns the authenticated user's permissions
 */
router.get('/permissions', requireAuth, asyncHandler(async (req, res) => {
  const [perms] = await c2_query(
    `SELECT create_squad, create_archive, create_log FROM permissions WHERE user_id = ? LIMIT 1`,
    [req.user.id]
  );

  res.json({
    success: true,
    permissions: perms || DEFAULT_PERMISSIONS
  });
}));

/**
 * GET /api/permissions/:userId
 * Returns a specific user's permissions (workspace owners only, or self)
 */
router.get('/permissions/:userId', requireAuth, asyncHandler(async (req, res) => {
  const { userId } = req.params;
  if (!isValidId(userId)) {
    return res.status(400).json({ success: false, message: 'Invalid userId' });
  }

  const targetId = Number(userId);

  // Allow self, admins, or workspace owners
  if (req.user.id !== targetId && !req.user.is_admin) {
    const [link] = await c2_query(
      `SELECT 1 FROM squad_members tm
       JOIN squads t ON tm.squad_id = t.id
       JOIN workspaces o ON t.workspace_id = o.id
       WHERE tm.user_id = ? AND o.owner = ?
       LIMIT 1`,
      [targetId, req.user.email]
    );
    if (!link) {
      return res.status(403).json({ success: false, message: 'You can only view permissions for users in your workspace' });
    }
  }

  const [perms] = await c2_query(
    `SELECT create_squad, create_archive, create_log FROM permissions WHERE user_id = ? LIMIT 1`,
    [targetId]
  );

  res.json({
    success: true,
    permissions: perms || DEFAULT_PERMISSIONS
  });
}));

/**
 * PUT /api/permissions/:userId
 * Update a user's permissions (only workspace owners can update permissions for users in their workspaces)
 * Body: { create_squad?, create_archive?, create_log? }
 */
router.put('/permissions/:userId', requireAuth, asyncHandler(async (req, res) => {
  const { userId } = req.params;
  if (!isValidId(userId)) {
    return res.status(400).json({ success: false, message: 'Invalid userId' });
  }

  const targetId = Number(userId);

  // Admins and workspace owners can update permissions
  if (!req.user.is_admin) {
    const [link] = await c2_query(
      `SELECT 1 FROM squad_members tm
       JOIN squads t ON tm.squad_id = t.id
       JOIN workspaces o ON t.workspace_id = o.id
       WHERE tm.user_id = ? AND o.owner = ?
       LIMIT 1`,
      [targetId, req.user.email]
    );
    if (!link) {
      return res.status(403).json({ success: false, message: 'Only workspace owners can update permissions for users in their workspace' });
    }
  }

  const { create_squad, create_archive, create_log } = req.body;
  const fields = [];
  const params = [];

  if (create_squad !== undefined)    { fields.push('create_squad = ?');    params.push(Boolean(create_squad));    }
  if (create_archive !== undefined) { fields.push('create_archive = ?'); params.push(Boolean(create_archive)); }
  if (create_log !== undefined)    { fields.push('create_log = ?');    params.push(Boolean(create_log));    }

  if (!fields.length) {
    return res.status(400).json({ success: false, message: 'No permission fields provided' });
  }

  params.push(targetId);

  // Upsert — create row if missing
  const [existing] = await c2_query(
    `SELECT id FROM permissions WHERE user_id = ? LIMIT 1`,
    [targetId]
  );

  if (existing) {
    await c2_query(`UPDATE permissions SET ${fields.join(', ')} WHERE user_id = ?`, params);
  } else {
    await c2_query(
      `INSERT INTO permissions (user_id, create_squad, create_archive, create_log) VALUES (?, ?, ?, ?)`,
      [targetId, Boolean(create_squad), Boolean(create_archive), create_log !== false]
    );
  }

  res.json({ success: true });
}));

// --- Password Reset ---

/**
 * Generates a cryptographically random 64-character hex token.
 */
function generateResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * POST /api/forgot-password
 * Body: { email }
 * Sends a password reset link to the user's email. Always responds with success
 * to prevent email enumeration.
 */
router.post('/forgot-password', asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ success: false, message: 'A valid email address is required' });
  }

  // Track start time so we can normalize response timing to prevent email enumeration
  const start = Date.now();

  // Always respond the same way — don't reveal whether the email exists
  const [user] = await c2_query(`SELECT id FROM users WHERE email = ? LIMIT 1`, [email]);

  if (user) {
    // Invalidate any existing unused tokens for this user
    await c2_query(
      `UPDATE password_reset_tokens SET used = TRUE WHERE user_id = ? AND used = FALSE`,
      [user.id]
    );

    const token = generateResetToken();
    await c2_query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))`,
      [user.id, token]
    );

    const resetUrl = `${APP_URL}/reset-password?token=${token}`;

    try {
      await sendEmail({
        to: email,
        subject: 'Cloud Codex — Password Reset',
        text: `You requested a password reset.\n\nClick the link below to reset your password (expires in 1 hour):\n${resetUrl}\n\nIf you did not request this, you can safely ignore this email.`,
        html: `
          <h2>Password Reset</h2>
          <p>You requested a password reset for your Cloud Codex account.</p>
          <p><a href="${resetUrl}" style="display:inline-block;padding:10px 20px;background:#4a9eff;color:#fff;text-decoration:none;border-radius:6px;">Reset Password</a></p>
          <p style="color:#999;font-size:13px;">This link expires in 1 hour. If you did not request this, you can safely ignore this email.</p>
        `,
      });
    } catch (err) {
      console.error('Failed to send password reset email:', err);
      return res.status(500).json({ success: false, message: 'Failed to send password reset email.' });
    }
  }

  // Ensure consistent response timing (minimum 200ms) to prevent email enumeration via timing
  const elapsed = Date.now() - start;
  const MIN_RESPONSE_MS = 200;
  if (elapsed < MIN_RESPONSE_MS) {
    await new Promise(resolve => setTimeout(resolve, MIN_RESPONSE_MS - elapsed));
  }

  // Always return success to prevent email enumeration
  res.json({ success: true, message: 'If an account with that email exists, a reset link has been sent.' });
}));

/**
 * POST /api/reset-password
 * Body: { token, password }
 * Validates the reset token and updates the user's password.
 */
router.post('/reset-password', asyncHandler(async (req, res) => {
  const { token, password } = req.body;

  if (!token || !password) {
    return res.status(400).json({ success: false, message: 'Token and new password are required' });
  }

  const pwFailures = validatePassword(password);
  if (pwFailures.length > 0) {
    return res.status(400).json({ success: false, message: 'Password does not meet requirements', failures: pwFailures });
  }

  const [resetRecord] = await c2_query(
    `SELECT id, user_id, expires_at, used FROM password_reset_tokens WHERE token = ? LIMIT 1`,
    [token]
  );

  if (!resetRecord || resetRecord.used || resetRecord.expires_at <= new Date()) {
    return res.status(400).json({ success: false, message: 'Invalid or expired reset link' });
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  await c2_query(`UPDATE users SET password_hash = ? WHERE id = ?`, [passwordHash, resetRecord.user_id]);
  await c2_query(`UPDATE password_reset_tokens SET used = TRUE WHERE id = ?`, [resetRecord.id]);

  // Invalidate all sessions for this user so they must log in with the new password
  await c2_query(`DELETE FROM sessions WHERE user_id = ?`, [resetRecord.user_id]);

  res.json({ success: true, message: 'Password has been reset. Please log in with your new password.' });
}));

// --- Two-Factor Authentication ---

/**
 * POST /api/2fa/verify
 * Body: { twoFactorToken, code }
 * Verifies the 2FA code (email or TOTP) and issues a session token.
 */
router.post('/2fa/verify', asyncHandler(async (req, res) => {
  const { twoFactorToken, code } = req.body;

  if (!twoFactorToken || !code) {
    return res.status(400).json({ success: false, message: 'Verification code is required' });
  }

  // Validate the temporary token (stored in password_reset_tokens for reuse)
  const [tokenRecord] = await c2_query(
    `SELECT id, user_id, expires_at, used FROM password_reset_tokens WHERE token = ? LIMIT 1`,
    [twoFactorToken]
  );

  if (!tokenRecord || tokenRecord.used || tokenRecord.expires_at <= new Date()) {
    return res.status(401).json({ success: false, message: 'Verification session expired. Please log in again.' });
  }

  // Determine which 2FA method the user uses
  const [userRow] = await c2_query(
    `SELECT two_factor_method, totp_secret FROM users WHERE id = ? LIMIT 1`,
    [tokenRecord.user_id]
  );

  let verified = false;

  if (userRow?.two_factor_method === 'totp' && userRow.totp_secret) {
    // Validate TOTP code
    const totp = new OTPAuth.TOTP({
      issuer: 'Cloud Codex',
      label: 'Cloud Codex',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(userRow.totp_secret),
    });
    const delta = totp.validate({ token: code, window: 1 });
    verified = delta !== null;
  } else if (userRow?.two_factor_method === 'email') {
    // Validate email 2FA code
    const [codeRecord] = await c2_query(
      `SELECT id, expires_at FROM two_factor_codes WHERE user_id = ? AND code = ? AND used = FALSE ORDER BY created_at DESC LIMIT 1`,
      [tokenRecord.user_id, code]
    );
    if (codeRecord && codeRecord.expires_at > new Date()) {
      await c2_query(`UPDATE two_factor_codes SET used = TRUE WHERE id = ?`, [codeRecord.id]);
      verified = true;
    }
  }

  if (!verified) {
    return res.status(401).json({ success: false, message: 'Invalid or expired verification code' });
  }

  // Mark token as used
  await c2_query(`UPDATE password_reset_tokens SET used = TRUE WHERE id = ?`, [tokenRecord.id]);

  // Fetch user and create session
  const [user] = await c2_query(
    `SELECT id, name, avatar_url, is_admin FROM users WHERE id = ? LIMIT 1`,
    [tokenRecord.user_id]
  );

  if (!user) {
    return res.status(401).json({ success: false, message: 'User not found' });
  }

  user.is_admin = Boolean(user.is_admin);
  const sessionToken = await generateSessionToken(user, req.ip, req.headers['user-agent']);

  res.json({ success: true, token: sessionToken, user });
}));

/**
 * POST /api/2fa/enable
 * Body: { method: 'email' | 'totp' }
 * For 'email': enables immediately.
 * For 'totp': generates a secret, emails the QR code to the user, returns a setup token.
 *   The user must then call POST /api/2fa/totp/confirm with the setup token and a code from their app.
 */
router.post('/2fa/enable', requireAuth, asyncHandler(async (req, res) => {
  const method = req.body.method || 'email';

  if (method === 'email') {
    await c2_query(`UPDATE users SET two_factor_method = 'email', totp_secret = NULL WHERE id = ?`, [req.user.id]);
    return res.json({ success: true, message: 'Email two-factor authentication has been enabled.' });
  }

  if (method === 'totp') {
    // Generate a TOTP secret
    const secret = new OTPAuth.Secret({ size: 20 });

    const totp = new OTPAuth.TOTP({
      issuer: 'Cloud Codex',
      label: req.user.email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret,
    });

    const otpauthUri = totp.toString();

    // Generate QR code as data URL
    const qrDataUrl = await QRCode.toDataURL(otpauthUri, { width: 256, margin: 2 });

    // Store the secret temporarily (not active yet — user must confirm with a valid code)
    // We store it in the totp_secret column but keep method unchanged until confirmed
    await c2_query(`UPDATE users SET totp_secret = ? WHERE id = ?`, [secret.base32, req.user.id]);

    // Create a setup token to tie the confirmation back
    const setupToken = crypto.randomBytes(32).toString('hex');
    await c2_query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 15 MINUTE))`,
      [req.user.id, setupToken]
    );

    // Email the QR code to the user
    try {
      await sendEmail({
        to: req.user.email,
        subject: 'Cloud Codex — Authenticator App Setup',
        text: `You requested to set up an authenticator app for Cloud Codex.\n\nOpen your authenticator app (e.g. Google Authenticator, Authy) and scan the QR code attached to this email, or manually enter this secret key:\n\n${secret.base32}\n\nThen enter the 6-digit code from your app into Cloud Codex to complete setup.`,
        html: `
          <h2>Authenticator App Setup</h2>
          <p>Scan the QR code below with your authenticator app (e.g. Google Authenticator, Authy):</p>
          <p style="text-align:center;"><img src="${qrDataUrl}" alt="TOTP QR Code" width="256" height="256" /></p>
          <p style="color:#999;font-size:13px;">Or manually enter this secret key: <strong>${secret.base32}</strong></p>
          <p>Then enter the 6-digit code from your app into Cloud Codex to complete setup.</p>
        `,
      });
    } catch (err) {
      console.error('Failed to send TOTP setup email:', err);
      return res.status(500).json({ success: false, message: 'Failed to send TOTP setup email.' });
    }

    return res.json({
      success: true,
      message: 'A QR code has been sent to your email. Scan it with your authenticator app, then enter the code below to complete setup.',
      setupToken,
    });
  }

  return res.status(400).json({ success: false, message: 'Invalid method. Use "email" or "totp".' });
}));

/**
 * POST /api/2fa/totp/confirm
 * Body: { setupToken, code }
 * Verifies the user's first TOTP code to activate authenticator-app-based 2FA.
 */
router.post('/2fa/totp/confirm', requireAuth, asyncHandler(async (req, res) => {
  const { setupToken, code } = req.body;

  if (!setupToken || !code) {
    return res.status(400).json({ success: false, message: 'Setup token and verification code are required' });
  }

  // Validate setup token
  const [tokenRecord] = await c2_query(
    `SELECT id, user_id, expires_at, used FROM password_reset_tokens WHERE token = ? LIMIT 1`,
    [setupToken]
  );

  if (!tokenRecord || tokenRecord.used || tokenRecord.expires_at <= new Date() || tokenRecord.user_id !== req.user.id) {
    return res.status(401).json({ success: false, message: 'Setup session expired. Please start again.' });
  }

  // Get the stored secret
  const [userRow] = await c2_query(
    `SELECT totp_secret FROM users WHERE id = ? LIMIT 1`,
    [req.user.id]
  );

  if (!userRow?.totp_secret) {
    return res.status(400).json({ success: false, message: 'No authenticator setup in progress.' });
  }

  // Validate the TOTP code
  const totp = new OTPAuth.TOTP({
    issuer: 'Cloud Codex',
    label: 'Cloud Codex',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(userRow.totp_secret),
  });

  const delta = totp.validate({ token: code, window: 1 });
  if (delta === null) {
    return res.status(401).json({ success: false, message: 'Invalid code. Make sure your authenticator app is synced and try again.' });
  }

  // Activate TOTP
  await c2_query(`UPDATE users SET two_factor_method = 'totp' WHERE id = ?`, [req.user.id]);
  await c2_query(`UPDATE password_reset_tokens SET used = TRUE WHERE id = ?`, [tokenRecord.id]);

  res.json({ success: true, message: 'Authenticator app has been successfully linked.' });
}));

/**
 * POST /api/2fa/disable
 * Sends a verification code to the user's email. Returns a confirmToken.
 * The user must call POST /api/2fa/disable/confirm with the token and code to complete.
 */
router.post('/2fa/disable', requireAuth, asyncHandler(async (req, res) => {
  const [userRow] = await c2_query(`SELECT email, two_factor_method FROM users WHERE id = ? LIMIT 1`, [req.user.id]);
  if (!userRow || userRow.two_factor_method === 'none') {
    return res.json({ success: true, message: 'Two-factor authentication is already disabled.' });
  }

  // Invalidate any existing unused codes for this user
  await c2_query(`UPDATE two_factor_codes SET used = TRUE WHERE user_id = ? AND used = FALSE`, [req.user.id]);

  const code = generate2FACode();
  await c2_query(
    `INSERT INTO two_factor_codes (user_id, code, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
    [req.user.id, code]
  );

  const confirmToken = crypto.randomBytes(32).toString('hex');
  await c2_query(
    `INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
    [req.user.id, confirmToken]
  );

  try {
    await sendEmail({
      to: userRow.email,
      subject: 'Cloud Codex \u2014 Confirm Disable Two-Factor Authentication',
      text: `You requested to disable two-factor authentication on your Cloud Codex account.\n\nYour verification code is: ${code}\n\nThis code expires in 10 minutes. If you did not request this, please secure your account immediately.`,
      html: `
        <h2>Disable Two-Factor Authentication</h2>
        <p>You requested to disable 2FA on your Cloud Codex account. Enter this code to confirm:</p>
        <p style="font-size:32px;font-weight:bold;letter-spacing:6px;color:#e54545;margin:20px 0;">${code}</p>
        <p style="color:#999;font-size:13px;">This code expires in 10 minutes. If you did not request this, please secure your account immediately.</p>
      `,
    });
  } catch (err) {
    console.error('Failed to send 2FA disable confirmation email:', err);
    return res.status(500).json({ success: false, message: 'Failed to send 2FA disable confirmation email.' });
  }

  res.json({ success: true, confirmToken, message: 'A verification code has been sent to your email.' });
}));

/**
 * POST /api/2fa/disable/confirm
 * Body: { confirmToken, code }
 * Validates the email code and disables 2FA.
 */
router.post('/2fa/disable/confirm', requireAuth, asyncHandler(async (req, res) => {
  const { confirmToken, code } = req.body;

  if (!confirmToken || !code) {
    return res.status(400).json({ success: false, message: 'Confirmation token and verification code are required' });
  }

  // Validate confirm token
  const [tokenRecord] = await c2_query(
    `SELECT id, user_id, expires_at, used FROM password_reset_tokens WHERE token = ? LIMIT 1`,
    [confirmToken]
  );

  if (!tokenRecord || tokenRecord.used || tokenRecord.expires_at <= new Date() || tokenRecord.user_id !== req.user.id) {
    return res.status(401).json({ success: false, message: 'Verification session expired. Please try again.' });
  }

  // Validate email code
  const [codeRecord] = await c2_query(
    `SELECT id, expires_at FROM two_factor_codes WHERE user_id = ? AND code = ? AND used = FALSE ORDER BY created_at DESC LIMIT 1`,
    [req.user.id, code]
  );

  if (!codeRecord || codeRecord.expires_at <= new Date()) {
    return res.status(401).json({ success: false, message: 'Invalid or expired verification code' });
  }

  // Mark as used
  await c2_query(`UPDATE two_factor_codes SET used = TRUE WHERE id = ?`, [codeRecord.id]);
  await c2_query(`UPDATE password_reset_tokens SET used = TRUE WHERE id = ?`, [tokenRecord.id]);

  // Disable 2FA
  await c2_query(`UPDATE users SET two_factor_method = 'none', totp_secret = NULL WHERE id = ?`, [req.user.id]);
  await c2_query(`DELETE FROM two_factor_codes WHERE user_id = ? AND used = FALSE`, [req.user.id]);

  res.json({ success: true, message: 'Two-factor authentication has been disabled.' });
}));

/**
 * GET /api/2fa/status
 * Returns the authenticated user's current 2FA method.
 */
router.get('/2fa/status', requireAuth, asyncHandler(async (req, res) => {
  const [row] = await c2_query(
    `SELECT two_factor_method FROM users WHERE id = ? LIMIT 1`,
    [req.user.id]
  );

  const method = row?.two_factor_method ?? 'none';
  res.json({ success: true, method, enabled: method !== 'none' });
}));

// --- Centralized error handler ---

router.use(errorHandler);

export default router;