/**
 * OAuth / SSO routes for Cloud Codex
 *
 * Supports Google Workspace SSO and GitHub OAuth.
 * Google: If GOOGLE_OAUTH_DOMAIN is set, users from that domain can sign in / auto-create accounts.
 * GitHub: Links GitHub accounts for repo browsing and markdown editing. Stores access tokens encrypted.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { c2_query, generateSessionToken } from '../mysql_connect.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, errorHandler, DEFAULT_PERMISSIONS, APP_URL, createDefaultPermissions } from './helpers/shared.js';

const router = express.Router();

// --- Google OAuth configuration ---

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_OAUTH_DOMAIN = process.env.GOOGLE_OAUTH_DOMAIN; // e.g. 'yourcompany.com'
const GOOGLE_REDIRECT_URI = `${APP_URL}/api/oauth/google/callback`;

function isGoogleOAuthConfigured() {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
}

function getGoogleClient() {
  return new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

// --- GitHub OAuth configuration ---

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const GITHUB_REDIRECT_URI = `${APP_URL}/api/oauth/github/callback`;

function isGitHubOAuthConfigured() {
  return Boolean(GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET);
}

// --- Token encryption (AES-256-GCM) for storing GitHub access tokens ---

const TOKEN_CIPHER = 'aes-256-gcm';
const TOKEN_KEY_LENGTH = 32;
const TOKEN_IV_LENGTH = 12;
const TOKEN_TAG_LENGTH = 16;

function getTokenEncryptionKey() {
  // Derive a 256-bit key from GITHUB_CLIENT_SECRET using scrypt
  if (!GITHUB_CLIENT_SECRET) return null;
  return crypto.scryptSync(GITHUB_CLIENT_SECRET, 'cloudcodex-oauth-token', TOKEN_KEY_LENGTH);
}

export function encryptToken(plaintext) {
  const key = getTokenEncryptionKey();
  if (!key) return null;
  const iv = crypto.randomBytes(TOKEN_IV_LENGTH);
  const cipher = crypto.createCipheriv(TOKEN_CIPHER, key, iv, { authTagLength: TOKEN_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Store as iv:tag:ciphertext in hex
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptToken(stored) {
  const key = getTokenEncryptionKey();
  if (!key || !stored) return null;
  const [ivHex, tagHex, encHex] = stored.split(':');
  if (!ivHex || !tagHex || !encHex) return null;
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const encrypted = Buffer.from(encHex, 'hex');
  const decipher = crypto.createDecipheriv(TOKEN_CIPHER, key, iv, { authTagLength: TOKEN_TAG_LENGTH });
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf8');
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
      github: isGitHubOAuthConfigured(),
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
      await createDefaultPermissions(userId);

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
 * Returns the authenticated user's linked OAuth providers along with the
 * provider username/avatar and current token status (for revocation UX).
 */
router.get('/oauth/status', requireAuth, asyncHandler(async (req, res) => {
  const accounts = await c2_query(
    `SELECT provider, provider_email, provider_username, provider_avatar_url,
            token_status, created_at
       FROM oauth_accounts WHERE user_id = ?`,
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

// ────────────────────────────────────────────────────────
//  GitHub OAuth
// ────────────────────────────────────────────────────────

/**
 * GET /api/oauth/github
 * Redirects the user to GitHub's OAuth authorization page.
 * Requires the user to be logged in (links GitHub to their existing account).
 */
router.get('/oauth/github', requireAuth, (req, res) => {
  if (!isGitHubOAuthConfigured()) {
    return res.status(404).json({ success: false, message: 'GitHub OAuth is not configured' });
  }

  const state = createOAuthState();
  // Stash user ID in the state so the callback knows who to link
  oauthStates.set(`gh_uid_${state}`, req.user.id);

  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: GITHUB_REDIRECT_URI,
    scope: 'repo user:email',
    state,
  });

  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

/**
 * GET /api/oauth/github/callback
 * Handles the redirect back from GitHub.
 * Links the GitHub account to the authenticated user and stores the encrypted access token.
 */
router.get('/oauth/github/callback', asyncHandler(async (req, res) => {
  const { code, state, error: oauthError } = req.query;

  if (oauthError) {
    return res.redirect('/account?github_error=access_denied');
  }

  if (!code || !state) {
    return res.redirect('/account?github_error=missing_params');
  }

  if (!validateOAuthState(state)) {
    return res.redirect('/account?github_error=invalid_state');
  }

  const userId = oauthStates.get(`gh_uid_${state}`);
  oauthStates.delete(`gh_uid_${state}`);
  if (!userId) {
    return res.redirect('/account?github_error=session_expired');
  }

  // Exchange code for access token
  let accessToken;
  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: GITHUB_REDIRECT_URI,
      }),
    });
    const tokenData = await tokenRes.json();
    accessToken = tokenData.access_token;
    if (!accessToken) {
      return res.redirect('/account?github_error=token_exchange_failed');
    }
  } catch {
    return res.redirect('/account?github_error=token_exchange_failed');
  }

  // Get GitHub user info
  let ghUser;
  try {
    const userRes = await fetch('https://api.github.com/user', {
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/vnd.github+json' },
    });
    ghUser = await userRes.json();
  } catch {
    return res.redirect('/account?github_error=user_fetch_failed');
  }

  // Get primary email
  let ghEmail = ghUser.email;
  if (!ghEmail) {
    try {
      const emailRes = await fetch('https://api.github.com/user/emails', {
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/vnd.github+json' },
      });
      const emails = await emailRes.json();
      const primary = emails.find(e => e.primary && e.verified);
      ghEmail = primary?.email || emails.find(e => e.verified)?.email || '';
    } catch {
      ghEmail = '';
    }
  }

  const githubUserId = String(ghUser.id);
  const ghLogin = typeof ghUser.login === 'string' ? ghUser.login : null;
  const ghAvatar = typeof ghUser.avatar_url === 'string' ? ghUser.avatar_url : null;
  const encToken = encryptToken(accessToken);

  // Check if already linked to this user
  const [existingLink] = await c2_query(
    `SELECT id FROM oauth_accounts WHERE provider = 'github' AND user_id = ? LIMIT 1`,
    [userId]
  );

  if (existingLink) {
    // Update the token and provider info; clear any prior 'revoked' state.
    await c2_query(
      `UPDATE oauth_accounts
         SET provider_user_id = ?, provider_email = ?, provider_username = ?,
             provider_avatar_url = ?, encrypted_token = ?, token_status = 'active'
       WHERE id = ?`,
      [githubUserId, ghEmail, ghLogin, ghAvatar, encToken, existingLink.id]
    );
  } else {
    // Check if this GitHub account is linked to another user
    const [otherLink] = await c2_query(
      `SELECT user_id FROM oauth_accounts WHERE provider = 'github' AND provider_user_id = ? LIMIT 1`,
      [githubUserId]
    );
    if (otherLink) {
      return res.redirect('/account?github_error=already_linked_other');
    }

    await c2_query(
      `INSERT INTO oauth_accounts (user_id, provider, provider_user_id, provider_email,
        provider_username, provider_avatar_url, encrypted_token, token_status)
       VALUES (?, 'github', ?, ?, ?, ?, ?, 'active')`,
      [userId, githubUserId, ghEmail, ghLogin, ghAvatar, encToken]
    );
  }

  res.redirect('/account?github_linked=1');
}));

