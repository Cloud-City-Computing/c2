/**
 * Cloud Codex - First-run experience routes
 *
 * Answers one question: does this user still need the welcome, and what
 * should it point at. The welcome creates nothing itself, so this router is
 * read-only apart from stamping `users.onboarded_at` when the flow finishes.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import { c2_query } from '../mysql_connect.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, errorHandler } from './helpers/shared.js';
import { readAccessWhere, readAccessParams } from './helpers/ownership.js';

const router = express.Router();

/**
 * GET /api/first-run
 *
 * An onboarded user costs exactly one query and nothing else, forever, which
 * is why the short-circuit sits before every other lookup.
 */
router.get('/first-run', requireAuth, asyncHandler(async (req, res) => {
  const [row] = await c2_query(
    `SELECT onboarded_at FROM users WHERE id = ? LIMIT 1`,
    [req.user.id]
  );

  const isAdmin = Boolean(req.user.is_admin);

  if (row?.onboarded_at) {
    return res.json({ success: true, needsOnboarding: false, isAdmin });
  }

  // The squad the user actually belongs to, oldest first: for an invited
  // teammate that is the one their invitation joined them to, and for the
  // admin it is the squad bootstrapInstance seeded.
  const [squad] = await c2_query(
    `SELECT s.id, s.name
       FROM squad_members sm
       JOIN squads s ON s.id = sm.squad_id
      WHERE sm.user_id = ?
      ORDER BY sm.joined_at ASC, s.id ASC
      LIMIT 1`,
    [req.user.id]
  );

  // The archive is the ACL boundary, so this is resolved through the shared
  // fragment rather than by walking the squad. A user can legitimately reach
  // an archive in a squad they are not a member of. `system` archives (the
  // hidden GitHub PR-session archive created in routes/github.js) are
  // excluded outright: they are meant to be invisible to normal browsing,
  // and the admin bypass in readAccessWhere would otherwise surface one as
  // an admin's "Getting Started" target. The squad resolved above is
  // preferred by ORDER BY, not enforced by WHERE, so a workspace owner who
  // reaches an archive without being in its squad still gets a result
  // instead of a false "no archive yet".
  const [archive] = await c2_query(
    `SELECT p.id, p.name
       FROM archives p
      WHERE p.\`system\` = FALSE
        AND ${readAccessWhere('p')}
      ORDER BY (p.squad_id = ?) DESC, p.created_at ASC, p.id ASC
      LIMIT 1`,
    [...readAccessParams(req.user), squad?.id ?? null]
  );

  const [log] = archive
    ? await c2_query(
      `SELECT l.id, l.title
         FROM logs l
        WHERE l.archive_id = ?
        ORDER BY l.created_at ASC, l.id ASC
        LIMIT 1`,
      [archive.id]
    )
    : [];

  const [pending] = await c2_query(
    `SELECT COUNT(*) AS n FROM squad_invitations WHERE invited_user_id = ? AND status = 'pending'`,
    [req.user.id]
  );

  res.json({
    success: true,
    needsOnboarding: true,
    isAdmin,
    squad: squad ?? null,
    archive: archive ?? null,
    log: log ?? null,
    pendingSquadInvites: Number(pending?.n ?? 0),
  });
}));

/**
 * POST /api/first-run/complete
 *
 * Idempotent: the guard means a second call from another open tab stamps
 * nothing and still succeeds.
 */
router.post('/first-run/complete', requireAuth, asyncHandler(async (req, res) => {
  await c2_query(
    `UPDATE users SET onboarded_at = NOW() WHERE id = ? AND onboarded_at IS NULL`,
    [req.user.id]
  );
  res.json({ success: true });
}));

router.use(errorHandler);

export default router;
