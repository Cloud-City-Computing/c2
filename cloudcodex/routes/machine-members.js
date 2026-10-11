/**
 * Membership sync from a paired product: admit, re-role and remove by address (W6-CDX-9)
 *
 * Cloud Command calls these when a member is added, re-roled or removed in a workspace it is paired
 * with (its W6-CMD-7). The workspace owner arrives as `admin`, everyone else as `member`. Machine-only
 * (requireMachine): a logged-in session never reaches them, whatever its role.
 *
 * WHAT IS KEYED ON WHAT. The wire carries an address, so an address is how a member is found. It is
 * never the identity: the effects land on the user row the address resolves to, and sign-in keys on
 * (issuer, subject) through user_identities and refuses a deactivated row (services/identity.js). An
 * address resolves to a user through two columns: users.email, and the address an identity last signed
 * in with (user_identities.email_at_last_signin, which follows the issuer). Cloud Command follows the
 * issuer's address and this instance does not, so the second is what keeps a removal from missing a
 * member whose address has moved. Two accounts matching one address is refused, never guessed at.
 *
 * THE BOOT ADMIN IS NEVER THE SYNC'S. ADMIN_EMAIL is the instance admin, owned by ensureAdminUser at
 * boot. A row that is the boot admin, by its address or by an identity's, answers 409 and is not written,
 * and so does the machine principal's own account. The sync can set is_admin only on a user it resolves
 * to, and only through this file; it never promotes through ensureAdminUser's name or address match.
 *
 * IDEMPOTENT. Every write is a set to a stated value, so Cloud Command's retries are safe. A removal of
 * someone already removed answers the same success, and a re-admission of a deactivated user is explicit
 * (`reactivate: true`): a stale retry of an admission sent before a removal cannot quietly undo it.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import crypto from 'node:crypto';
import express from 'express';
import { withTransaction } from '../mysql_connect.js';
import { requireMachine } from '../middleware/auth.js';
import { asyncHandler, errorHandler, isValidEmail } from './helpers/shared.js';
import { closeSocketsForSessions as closeCollab } from '../services/collab.js';
import { closeSocketsForSessions as closeInbox } from '../services/user-channel.js';

const router = express.Router();
const ROLES = new Set(['admin', 'member']);
const OK = { success: true };

const MESSAGES = {
  managed_by_configuration: 'This account is managed by the server configuration',
  machine_account: 'The machine account cannot be changed by the membership sync',
  ambiguous_address: 'This address matches more than one account; it needs a person to resolve it',
  account_deactivated: 'This account was removed; send reactivate to admit it again',
};

function readEmail(raw) {
  const email = typeof raw === 'string' ? raw.trim() : '';
  return email && email.length <= 255 && isValidEmail(email) ? email : null;
}

/** The address is the boot admin's, as written in the environment (case-insensitively). */
const isBootAddress = (email) =>
  Boolean(process.env.ADMIN_EMAIL) && email.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase();

/** A row is the boot admin's when its stored address is ADMIN_EMAIL, whatever address the sync asked by. */
const isBootRow = (row) =>
  Boolean(process.env.ADMIN_EMAIL) && String(row.email).toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase();

/**
 * The accounts an address resolves to: the user holding it, and any user whose identity last signed in
 * with it. Binary comparison, as the sign-in ladder compares (services/identity.js), so an accented
 * address never resolves to its unaccented twin. The rows are locked for the write that follows.
 */
const HOLDERS_SQL = `
  SELECT id, email, is_admin, deactivated_at FROM users
   WHERE LOWER(email) COLLATE utf8mb4_bin = LOWER(?) COLLATE utf8mb4_bin
  UNION
  SELECT u.id, u.email, u.is_admin, u.deactivated_at FROM users u
    JOIN user_identities ui ON ui.user_id = u.id
   WHERE LOWER(ui.email_at_last_signin) COLLATE utf8mb4_bin = LOWER(?) COLLATE utf8mb4_bin
  FOR UPDATE`;

/**
 * Where an admitted member lands: the General squad bootstrapInstance seeded in the boot admin's starter
 * workspace. null when an admin has renamed or deleted it; the invitation then names no squad and the
 * instance admin places them (D-S).
 */
async function generalSquadId(query) {
  const rows = await query(
    `SELECT s.id FROM squads s
       JOIN workspaces w ON w.id = s.workspace_id
       JOIN users u ON u.id = w.owner_id
      WHERE s.name = 'General' AND LOWER(u.email) COLLATE utf8mb4_bin = LOWER(?) COLLATE utf8mb4_bin
      ORDER BY s.id LIMIT 1`,
    [process.env.ADMIN_EMAIL]
  );
  return rows.length > 0 ? rows[0].id : null;
}

