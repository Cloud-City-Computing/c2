/**
 * Authentication middleware for Cloud Codex
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { validateAndAutoLogin, touchSession } from '../mysql_connect.js';
import { readSessionCookie, legacyCookieAllowed } from '../services/session-cookie.js';
import { localSignInEnabled, providerListed } from '../services/auth-providers.js';
import { DEAD_SESSION_MESSAGE } from '../services/session-messages.js';

/**
 * The bearer token in the Authorization header, or null. A bare "Bearer " is
 * no token, so extractSessionToken falls through to the cookie for it.
 *
 * Exported for the Origin rule on cookie writes (app.js): a request is
 * authenticated by its header exactly when this returns a token, and only a
 * request authenticated by the cookie alone can be forged cross-site.
 */
export function bearerToken(req) {
  const header = req.headers['authorization'];
  if (!header) return null;
  return header.replace('Bearer ', '') || null;
}

/**
 * The session token this request carries, from the Authorization header
 * (API calls) or the session cookie (browser redirects). Returns null
 * when the request carries neither.
 *
 * The cookie is __Host-sessionToken, which wins over a legacy sessionToken
 * wherever the two sit in the header; a lone legacy cookie counts only while
 * LEGACY_SESSION_COOKIE allows it (services/session-cookie.js).
 *
 * Exported so there is exactly one definition of "which token is this request
 * carrying": POST /api/logout used to read req.body.token, which no client
 * ever sends, so every logout 400d and no session row was ever deleted.
 */
export function extractSessionToken(req) {
  return bearerToken(req)
    ?? readSessionCookie(req.headers['cookie'], { allowLegacy: legacyCookieAllowed() });
}

/**
 * Express middleware that validates the session token from either
 * the Authorization header (Bearer) or the session cookie, attaches
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
        return res.status(401).json({ success: false, message: DEAD_SESSION_MESSAGE });
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

/**
 * Mounted on every route that is a local human sign-in (password login, sign-up, reset, 2FA, the
 * username check, the local email-change confirmation). With local sign-in off (hosted mode, see
 * services/auth-providers.js) the route answers 404 before it reads anything, the way an unmounted
 * route would, so no local credential is ever checked on a hosted instance.
 */
export function requireLocalSignIn(req, res, next) {
  if (localSignInEnabled()) return next();
  return res.status(404).json({ success: false, message: 'Local sign-in is not offered on this instance' });
}

/**
 * Mounted on a sign-in route of one external provider. When AUTH_PROVIDERS is set and does not list the
 * provider the route answers 404, so a configured but unlisted provider has no door. Unset, the route's
 * own configuration check decides, as before.
 * @param {'google'|'oidc'} name
 * @returns {import('express').RequestHandler}
 */
export function requireProviderOffered(name) {
  return function providerOffered(req, res, next) {
    if (providerListed(name)) return next();
    return res.status(404).json({ success: false, message: `${name} sign-in is not offered on this instance` });
  };
}
