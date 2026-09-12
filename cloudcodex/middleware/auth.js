/**
 * Authentication middleware for Cloud Codex
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { validateAndAutoLogin, touchSession } from '../mysql_connect.js';
import { verifyMachineCredential } from '../services/machine-auth.js';

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
 * Express middleware for routes a machine caller may reach.
 *
 * Tries the machine credential first, and otherwise falls through to
 * requireAuth completely unchanged, so a human session is unaffected. The
 * order matters both ways: a valid service token never reaches
 * validateAndAutoLogin, and an ordinary session token only ever meets the
 * constant-time digest comparison in verifyMachineCredential, which cannot
 * match it and cannot leak its length.
 *
 * Apply it deliberately, one route at a time. It is NOT a drop-in replacement
 * for requireAuth: the whole value of the credential is that its reach is
 * enumerable by reading the routers.
 */
export function machineOrAuth(req, res, next) {
  const token = extractSessionToken(req);
  if (!token) return requireAuth(req, res, next);

  verifyMachineCredential(token)
    .then(principal => {
      if (!principal) return requireAuth(req, res, next);
      // No req.sessionToken: a machine caller holds no session row, so there
      // is nothing to refresh and nothing for logout to revoke.
      req.user = principal;
      next();
    })
    .catch(next);
}

/**
 * Express middleware for routes ONLY a machine caller may reach (C2-5).
 *
 * The sibling of machineOrAuth, and the difference is the whole point: this one
 * does NOT fall through to a session. A human with a valid login is refused
 * exactly as an anonymous caller is.
 *
 * WHY THAT ASYMMETRY EXISTS. machineOrAuth guards routes that answer "what may
 * YOU read?" — the caller asks about themselves, so a session is the natural
 * other half. This guards a route that answers "what may SOMEBODY ELSE read?",
 * which is an oracle about third parties. Behind a session, any logged-in user
 * could enumerate which colleagues belong to which workspaces, and — because an
 * unknown address answers the same as an unauthorised one — probe which email
 * addresses have accounts on this install at all.
 *
 * Behind the machine credential the exposure is bounded to a compromised
 * Cloud Command server, which is a system we operate. Behind a session it would
 * be every user who can log in.
 *
 * 401 rather than 403, and the same body an unauthenticated caller gets: a
 * distinct "you are logged in but not a machine" would itself tell a prober
 * that the route exists and what it wants.
 */
export function requireMachine(req, res, next) {
  const token = extractSessionToken(req);
  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  verifyMachineCredential(token)
    .then(principal => {
      if (!principal) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }
      // No req.sessionToken, for machineOrAuth's reason: a machine caller holds
      // no session row, so there is nothing to refresh and nothing to revoke.
      req.user = principal;
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
