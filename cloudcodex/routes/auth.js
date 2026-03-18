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

const router = express.Router();

const BCRYPT_ROUNDS = 12;

// --- Helpers ---

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const isValidId = (id) => Number.isInteger(Number(id)) && Number(id) > 0;

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
 * Body: { username, password, email }
 */
router.post('/create-account', asyncHandler(async (req, res) => {
  const { username, password, email } = req.body;

  if (!username || !password || !email) {
    return res.status(400).json({
      success: false,
      // Fixed: original message omitted 'email' despite validating all three fields
      message: 'Username, password, and email are required'
    });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, message: 'Invalid email address' });
  }

  if (password.length < 8) {
    return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
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
  await c2_query(
    `INSERT INTO permissions (user_id, create_team, create_project, create_page) VALUES (?, TRUE, TRUE, TRUE)`,
    [result.insertId]
  );

  res.status(201).json({ success: true, token: sessionToken, user });
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

  if (name !== undefined)  { fields.push('name = ?');          params.push(name); }
  if (email !== undefined) {
    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email address' });
    }
    fields.push('email = ?');
    params.push(email);
  }
  if (password !== undefined) {
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
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
    `SELECT id, name, email, password_hash, two_factor_method, totp_secret FROM users WHERE name = ? LIMIT 1`,
    [username]
  );

  // Use a constant-time comparison to prevent timing attacks
  const validPassword = users.length
    ? await bcrypt.compare(password, users[0].password_hash)
    : await bcrypt.compare(password, '$2b$12$invalidhashfortimingpurposesonly00000000000');

  if (!validPassword || !users.length) {
    // Intentionally vague — don't reveal whether the username exists
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  const { password_hash: _, two_factor_method, totp_secret, ...user } = users[0];

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
    `SELECT id, name, email FROM users WHERE id = ? LIMIT 1`,
    [Number(userId)]
  );

  if (!rows.length) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  // Include permissions
  const [perms] = await c2_query(
    `SELECT create_team, create_project, create_page FROM permissions WHERE user_id = ? LIMIT 1`,
    [Number(userId)]
  );

  res.json({
    success: true,
    user: rows[0],
    permissions: perms || { create_team: false, create_project: false, create_page: true }
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
    `SELECT id, name, email FROM users WHERE name LIKE ? OR email LIKE ? ORDER BY name ASC LIMIT 10`,
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
    `SELECT create_team, create_project, create_page FROM permissions WHERE user_id = ? LIMIT 1`,
    [req.user.id]
  );

  res.json({
    success: true,
    permissions: perms || { create_team: false, create_project: false, create_page: true }
  });
}));

/**
 * GET /api/permissions/:userId
 * Returns a specific user's permissions (org owners only, or self)
 */
router.get('/permissions/:userId', requireAuth, asyncHandler(async (req, res) => {
  const { userId } = req.params;
  if (!isValidId(userId)) {
    return res.status(400).json({ success: false, message: 'Invalid userId' });
  }

  const targetId = Number(userId);

  // Allow self; org owners may view permissions of users in their org
  if (req.user.id !== targetId) {
    const [link] = await c2_query(
      `SELECT 1 FROM team_members tm
       JOIN teams t ON tm.team_id = t.id
       JOIN organizations o ON t.organization_id = o.id
       WHERE tm.user_id = ? AND o.owner = ?
       LIMIT 1`,
      [targetId, req.user.email]
    );
    if (!link) {
      return res.status(403).json({ success: false, message: 'You can only view permissions for users in your organization' });
    }
  }

  const [perms] = await c2_query(
    `SELECT create_team, create_project, create_page FROM permissions WHERE user_id = ? LIMIT 1`,
    [targetId]
  );

  res.json({
    success: true,
    permissions: perms || { create_team: false, create_project: false, create_page: true }
  });
}));

/**
 * PUT /api/permissions/:userId
 * Update a user's permissions (only org owners can update permissions for users in their orgs)
 * Body: { create_team?, create_project?, create_page? }
 */
router.put('/permissions/:userId', requireAuth, asyncHandler(async (req, res) => {
  const { userId } = req.params;
  if (!isValidId(userId)) {
    return res.status(400).json({ success: false, message: 'Invalid userId' });
  }

  const targetId = Number(userId);

  // Only org owners can update permissions for users in their organization
  const [link] = await c2_query(
    `SELECT 1 FROM team_members tm
     JOIN teams t ON tm.team_id = t.id
     JOIN organizations o ON t.organization_id = o.id
     WHERE tm.user_id = ? AND o.owner = ?
     LIMIT 1`,
    [targetId, req.user.email]
  );
  if (!link) {
    return res.status(403).json({ success: false, message: 'Only organization owners can update permissions for users in their organization' });
  }

  const { create_team, create_project, create_page } = req.body;
  const fields = [];
  const params = [];

  if (create_team !== undefined)    { fields.push('create_team = ?');    params.push(!!create_team);    }
  if (create_project !== undefined) { fields.push('create_project = ?'); params.push(!!create_project); }
  if (create_page !== undefined)    { fields.push('create_page = ?');    params.push(!!create_page);    }

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
      `INSERT INTO permissions (user_id, create_team, create_project, create_page) VALUES (?, ?, ?, ?)`,
      [targetId, !!create_team, !!create_project, create_page !== false]
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

const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

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
    }
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

  if (password.length < 8) {
    return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
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
    `SELECT id, name FROM users WHERE id = ? LIMIT 1`,
    [tokenRecord.user_id]
  );

  if (!user) {
    return res.status(401).json({ success: false, message: 'User not found' });
  }

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

router.use((err, req, res, _next) => {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}:`, err);
  res.status(500).json({ success: false, message: 'An internal server error occurred' });
});

export default router;