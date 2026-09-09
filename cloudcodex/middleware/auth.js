/**
 * Authentication middleware for Cloud Codex
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { validateAndAutoLogin, touchSession } from '../mysql_connect.js';

/**
 * The session token this request carries, from the Authorization header
 * (API calls) or the sessionToken cookie (browser redirects). Returns null
 * when the request carries neither.
 *
 * Exported so there is exactly one definition of "which token is this request
 * carrying": POST /api/logout used to read req.body.token, which no client
 * ever sends, so every logout 400d and no session row was ever deleted.
 */
export function extractSessionToken(req) {
  const header = req.headers['authorization'];
  if (header) {
    const bearer = header.replace('Bearer ', '');
    if (bearer) return bearer;
  }

  const cookieHeader = req.headers['cookie'];
  if (cookieHeader) {
    const match = cookieHeader.split('; ').find(c => c.startsWith('sessionToken='));
    if (match) return match.split('=')[1];
  }

  return null;
}

/**
 * Express middleware that validates the session token from either
 * the Authorization header (Bearer) or the sessionToken cookie, attaches
 * req.user, and refreshes session activity tracking.
 */
export function requireAuth(req, res, next) {
  const token = extractSessionToken(req);

  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  validateAndAutoLogin(token)
    .then(user => {
      if (!user) {
        return res.status(401).json({ success: false, message: 'Invalid or expired session' });
      }
      req.user = user;
      req.sessionToken = token;
      touchSession(token).catch((err) => {
        // Fire-and-forget refresh of the session's last-touched timestamp;
        // a failure here doesn't invalidate the request, but a persistent
        // problem (DB latency, connection loss) is worth surfacing in logs.
        console.error(`[${new Date().toISOString()}] auth: touchSession failed:`, err);
      });
      next();
    })
    .catch(next);
}

/**
 * Express middleware that requires the authenticated user to be a super admin.
 * Must be used after requireAuth.
 */
export function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  next();
}
