/**
 * API routes for user authentication in Cloud Codex
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import bcrypt from 'bcrypt';
import { c2_query, generateSessionToken, validateAndAutoLogin } from '../mysql_connect.js';

const router = express.Router();

const BCRYPT_ROUNDS = 12;

// --- Helpers ---

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const isValidId = (id) => Number.isInteger(Number(id)) && Number(id) > 0;

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
 */
router.post('/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required' });
  }

  // Fetch by username only — never compare passwords in SQL
  const users = await c2_query(
    `SELECT id, name, password_hash FROM users WHERE name = ? LIMIT 1`,
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

  const { password_hash: _, ...user } = users[0]; // strip hash from response
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
router.get('/users/search', asyncHandler(async (req, res) => {
  const token =
    req.headers['authorization']?.replace('Bearer ', '') ||
    null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  const user = await validateAndAutoLogin(token);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Invalid or expired session' });
  }

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
router.get('/permissions', asyncHandler(async (req, res) => {
  const token =
    req.headers['authorization']?.replace('Bearer ', '') ||
    req.body?.token ||
    null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  const user = await validateAndAutoLogin(token);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Invalid or expired session' });
  }

  const [perms] = await c2_query(
    `SELECT create_team, create_project, create_page FROM permissions WHERE user_id = ? LIMIT 1`,
    [user.id]
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
router.get('/permissions/:userId', asyncHandler(async (req, res) => {
  const token =
    req.headers['authorization']?.replace('Bearer ', '') ||
    null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  const caller = await validateAndAutoLogin(token);
  if (!caller) {
    return res.status(401).json({ success: false, message: 'Invalid or expired session' });
  }

  const { userId } = req.params;
  if (!isValidId(userId)) {
    return res.status(400).json({ success: false, message: 'Invalid userId' });
  }

  const targetId = Number(userId);

  // Allow self or org owners
  if (caller.id !== targetId) {
    const orgs = await c2_query(
      `SELECT id FROM organizations WHERE owner = ? LIMIT 1`,
      [caller.email]
    );
    if (!orgs.length) {
      return res.status(403).json({ success: false, message: 'Only organization owners can view other users\' permissions' });
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
router.put('/permissions/:userId', asyncHandler(async (req, res) => {
  const token =
    req.headers['authorization']?.replace('Bearer ', '') ||
    req.body?.token ||
    null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  const caller = await validateAndAutoLogin(token);
  if (!caller) {
    return res.status(401).json({ success: false, message: 'Invalid or expired session' });
  }

  const { userId } = req.params;
  if (!isValidId(userId)) {
    return res.status(400).json({ success: false, message: 'Invalid userId' });
  }

  const targetId = Number(userId);

  // Users can update their own permissions, or org owners can update others'
  if (caller.id !== targetId) {
    // Check if caller owns any org — only org owners can modify others' permissions
    const orgs = await c2_query(
      `SELECT id FROM organizations WHERE owner = ? LIMIT 1`,
      [caller.email]
    );
    if (!orgs.length) {
      return res.status(403).json({ success: false, message: 'Only organization owners can update other users\' permissions' });
    }
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

// --- Centralized error handler ---

router.use((err, req, res, _next) => {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}:`, err);
  res.status(500).json({ success: false, message: 'An internal server error occurred' });
});

export default router;