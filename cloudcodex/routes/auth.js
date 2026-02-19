/**
 * API routes for user authentication in Cloud Codex
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import { c2_query, generateSessionToken, validateAndAutoLogin } from '../mysql_connect.js';

const router = express.Router();

/**
 * POST /api/create-account
 */
router.post('/create-account', async (req, res) => {
  const { username, password, email } = req.body;

  if (!username || !password || !email) {
    return res.status(400).json({
      success: false,
      message: 'Username and password are required'
    });
  }

  try {
    const result = await c2_query(
      `INSERT INTO users (name, password_hash, created_at, email)
       VALUES (?, ?, NOW(), ?)`,
      [username, password, email]
    );

    const userId = result.insertId;
    const user = { id: userId, name: username };
    const sessionToken = await generateSessionToken(user);

    res.json({
      success: true,
      token: sessionToken,
      user
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error creating account. Username may already be taken.'
    });
  }
});

/**
 * POST /api/login
 */
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  const users = await c2_query(
    `SELECT id, name FROM users
     WHERE name = ? AND password_hash = ?
     LIMIT 1`,
    [username, password]
  );

  if (users.length === 1) {
    const user = users[0];
    const sessionToken = await generateSessionToken(user);

    res.json({
      success: true,
      token: sessionToken,
      user
    });
  } else {
    res.status(401).json({
      success: false,
      message: 'Invalid credentials'
    });
  }
});

/**
 * POST /api/logout
 */
router.post('/logout', async (req, res) => {
  const token = req.body.token;

  try {
    await c2_query(`DELETE FROM sessions WHERE id = ?`, [token]);
    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false, message: 'Error logging out' });
  }
});

/**
 * POST /api/validate-session
 */
router.post('/validate-session', async (req, res) => {
  const token = req.body.token;

  try {
    const user = await validateAndAutoLogin(token);

    if (user) {
      res.json({ valid: true, user });
    } else {
      res.json({ valid: false });
    }
  } catch {
    res.status(500).json({ valid: false, message: 'Error validating session' });
  }
});

export default router;
