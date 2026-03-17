/**
 * Permissions middleware for Cloud Codex
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { c2_query } from '../mysql_connect.js';

/**
 * Middleware that loads user permissions from the permissions table
 * and attaches them to req.permissions. Requires requireAuth to run first.
 */
export async function loadPermissions(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  try {
    const [perms] = await c2_query(
      `SELECT create_team, create_project, create_page FROM permissions WHERE user_id = ? LIMIT 1`,
      [req.user.id]
    );

    req.permissions = perms || { create_team: false, create_project: false, create_page: true };
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Returns middleware that checks whether the user has a specific permission.
 * Must be used after requireAuth and loadPermissions (or it will auto-load).
 * @param {'create_team'|'create_project'|'create_page'} permission
 */
export function requirePermission(permission) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    // Auto-load permissions if not yet loaded
    if (!req.permissions) {
      try {
        const [perms] = await c2_query(
          `SELECT create_team, create_project, create_page FROM permissions WHERE user_id = ? LIMIT 1`,
          [req.user.id]
        );
        req.permissions = perms || { create_team: false, create_project: false, create_page: true };
      } catch (err) {
        return next(err);
      }
    }

    if (!req.permissions[permission]) {
      return res.status(403).json({
        success: false,
        message: `You do not have the '${permission}' permission`
      });
    }

    next();
  };
}
