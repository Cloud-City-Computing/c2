/**
 * OAuth / SSO routes for Cloud Codex
 *
 * Supports Google Workspace SSO. If GOOGLE_OAUTH_DOMAIN is set,
 * users from that domain can sign in / auto-create accounts
 * without a traditional invitation.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { c2_query, generateSessionToken } from '../mysql_connect.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, errorHandler, DEFAULT_PERMISSIONS } from './helpers/shared.js';

const router = express.Router();

// --- Google OAuth configuration ---

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_OAUTH_DOMAIN = process.env.GOOGLE_OAUTH_DOMAIN; // e.g. 'yourcompany.com'
const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';
const GOOGLE_REDIRECT_URI = `${APP_URL}/api/oauth/google/callback`;

function isGoogleOAuthConfigured() {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
}

function getGoogleClient() {
  return new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

// In-memory store for OAuth state tokens (short-lived, 10 minutes)
const oauthStates = new Map();

function createOAuthState() {
  const state = crypto.randomBytes(32).toString('hex');
  oauthStates.set(state, Date.now() + 10 * 60 * 1000);
  return state;
}

function validateOAuthState(state) {
  const expiry = oauthStates.get(state);
  oauthStates.delete(state);
  if (!expiry) return false;
  return Date.now() < expiry;
}

// Periodically clean up expired states
setInterval(() => {
  const now = Date.now();
  for (const [state, expiry] of oauthStates) {
    if (now >= expiry) oauthStates.delete(state);
  }
}, 5 * 60 * 1000);

/**
 * Derive a username from the Google profile email.
 * Takes the local part, strips invalid characters, and ensures uniqueness.
 */
async function deriveUniqueUsername(email) {
  // Take local part of email, keep only valid chars, truncate to 32
  let base = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 28);
  if (base.length < 3) base = base.padEnd(3, '_');

  // Check if it's available
  const [existing] = await c2_query(
    `SELECT id FROM users WHERE LOWER(name) = LOWER(?) LIMIT 1`,
    [base]
  );
  if (!existing) return base;

  // Append random suffix
  for (let i = 0; i < 20; i++) {
    const candidate = `${base}_${crypto.randomBytes(2).toString('hex')}`.slice(0, 32);
    const [dup] = await c2_query(
      `SELECT id FROM users WHERE LOWER(name) = LOWER(?) LIMIT 1`,
      [candidate]
    );
    if (!dup) return candidate;
  }

  // Fallback: fully random
  return `user_${crypto.randomBytes(4).toString('hex')}`;
}

// --- Routes ---

/**
 * GET /api/oauth/providers
 * Returns which OAuth providers are configured (public — used by the login UI).
 */
router.get('/oauth/providers', (_req, res) => {
  res.json({
    success: true,
    providers: {
      google: isGoogleOAuthConfigured(),
    },
  });
});

/**
 * GET /api/oauth/google
 * Redirects the user to Google's OAuth consent screen.
 */
router.get('/oauth/google', (req, res) => {
  if (!isGoogleOAuthConfigured()) {
    return res.status(404).json({ success: false, message: 'Google OAuth is not configured' });
  }

  const client = getGoogleClient();
  const state = createOAuthState();

  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    scope: ['openid', 'email', 'profile'],
    state,
    prompt: 'select_account',
    ...(GOOGLE_OAUTH_DOMAIN ? { hd: GOOGLE_OAUTH_DOMAIN } : {}),
  });

  res.redirect(authUrl);
});

/**
 * GET /api/oauth/google/callback
 * Handles the redirect back from Google after consent.
 * Links or creates an account, then redirects to the app with a session.
 */
