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
  const token =
    req.headers['authorization']?.replace('Bearer ', '') ||
    null;

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
      touchSession(token).catch(() => {});
      next();
    })
    .catch(next);
}