/**
 * POST /api/oauth/github/unlink
 * Unlinks the user's GitHub account and revokes the OAuth grant on GitHub's side
 * so that re-linking prompts the user to re-select repository access.
 */
router.post('/oauth/github/unlink', requireAuth, asyncHandler(async (req, res) => {
  // If GitHub is the user's only auth method (no password, no other OAuth), block
  const [userRow] = await c2_query(
    `SELECT password_hash FROM users WHERE id = ? LIMIT 1`,
    [req.user.id]
  );
  const otherProviders = await c2_query(
    `SELECT id FROM oauth_accounts WHERE user_id = ? AND provider != 'github' LIMIT 1`,
    [req.user.id]
  );
  if (!userRow?.password_hash && otherProviders.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'You must set a password or have another login method before unlinking GitHub'
    });
  }

  // Revoke the OAuth grant on GitHub's side so re-linking shows the repo selection screen
  const [account] = await c2_query(
    `SELECT encrypted_token FROM oauth_accounts WHERE user_id = ? AND provider = 'github' LIMIT 1`,
    [req.user.id]
  );
  if (account?.encrypted_token) {
    const token = decryptToken(account.encrypted_token);
    if (token && GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET) {
      try {
        await fetch(`https://api.github.com/applications/${GITHUB_CLIENT_ID}/grant`, {
          method: 'DELETE',
          headers: {
            'Authorization': 'Basic ' + Buffer.from(`${GITHUB_CLIENT_ID}:${GITHUB_CLIENT_SECRET}`).toString('base64'),
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          body: JSON.stringify({ access_token: token }),
        });
      } catch {
        // Non-fatal: even if the GitHub revocation fails, still unlink locally
      }
    }
  }

  await c2_query(
    `DELETE FROM oauth_accounts WHERE user_id = ? AND provider = 'github'`,
    [req.user.id]
  );

  res.json({ success: true, message: 'GitHub account has been unlinked.' });
}));

/**
 * GET /api/github/status
 * Returns whether the authenticated user has GitHub connected, basic info,
 * and the current token status so the UI can render a reconnect prompt
 * when GitHub revoked the OAuth grant out-of-band.
 */
router.get('/github/status', requireAuth, asyncHandler(async (req, res) => {
  const [account] = await c2_query(
    `SELECT provider_email, provider_user_id, provider_username, provider_avatar_url, token_status
       FROM oauth_accounts WHERE user_id = ? AND provider = 'github' LIMIT 1`,
    [req.user.id]
  );

  res.json({
    success: true,
    connected: Boolean(account),
    // `username` historically returned the email; keep that for compatibility.
    username: account?.provider_email || null,
    githubId: account?.provider_user_id || null,
    login: account?.provider_username || null,
    avatar_url: account?.provider_avatar_url || null,
    token_status: account?.token_status || null,
    needs_reconnect: account?.token_status === 'revoked',
  });
}));

router.use(errorHandler);

export default router;