/** The 409 for a refusal decided inside the transaction, with nothing written. */
function refuse(res, reason) {
  return res.status(409).json({ success: false, reason, message: MESSAGES[reason] });
}

router.put('/machine/members', requireMachine, asyncHandler(async (req, res) => {
  const email = readEmail(req.body?.email);
  const role = req.body?.role;
  if (!email || !ROLES.has(role)) {
    return res.status(400).json({ success: false, message: 'An email and a role of admin or member are required' });
  }
  if (isBootAddress(email)) return refuse(res, 'managed_by_configuration');

  const reactivate = req.body?.reactivate === true;
  const admin = role === 'admin';
  const outcome = await withTransaction(async (query) => {
    const holders = await query(HOLDERS_SQL, [email, email]);
    if (holders.some(isBootRow)) return { refused: 'managed_by_configuration' };
    if (holders.length > 1) return { refused: 'ambiguous_address' };

    const [holder] = holders;
    if (holder) {
      if (holder.id === req.user.id) return { refused: 'machine_account' };
      if (holder.deactivated_at && !reactivate) return { refused: 'account_deactivated' };
      // Squads are left alone: after admission, placement is the instance admin's.
      if (reactivate) {
        await query('UPDATE users SET is_admin = ?, deactivated_at = NULL WHERE id = ?', [admin, holder.id]);
      } else {
        await query('UPDATE users SET is_admin = ? WHERE id = ?', [admin, holder.id]);
      }
      return {};
    }

    const open = await query(
      `SELECT id, squad_id FROM user_invitations
        WHERE LOWER(email) COLLATE utf8mb4_bin = LOWER(?) COLLATE utf8mb4_bin AND accepted = FALSE
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [email]
    );
    // An invitation that already names a squad (an admin's, made by hand) keeps it.
    const keepsSquad = open.length > 0 && open[0].squad_id !== null;
    const squadId = keepsSquad ? null : await generalSquadId(query);
    if (open.length > 0) {
      await query(
        `UPDATE user_invitations
            SET grants_admin = ?, expires_at = NOW() + INTERVAL 1 YEAR, invited_by = ?,
                squad_id = COALESCE(squad_id, ?), can_write = can_write OR ?
          WHERE id = ?`,
        [admin, req.user.id, squadId, squadId !== null, open[0].id]
      );
    } else {
      // can_read defaults to TRUE and role to 'member' (init.sql user_invitations).
      await query(
        `INSERT INTO user_invitations
           (email, token, invited_by, expires_at, grants_admin, squad_id, can_write)
         VALUES (?, ?, ?, NOW() + INTERVAL 1 YEAR, ?, ?, ?)`,
        [email, crypto.randomBytes(32).toString('hex'), req.user.id, admin, squadId, squadId !== null]
      );
    }
    return {};
  });

  if (outcome.refused) return refuse(res, outcome.refused);
  res.json(OK);
}));

router.delete('/machine/members/:email', requireMachine, asyncHandler(async (req, res) => {
  const email = readEmail(req.params.email);
  if (!email) return res.status(400).json({ success: false, message: 'A valid email is required' });
  if (isBootAddress(email)) return refuse(res, 'managed_by_configuration');

  const outcome = await withTransaction(async (query) => {
    const holders = await query(HOLDERS_SQL, [email, email]);
    if (holders.some(isBootRow)) return { refused: 'managed_by_configuration' };
    if (holders.length > 1) return { refused: 'ambiguous_address' };

    const [holder] = holders;
    if (holder && holder.id === req.user.id) return { refused: 'machine_account' };

    await query(
      'UPDATE user_invitations SET expires_at = NOW() WHERE LOWER(email) COLLATE utf8mb4_bin = LOWER(?) COLLATE utf8mb4_bin AND accepted = FALSE',
      [email]
    );
    if (!holder) return { digests: [] };

    // COALESCE keeps the first removal's time, so a repeated removal changes nothing.
    await query('UPDATE users SET deactivated_at = COALESCE(deactivated_at, NOW()), is_admin = FALSE WHERE id = ?', [holder.id]);
    const rows = await query('SELECT id FROM sessions WHERE user_id = ?', [holder.id]);
    await query('DELETE FROM sessions WHERE user_id = ?', [holder.id]);
    return { digests: rows.map((row) => row.id) };
  });

  if (outcome.refused) return refuse(res, outcome.refused);
  // The removed member's open sockets, both kinds, close at once; the sign-in is refused by the row.
  closeCollab(outcome.digests);
  closeInbox(outcome.digests);
  res.json(OK);
}));

router.use(errorHandler);

export default router;
