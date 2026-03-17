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
  const sessionToken = await generateSessionToken(user);

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
  const sessionToken = await generateSessionToken(user);

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

  res.json({ success: true, user: rows[0] });
}));

// --- Centralized error handler ---

router.use((err, req, res, _next) => {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}:`, err);
  res.status(500).json({ success: false, message: 'An internal server error occurred' });
});

export default router;