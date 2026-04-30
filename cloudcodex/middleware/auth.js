/**
 * Authentication middleware for Cloud Codex
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { validateAndAutoLogin, touchSession } from '../mysql_connect.js';

/**
 * Express middleware that validates the session token from either
 * the Authorization header (Bearer) or the request body, attaches
 * req.user, and refreshes session activity tracking.
 */
export function requireAuth(req, res, next) {
  // Read token from Authorization header (API calls) or sessionToken cookie (browser redirects)
  let token = req.headers['authorization']?.replace('Bearer ', '') || null;

  if (!token) {
    const cookieHeader = req.headers['cookie'];
    if (cookieHeader) {
      const match = cookieHeader.split('; ').find(c => c.startsWith('sessionToken='));
      if (match) token = match.split('=')[1];
    }
  }

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
