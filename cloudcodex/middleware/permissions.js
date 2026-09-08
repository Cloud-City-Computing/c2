/**
 * Permissions middleware for Cloud Codex
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { c2_query } from '../mysql_connect.js';
import { isValidId, DEFAULT_PERMISSIONS } from '../routes/helpers/shared.js';
import { isSquadWorkspaceMember } from '../routes/helpers/ownership.js';

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
      `SELECT create_squad, create_archive, create_log FROM permissions WHERE user_id = ? LIMIT 1`,
      [req.user.id]
    );

    req.permissions = perms || DEFAULT_PERMISSIONS;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Returns middleware that checks whether the user has a specific permission.
 * Checks global permissions first, then falls back to squad-level permissions
 * and workspace/squad ownership when squad context is available.
 *
 * @param {'create_squad'|'create_archive'|'create_log'} permission
 */
export function requirePermission(permission) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    // Admins bypass all permission checks
    if (req.user.is_admin) return next();

    // Auto-load permissions if not yet loaded
    if (!req.permissions) {
      try {
        const [perms] = await c2_query(
          `SELECT create_squad, create_archive, create_log FROM permissions WHERE user_id = ? LIMIT 1`,
          [req.user.id]
        );
        req.permissions = perms || DEFAULT_PERMISSIONS;
      } catch (err) {
        return next(err);
      }
    }

    // A body-supplied squad context is validated regardless of the global bit:
    // the global permission means "may create", never "may create anywhere".
    // createDefaultPermissions grants every account all three bits, so without
    // this any account could plant an archive inside any squad in any
    // workspace via POST /api/archives, where this middleware is the only gate.
    //
    // Deliberately NOT the archiveId-derived squad below. Both create_log
    // routes re-check with writeAccessWhere straight after this middleware, so
    // that path is already covered, and checking it here would refuse a caller
    // who holds an explicit write_access grant without workspace membership.
    const bodySquadId = req.body?.squad_id && isValidId(req.body.squad_id)
      ? Number(req.body.squad_id)
      : null;

    if (bodySquadId && !(await isSquadWorkspaceMember(req.user, bodySquadId))) {
      // The generic permission message, not one naming the squad: a
      // distinguishable refusal would turn this into a squad enumeration oracle.
      return res.status(403).json({
        success: false,
        message: `You do not have the '${permission}' permission`
      });
    }

    // Global permission grants access immediately
    if (req.permissions[permission]) {
      return next();
    }

    // Fallback: check squad-level permissions when squad context is available
    try {
      let squadId = bodySquadId;

      // For log creation, derive squad_id from the archive
      if (!squadId && req.params?.archiveId && isValidId(req.params.archiveId)) {
        const [proj] = await c2_query(
          'SELECT squad_id FROM archives WHERE id = ? LIMIT 1',
          [Number(req.params.archiveId)]
        );
        squadId = proj?.squad_id ?? null;
      }

      if (squadId) {
        // Workspace owner always has full access within their workspace
        const [orgOwner] = await c2_query(
          `SELECT 1 FROM squads t JOIN workspaces o ON t.workspace_id = o.id
           WHERE t.id = ? AND o.owner_id = ? LIMIT 1`,
          [squadId, req.user.id]
        );
        if (orgOwner) return next();

        // Check squad member permission
        const columnMap = {
          create_archive: 'can_create_archive',
          create_log: 'can_create_log',
        };
        const column = columnMap[permission];
        if (column) {
          const [tm] = await c2_query(
            `SELECT \`${column}\` AS allowed FROM squad_members WHERE squad_id = ? AND user_id = ? LIMIT 1`,
            [squadId, req.user.id]
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