router.get('/oauth/google/callback', asyncHandler(async (req, res) => {
  const { code, state, error: oauthError } = req.query;

  if (oauthError) {
    return res.redirect(`/?oauth_error=${encodeURIComponent(oauthError)}`);
  }

  if (!code || !state) {
    return res.redirect('/?oauth_error=missing_params');
  }

  if (!validateOAuthState(state)) {
    return res.redirect('/?oauth_error=invalid_state');
  }

  // Exchange authorization code for tokens
  const client = getGoogleClient();
  let tokens;
  try {
    const { tokens: t } = await client.getToken(code);
    tokens = t;
  } catch {
    return res.redirect('/?oauth_error=token_exchange_failed');
  }

  // Verify the ID token to get user info
  let payload;
  try {
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    return res.redirect('/?oauth_error=token_verification_failed');
  }

  const { sub: googleUserId, email, email_verified, hd: hostedDomain } = payload;

  if (!email_verified) {
    return res.redirect('/?oauth_error=email_not_verified');
  }

  // If a domain restriction is set, enforce it
  if (GOOGLE_OAUTH_DOMAIN && hostedDomain !== GOOGLE_OAUTH_DOMAIN) {
    return res.redirect(`/?oauth_error=domain_not_allowed`);
  }

  // Check if this Google account is already linked
  const [existingOAuth] = await c2_query(
    `SELECT user_id FROM oauth_accounts WHERE provider = 'google' AND provider_user_id = ? LIMIT 1`,
    [googleUserId]
  );

  let userId;

  if (existingOAuth) {
    // Already linked — log them in
    userId = existingOAuth.user_id;
  } else {
    // Check if a user with this email already exists
    const [existingUser] = await c2_query(
      `SELECT id FROM users WHERE email = ? LIMIT 1`,
      [email]
    );

    if (existingUser) {
      // Link Google account to existing user
      userId = existingUser.id;
      await c2_query(
        `INSERT INTO oauth_accounts (user_id, provider, provider_user_id, provider_email) VALUES (?, 'google', ?, ?)`,
        [userId, googleUserId, email]
      );
    } else {
      // No existing account — auto-create if domain is allowed, otherwise reject
      if (!GOOGLE_OAUTH_DOMAIN) {
        // Without domain restriction, require an existing account to link to
        return res.redirect('/?oauth_error=no_account');
      }

      // Auto-create account for users in the allowed domain
      const username = await deriveUniqueUsername(email);

      const result = await c2_query(
        `INSERT INTO users (name, password_hash, email, avatar_url, created_at)
         VALUES (?, NULL, ?, ?, NOW())`,
        [username, email, payload.picture || null]
      );

      userId = result.insertId;

      // Create default permissions
      await c2_query(
        `INSERT INTO permissions (user_id, create_squad, create_archive, create_log) VALUES (?, TRUE, TRUE, TRUE)`,
        [userId]
      );

      // Link the OAuth account
      await c2_query(
        `INSERT INTO oauth_accounts (user_id, provider, provider_user_id, provider_email) VALUES (?, 'google', ?, ?)`,
        [userId, googleUserId, email]
      );
    }
  }

  // Fetch the user for session creation
  const [user] = await c2_query(
    `SELECT id, name, avatar_url, is_admin FROM users WHERE id = ? LIMIT 1`,
    [userId]
  );

  if (!user) {
    return res.redirect('/?oauth_error=user_not_found');
  }

  user.is_admin = Boolean(user.is_admin);
  const sessionToken = await generateSessionToken(user, req.ip, req.headers['user-agent']);

  // Set session cookie and redirect to the app
  res.cookie('sessionToken', sessionToken, {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: false, // Needs to be readable by JS (matching existing cookie behavior)
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
  });

  res.redirect('/');
}));

/**
 * GET /api/oauth/status
 * Returns the authenticated user's linked OAuth providers.
 */
router.get('/oauth/status', requireAuth, asyncHandler(async (req, res) => {
  const accounts = await c2_query(
    `SELECT provider, provider_email, created_at FROM oauth_accounts WHERE user_id = ?`,
    [req.user.id]
  );

  // Check if user has a password set (for account management UI)
  const [userRow] = await c2_query(
    `SELECT password_hash FROM users WHERE id = ? LIMIT 1`,
    [req.user.id]
  );

  res.json({
    success: true,
    accounts,
    hasPassword: Boolean(userRow?.password_hash),
  });
}));

/**
 * POST /api/oauth/google/unlink
 * Unlinks the user's Google account. Requires that the user has a password
 * set (so they don't get locked out).
 */
router.post('/oauth/google/unlink', requireAuth, asyncHandler(async (req, res) => {
  // Ensure the user has a password before unlinking
  const [userRow] = await c2_query(
    `SELECT password_hash FROM users WHERE id = ? LIMIT 1`,
    [req.user.id]
  );

  if (!userRow?.password_hash) {
    return res.status(400).json({
      success: false,
      message: 'You must set a password before unlinking your Google account'
    });
  }

  await c2_query(
    `DELETE FROM oauth_accounts WHERE user_id = ? AND provider = 'google'`,
    [req.user.id]
  );

  res.json({ success: true, message: 'Google account has been unlinked.' });
}));

router.use(errorHandler);

export default router;
