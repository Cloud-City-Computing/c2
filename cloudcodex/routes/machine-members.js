/**
 * Membership sync from a paired product: admit, re-role and remove by address (W6-CDX-9)
 *
 * Cloud Command calls these when a member is added, re-roled or removed in a workspace it is paired
 * with (its W6-CMD-7). The workspace owner arrives as `admin`, everyone else as `member`. Machine-only
 * (requireMachine): a logged-in session never reaches them, whatever its role.
 *
 * WHAT IS KEYED ON WHAT. When the sync sends an issuer and a subject, that pair is the ONLY match: the
 * account its identity row links to (user_identities, binary). The address is used only when no identity
 * exists yet (a person who has never signed in), and then never selects an account that already holds a
 * different identity at that issuer (identity_conflict). Without a subject the address alone decides: it
 * resolves through users.email and through the address an identity last signed in with
 * (user_identities.email_at_last_signin). Two accounts matching one address is refused, never guessed at.
 * Sign-in itself keys on (issuer, subject) and refuses a deactivated row (services/identity.js).
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
import { c2_query, withTransaction } from '../mysql_connect.js';
import { requireMachine } from '../middleware/auth.js';
import { addSquadMember, asyncHandler, errorHandler, isValidEmail } from './helpers/shared.js';
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
  identity_conflict: 'This address belongs to an account linked to a different identity at this issuer; it is not moved',
};

/**
 * The sync needs the boot admin row to exist: it is the row the sync must never touch, and a boot that could not
 * create it (see ensureAdminUser) has nothing to protect. Refused with 503 until one exists, so a sync cannot run
 * against an instance whose admin is unresolved.
 */
const BOOT_ROW_SQL = 'SELECT id FROM users WHERE LOWER(email) COLLATE utf8mb4_bin = LOWER(?) COLLATE utf8mb4_bin AND is_admin = TRUE LIMIT 1';

async function requireBootAdmin(req, res, next) {
  try {
    const rows = await c2_query(BOOT_ROW_SQL, [process.env.ADMIN_EMAIL]);
    if (rows.length === 0) {
      return res.status(503).json({
        success: false,
        reason: 'no_boot_admin',
        message: 'This instance has no boot admin row; see the boot log, and the membership sync waits for one',
      });
    }
    next();
  } catch (err) {
    next(err);
  }
}

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

/** The accounts an address resolves to, locked for the write that follows. Binary, as the sign-in ladder compares. */
const HOLDERS_SQL = `
  SELECT id, email, is_admin, deactivated_at FROM users
   WHERE LOWER(email) COLLATE utf8mb4_bin = LOWER(?) COLLATE utf8mb4_bin
  UNION
  SELECT u.id, u.email, u.is_admin, u.deactivated_at FROM users u
    JOIN user_identities ui ON ui.user_id = u.id
   WHERE LOWER(ui.email_at_last_signin) COLLATE utf8mb4_bin = LOWER(?) COLLATE utf8mb4_bin
  FOR UPDATE`;

/** The account a verified (issuer, subject) is linked to, locked. The subject is the identity; nothing else is. */
const IDENTITY_SQL = `
  SELECT u.id, u.email, u.is_admin, u.deactivated_at FROM user_identities ui
    JOIN users u ON u.id = ui.user_id
   WHERE ui.issuer = ? AND ui.subject = ?
   LIMIT 1 FOR UPDATE`;

/**
 * Whether an account holds any identity at all. Reached only when the subject's own identity is absent, so any
 * identity an address-matched account holds (at this issuer under another subject, or at another issuer) is a
 * different identity, and the address is not allowed to move the sync onto it.
 */
const ANY_LINK_SQL = 'SELECT issuer, subject FROM user_identities WHERE user_id = ? LIMIT 1';

/**
 * The account(s) a request names. A subject, when sent, is the ONLY match: the identity it names, or, when
 * no identity exists yet, the address (a person who has not signed in). The address never selects an
 * account that already holds a different identity at that issuer (identity_conflict). Without a subject,
 * the address alone decides, as the wire has always done.
 */
async function holdersOf(query, { email, identity }) {
  if (identity) {
    const [hit] = await query(IDENTITY_SQL, [identity.issuer, identity.subject]);
    if (hit) return { holders: [hit] };
    if (!email) return { holders: [] };
    const byAddress = await query(HOLDERS_SQL, [email, email]);
    for (const holder of byAddress) {
      const [linked] = await query(ANY_LINK_SQL, [holder.id]);
      if (linked) return { refused: 'identity_conflict' };
    }
    return { holders: byAddress };
  }
  return { holders: await query(HOLDERS_SQL, [email, email]) };
}

/**
 * The subject a request names, read from the body or the query. Both or neither: an issuer without its
 * subject (or the reverse) is a 400, never a guess.
 */
function readIdentity(source) {
  const issuer = typeof source.issuer === 'string' ? source.issuer.trim() : '';
  const subject = typeof source.subject === 'string' ? source.subject.trim() : '';
  if (!issuer && !subject) return { identity: null };
  if (!issuer || !subject || issuer.length > 255 || subject.length > 255) {
    return { error: 'An issuer and a subject go together, each at most 255 characters' };
  }
  return { identity: { issuer, subject } };
}

