/**
 * Permissions middleware for Cloud Codex
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { c2_query } from '../mysql_connect.js';

const isValidId = (id) => Number.isInteger(Number(id)) && Number(id) > 0;

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
 * Checks global permissions first, then falls back to team-level permissions
 * and org/team ownership when team context is available.
 *
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

    // Global permission grants access immediately
    if (req.permissions[permission]) {
      return next();
    }

    // Fallback: check team-level permissions when team context is available
    try {
      let teamId = req.body?.team_id && isValidId(req.body.team_id) ? Number(req.body.team_id) : null;

      // For page creation, derive team_id from the project
      if (!teamId && req.params?.projectId && isValidId(req.params.projectId)) {
        const [proj] = await c2_query(
          'SELECT team_id FROM projects WHERE id = ? LIMIT 1',
          [Number(req.params.projectId)]
        );
        teamId = proj?.team_id ?? null;
      }

      if (teamId) {
        // Org owner always has full access within their org
        const [orgOwner] = await c2_query(
          `SELECT 1 FROM teams t JOIN organizations o ON t.organization_id = o.id
           WHERE t.id = ? AND o.owner = ? LIMIT 1`,
          [teamId, req.user.email]
        );
        if (orgOwner) return next();

        // Check team member permission
        const columnMap = {
          create_project: 'can_create_project',
          create_page: 'can_create_page',
        };
        const column = columnMap[permission];
        if (column) {
          const [tm] = await c2_query(
            `SELECT \`${column}\` AS allowed FROM team_members WHERE team_id = ? AND user_id = ? LIMIT 1`,
            [teamId, req.user.id]
          );
          if (tm?.allowed) return next();
        }
      }
    } catch (err) {
      return next(err);
    }

    return res.status(403).json({
      success: false,
      message: `You do not have the '${permission}' permission`
    });
  };
}