/**
 * The instance's General squad, in the boot admin's starter workspace (bootstrapInstance). null when an admin
 * has renamed or deleted it; then nothing is placed and the instance admin places the person (D-S).
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

/**
 * Place an existing account in General with read and write, unless it is already a member there (D-S, for
 * accounts that were not admitted through an invitation). Idempotent: an existing membership is left as it is.
 */
async function ensureGeneralMember(query, userId) {
  const squadId = await generalSquadId(query);
  if (squadId === null) return;
  const [member] = await query('SELECT id FROM squad_members WHERE squad_id = ? AND user_id = ? LIMIT 1', [squadId, userId]);
  if (member) return;
  await addSquadMember(squadId, userId, { role: 'member', can_read: true, can_write: true }, query);
}

/** The 409 for a refusal decided inside the transaction, with nothing written. */
function refuse(res, reason) {
  return res.status(409).json({ success: false, reason, message: MESSAGES[reason] });
}

router.put('/machine/members', requireMachine, requireBootAdmin, asyncHandler(async (req, res) => {
  const email = readEmail(req.body?.email);
  const role = req.body?.role;
  if (!email || !ROLES.has(role)) {
    return res.status(400).json({ success: false, message: 'An email and a role of admin or member are required' });
  }
  const { identity, error } = readIdentity(req.body ?? {});
  if (error) return res.status(400).json({ success: false, message: error });
  if (isBootAddress(email)) return refuse(res, 'managed_by_configuration');

  const reactivate = req.body?.reactivate === true;
  const admin = role === 'admin';
  const outcome = await withTransaction(async (query) => {
    const found = await holdersOf(query, { email, identity });
    if (found.refused) return found;
    const { holders } = found;
    if (holders.some(isBootRow)) return { refused: 'managed_by_configuration' };
    if (holders.length > 1) return { refused: 'ambiguous_address' };

    const [holder] = holders;
    if (holder) {
      if (holder.id === req.user.id) return { refused: 'machine_account' };
      if (holder.deactivated_at && !reactivate) return { refused: 'account_deactivated' };
      if (reactivate) {
        await query('UPDATE users SET is_admin = ?, deactivated_at = NULL WHERE id = ?', [admin, holder.id]);
      } else {
        await query('UPDATE users SET is_admin = ? WHERE id = ?', [admin, holder.id]);
      }
      // An existing account is placed in General too, when it is not there already (D-S).
      await ensureGeneralMember(query, holder.id);
      return {};
    }

    const open = await query(
      `SELECT id, squad_id, revoked_at FROM user_invitations
        WHERE LOWER(email) COLLATE utf8mb4_bin = LOWER(?) COLLATE utf8mb4_bin AND accepted = FALSE
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [email]
    );
    // A removed invitation is not re-opened by a stale admission; only an explicit reactivate does it.
    if (open.length > 0 && open[0].revoked_at && !reactivate) return { refused: 'account_deactivated' };
    // An invitation that already names a squad (an admin's, made by hand) keeps it.
    const keepsSquad = open.length > 0 && open[0].squad_id !== null;
    const squadId = keepsSquad ? null : await generalSquadId(query);
    if (open.length > 0) {
      await query(
        `UPDATE user_invitations
            SET grants_admin = ?, expires_at = NOW() + INTERVAL 1 YEAR, invited_by = ?,
                squad_id = COALESCE(squad_id, ?), can_write = can_write OR ?, revoked_at = NULL
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

/**
 * DELETE /machine/members (the subject form: issuer and subject in the query, the address optional) and
 * DELETE /machine/members/:email (the address form, with issuer and subject in the query when the sync has them).
 */
async function removeMember(req, res, email) {
  const { identity, error } = readIdentity(req.query ?? {});
  if (error) return res.status(400).json({ success: false, message: error });
  if (!email && !identity) {
    return res.status(400).json({ success: false, message: 'A subject (issuer and subject) or an email is required' });
  }
  if (email && isBootAddress(email)) return refuse(res, 'managed_by_configuration');

  const outcome = await withTransaction(async (query) => {
    const found = await holdersOf(query, { email, identity });
    if (found.refused) return found;
    const { holders } = found;
    if (holders.some(isBootRow)) return { refused: 'managed_by_configuration' };
    if (holders.length > 1) return { refused: 'ambiguous_address' };

    const [holder] = holders;
    if (holder && holder.id === req.user.id) return { refused: 'machine_account' };

    if (email) {
      await query(
        'UPDATE user_invitations SET expires_at = NOW(), revoked_at = COALESCE(revoked_at, NOW()) WHERE LOWER(email) COLLATE utf8mb4_bin = LOWER(?) COLLATE utf8mb4_bin AND accepted = FALSE',
        [email]
      );
    }
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
}

router.delete('/machine/members', requireMachine, requireBootAdmin, asyncHandler(async (req, res) => {
  const email = typeof req.query?.email === 'string' ? readEmail(req.query.email) : null;
  await removeMember(req, res, email);
}));

router.delete('/machine/members/:email', requireMachine, requireBootAdmin, asyncHandler(async (req, res) => {
  const email = readEmail(req.params.email);
  if (!email) return res.status(400).json({ success: false, message: 'A valid email is required' });
  await removeMember(req, res, email);
}));

router.use(errorHandler);

export default router;
