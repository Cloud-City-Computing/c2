/**
 * Identity resolution for Cloud Codex: which local user a verified external identity is
 *
 * The one seam every external sign-in goes through. A provider route does the
 * protocol work (state, code exchange, token verification) and hands this
 * module the verified claims plus a policy; resolveIdentity() answers with a
 * local user id or a named refusal, and the route turns that into a session or
 * a redirect. Keeping the ladder here means a second provider reuses it rather
 * than growing a second copy with its own mistakes.
 *
 * Google is the only provider wired today, and its branch is the ladder the
 * Google callback used to carry inline, in the same order, plus two checks
 * before linking by email: the matched account must not have two-factor
 * authentication on (read by the same email lookup), and it must not already
 * hold another Google subject (the query spec Decision 3 requires). Route
 * tests queue c2_query mocks in call order, so moving or adding a query is a
 * behaviour change even when the result looks the same.
 *
 * parseAuthProviders() (services/auth-providers.js, re-exported here) is the
 * boot-time answer to "which sign-in methods does this instance offer",
 * validated so a typo stops the process instead of quietly offering something
 * the operator did not ask for.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import crypto from 'crypto';
import { c2_query, withTransaction } from '../mysql_connect.js';
import { createDefaultPermissions, addSquadMember } from '../routes/helpers/shared.js';

/**
 * Decide which local user a verified external identity is.
 *
 * Returns { ok: true, userId, created } or { ok: false, reason } where reason is
 * one of: email_not_verified, domain_not_allowed, no_account,
 * identity_conflict, email_conflict, two_factor_enabled, account_deactivated. Never throws for a
 * refusal; a thrown error is a database failure and reaches errorHandler.
 *
 * The Google branch answers two_factor_enabled when the user matched by
 * verified email has two-factor authentication on (either method), and writes
 * nothing. The link INSERT repeats that test at insert time, reading the user
 * row FOR SHARE and requiring the email the lookup matched, so two-factor
 * turned on, or the address given up, after the lookup gets the same answer
 * at any isolation level. Password sign-in demands
 * that second factor (POST /api/login), and a link made by email would let
 * every later Google sign-in skip it, so such an account signs in with its
 * password and code instead. The refusal guards only the link: an identity
 * already linked signs in without local two-factor, even when its user turns
 * two-factor on afterwards, because once linked, Google's own sign-in (its MFA
 * included) governs the account.
 *
 * The Google branch answers identity_conflict when the user matched by
 * verified email already holds a Google account under another subject (a
 * recycled Workspace address, or a deleted and recreated Google account), and
 * writes nothing: spec Decision 3's rule, applied to Google
 * (docs/maps/open-questions.md C7). Relinking is by hand: the account's owner
 * unlinks Google (POST /api/oauth/google/unlink), or an operator deletes the
 * old oauth_accounts row. The same answer comes back when the link INSERT hits
 * UNIQUE (user_id, provider), which is how a second subject linking the same
 * user at the same instant, past that check, is refused.
 *
 * @param {{ provider: 'google'|'oidc', issuer?: string, subject: string,
 *           email: string, emailVerified: boolean, name?: string,
 *           picture?: string|null, hostedDomain?: string }} claims
 * @param {{ requiredHostedDomain?: string, linkByVerifiedEmail: boolean,
 *           autoCreate: boolean }} policy
 * @returns {Promise<{ ok: true, userId: number, created: boolean }
 *                   | { ok: false, reason: string }>}
 */
export async function resolveIdentity(claims, policy) {
  if (claims.provider === 'google') return await resolveGoogleIdentity(claims, policy);
  if (claims.provider === 'oidc') return await resolveOidcIdentity(claims, policy);
  // A programming error, not a refusal: no route may hand this seam a
  // provider it has no ladder for.
  throw new Error(`resolveIdentity: provider "${claims.provider}" is not implemented`);
}

/**
 * The oidc ladder (W6-CDX-5, spec Decision 3), for a verified (issuer, subject).
 *
 * 1. An identity already linked: the user signs in with no local second factor, whatever
 *    two_factor_method holds, because the issuer's own MFA governs a linked identity. If the verified
 *    email differs from users.email, it follows the issuer, unless another row holds the address
 *    (email_conflict, nothing written).
 * 2. With linkByVerifiedEmail: an account matched by email with two-factor on is refused
 *    (two_factor_enabled); one that already holds another subject at this issuer is refused
 *    (identity_conflict); otherwise the link is a conditional INSERT, which links only while the row
 *    still has two-factor off and still holds the matched email. Anything but one affected row is
 *    two_factor_enabled. A unique-key refusal on the link is identity_conflict.
 *    Without linkByVerifiedEmail, an account that holds the address is email_conflict.
 * 3. Otherwise an open invitation for the verified email (W6-CDX-8) creates the user, with its squad and
 *    flags, in one transaction; with none, no_account. The issuer's own account never admits anyone.
 * A deactivated user (users.deactivated_at) is account_deactivated on every rung that reaches one, before
 * any write, so a removed member keeps their authorship and loses their access.
 *
 * The email must be verified before any read, and missing or unverified is email_not_verified.
 */
/** The identity row for (issuer, subject), re-read after a refused INSERT. */
const RECHECK_SQL = 'SELECT id, user_id FROM user_identities WHERE issuer = ? AND subject = ? LIMIT 1';

/**
 * The identity row for (issuer, subject) with its user's deactivation, read in one query. The join is
 * what lets the identity rung refuse a deactivated user before it writes the last-sign-in touch.
 */
const HIT_SQL = `SELECT ui.id, ui.user_id, u.deactivated_at
   FROM user_identities ui JOIN users u ON u.id = ui.user_id
  WHERE ui.issuer = ? AND ui.subject = ? LIMIT 1`;

async function resolveOidcIdentity(claims, policy) {
  const { issuer, subject, email, emailVerified } = claims;

  if (!emailVerified) {
    return { ok: false, reason: 'email_not_verified' };
  }

  const [identity] = await c2_query(HIT_SQL, [issuer, subject]);

  if (identity) {
    // A deactivated user is refused before anything is written, so the refusal leaves no trace.
    if (identity.deactivated_at) return { ok: false, reason: 'account_deactivated' };
    // The issuer's email is recorded for display and audit, and users.email is never written here.
    // A change at the issuer does not move the local account's address: password reset mails that
    // address, and the local email-change rules (current password, confirmation to the new address,
    // notice to the old one) are the only way it changes. Authority rests on (issuer, subject).
    await c2_query(
      'UPDATE user_identities SET last_login_at = NOW(), email_at_last_signin = ? WHERE id = ?',
      [email, identity.id]
    );
    return { ok: true, userId: identity.user_id, created: false, identityId: identity.id };
  }

  // Binary comparison of the lowercased address. users.email's default collation is accent-insensitive,
  // so a plain LOWER(email) = LOWER(?) would treat 'é' and 'e' as one mailbox.
  const [existingUser] = await c2_query(
    `SELECT id, email, two_factor_method, deactivated_at FROM users
      WHERE LOWER(email) COLLATE utf8mb4_bin = LOWER(?) COLLATE utf8mb4_bin LIMIT 1`,
    [email]
  );

  if (existingUser) {
    if (!policy.linkByVerifiedEmail) {
      return { ok: false, reason: 'email_conflict' };
    }
    if (existingUser.deactivated_at) {
      return { ok: false, reason: 'account_deactivated' };
    }
    // Two-factor is checked before identity_conflict, as the Google rung does: it reads the row
    // already in hand and still holds once a conflicting link is cleared.
    if ((existingUser.two_factor_method ?? 'none') !== 'none') {
      return { ok: false, reason: 'two_factor_enabled' };
    }
    const [sameIssuer] = await c2_query(
      'SELECT id FROM user_identities WHERE user_id = ? AND issuer = ? LIMIT 1',
      [existingUser.id, issuer]
    );
    if (sameIssuer) {
      return { ok: false, reason: 'identity_conflict' };
    }

    let linked;
    try {
      linked = await c2_query(
        `INSERT INTO user_identities (user_id, issuer, subject, email_at_link, email_at_last_signin)
         SELECT id, ?, ?, ?, ? FROM users
          WHERE id = ? AND LOWER(email) COLLATE utf8mb4_bin = LOWER(?) COLLATE utf8mb4_bin
            AND (two_factor_method IS NULL OR two_factor_method = 'none')
          FOR SHARE`,
        [issuer, subject, existingUser.email, email, existingUser.id, existingUser.email]
      );
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY') throw err;
      // Two links raced. The key refused this one, so either the same person's concurrent sign-in won
      // (the same subject, the same user: the same identity, so ok) or a different identity holds the
      // user or the subject (refused). Re-reading the subject's row decides which.
      const [winner] = await c2_query(RECHECK_SQL, [issuer, subject]);
      if (winner && winner.user_id === existingUser.id) {
        return { ok: true, userId: existingUser.id, created: false, identityId: winner.id };
      }
      return { ok: false, reason: 'identity_conflict' };
    }
    if (linked.affectedRows !== 1) {
      return { ok: false, reason: 'two_factor_enabled' };
    }
    return { ok: true, userId: existingUser.id, created: false, identityId: linked.insertId };
  }

  // Step 3: an open invitation for this verified address. The invitation is the admission; the issuer
  // account alone never is.
  const [invitation] = await c2_query(
    `SELECT id, squad_id, role, can_read, can_write, can_create_log, can_create_archive,
            can_manage_members, can_delete_version, can_publish
       FROM user_invitations
      WHERE LOWER(email) COLLATE utf8mb4_bin = LOWER(?) COLLATE utf8mb4_bin AND accepted = FALSE AND expires_at > NOW()
      ORDER BY created_at DESC LIMIT 1`,
    [email]
  );

  if (!invitation) {
    return { ok: false, reason: 'no_account' };
  }
  return await createFromInvitation(claims, invitation);
}

/** Thrown inside the invitation transaction when the invitation was taken or revoked in the window. */
class InvitationGone extends Error {}

/**
 * Create the user an invitation admits, in one transaction, as POST /api/create-account does: the user
 * with the derived username and no password, its default permissions, the invitation marked accepted
 * (conditionally, and checked), the squad membership when the invitation names one, and the identity.
 * A transaction that cannot see the invitation still open refuses with nothing written.
 */
async function createFromInvitation(claims, invitation) {
  const { issuer, subject, email } = claims;
  const username = await deriveUniqueUsername(email);
  try {
    return await withTransaction(async (query) => {
      const created = await query(
        'INSERT INTO users (name, email, created_at) VALUES (?, ?, NOW())',
        [username, email]
      );
      const userId = created.insertId;
      await createDefaultPermissions(userId, query);

      const accepted = await query(
        'UPDATE user_invitations SET accepted = TRUE WHERE id = ? AND accepted = FALSE',
        [invitation.id]
      );
      if (accepted.affectedRows !== 1) throw new InvitationGone();

      if (invitation.squad_id) {
        await addSquadMember(invitation.squad_id, userId, invitation, query);
      }

      const identity = await query(
        `INSERT INTO user_identities (user_id, issuer, subject, email_at_link, email_at_last_signin)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, issuer, subject, email, email]
      );
      return { ok: true, userId, created: true, identityId: identity.insertId };
    });
  } catch (err) {
    if (err instanceof InvitationGone) return { ok: false, reason: 'no_account' };
    throw err;
  }
}

/**
 * The key that holds a user to one account per provider (init.sql), as MySQL
 * names it in a duplicate-entry message: `for key 'oauth_accounts.<name>'`.
 */
const ONE_LINK_PER_PROVIDER_KEY = "'oauth_accounts.uq_oauth_user_provider'";

/**
 * Whether an INSERT failed on the one-link-per-provider key, and not on the
 * subject key uq_provider_user, which the same subject racing itself hits.
 * The Google ladder below and the GitHub link callback (routes/oauth.js) both
 * answer it as a named refusal; any other error is theirs to rethrow.
 * @param {Error & { code?: string, sqlMessage?: string }} err
 * @returns {boolean}
 */
export function isSecondLinkForProvider(err) {
  return err.code === 'ER_DUP_ENTRY' && String(err.sqlMessage).includes(ONE_LINK_PER_PROVIDER_KEY);
}

async function resolveGoogleIdentity(claims, policy) {
  const { subject: googleUserId, email, emailVerified, hostedDomain } = claims;

  if (!emailVerified) {
    return { ok: false, reason: 'email_not_verified' };
  }

  // If a domain restriction is set, enforce it
  if (policy.requiredHostedDomain && hostedDomain !== policy.requiredHostedDomain) {
    return { ok: false, reason: 'domain_not_allowed' };
  }

  // Check if this Google account is already linked
  const [existingOAuth] = await c2_query(
    `SELECT oa.user_id, u.deactivated_at FROM oauth_accounts oa JOIN users u ON u.id = oa.user_id
      WHERE oa.provider = 'google' AND oa.provider_user_id = ? LIMIT 1`,
    [googleUserId]
  );

  if (existingOAuth) {
    if (existingOAuth.deactivated_at) return { ok: false, reason: 'account_deactivated' };
    // Already linked, log them in. No local two-factor here, deliberately, and
    // that includes a user who turned it on after linking: a linked account
    // signs in on Google's own sign-in, its MFA included. What keeps this from
    // bypassing a local second factor is the two_factor_enabled refusal below,
    // which stops such an account being linked by email in the first place.
    return { ok: true, userId: existingOAuth.user_id, created: false };
  }

  // Check if a user with this email already exists, and whether it has
  // two-factor on (the link-by-email refusals below need both).
  const [existingUser] = await c2_query(
    `SELECT id, two_factor_method, deactivated_at FROM users WHERE email = ? LIMIT 1`,
    [email]
  );

  if (existingUser) {
    if (!policy.linkByVerifiedEmail) {
      // The address belongs to someone this identity may not claim, and
      // creating a second user with it would collide on users.email.
      return { ok: false, reason: 'email_conflict' };
    }
    if (existingUser.deactivated_at) return { ok: false, reason: 'account_deactivated' };
    // An account with two-factor on is never linked by email: password
    // sign-in demands its second factor, and a link would let every later
    // Google sign-in skip it. Both methods refuse alike; 'none' and NULL are
    // off (GET /api/2fa/status reads the column the same way) and any other
    // value counts as on, which is exactly the test the link INSERT below
    // repeats in SQL, so the two can never disagree.
    // It sits after email_conflict, which is the policy's answer before any
    // account's settings matter, and before identity_conflict, because it
    // reads the row already in hand, costs no query, and still holds once a
    // conflicting link is cleared: relinking would not help this account.
    if ((existingUser.two_factor_method ?? 'none') !== 'none') {
      return { ok: false, reason: 'two_factor_enabled' };
    }
    // The subject lookup above missed, so any Google row this user holds is
    // another subject: the address has changed hands, or the Google account
    // was recreated. Refuse rather than sign the newcomer into it.
    const [existingGoogle] = await c2_query(
      `SELECT id FROM oauth_accounts WHERE provider = 'google' AND user_id = ? LIMIT 1`,
      [existingUser.id]
    );
    if (existingGoogle) {
      return { ok: false, reason: 'identity_conflict' };
    }
    // Link Google account to existing user. The row can change between the
    // reads above and this write, and the write itself answers that.
    //
    // The owner can turn two-factor on after the lookup saw it off, or the
    // account can give up the email the lookup matched. So the INSERT copies
    // the user row only while two-factor is still off and the row still holds
    // that email, and reads it FOR SHARE: a locking read, at any isolation
    // level, so a change still being committed is waited for and then seen
    // (without it, READ COMMITTED reads the old row and links over the
    // change). Anything but exactly one row means the row no longer
    // qualifies, and the answer is the refusal with nothing written; the next
    // sign-in looks the address up afresh.
    //
    // A second subject can link this user at the same instant. The SELECT
    // above cannot see that; the key can, and the INSERT that lands second
    // gets the answer the SELECT would have given.
    let linked;
    try {
      linked = await c2_query(
        `INSERT INTO oauth_accounts (user_id, provider, provider_user_id, provider_email)
         SELECT id, 'google', ?, ? FROM users
          WHERE id = ? AND email = ?
            AND (two_factor_method IS NULL OR two_factor_method = 'none')
          FOR SHARE`,
        [googleUserId, email, existingUser.id, email]
      );
    } catch (err) {
      if (isSecondLinkForProvider(err)) {
        return { ok: false, reason: 'identity_conflict' };
      }
      throw err;
    }
    if (linked.affectedRows !== 1) {
      return { ok: false, reason: 'two_factor_enabled' };
    }
    return { ok: true, userId: existingUser.id, created: false };
  }

  // No existing account: auto-create only when the policy allows it
  if (!policy.autoCreate) {
    return { ok: false, reason: 'no_account' };
  }

  const username = await deriveUniqueUsername(email);

  const result = await c2_query(
    `INSERT INTO users (name, password_hash, email, avatar_url, created_at)
     VALUES (?, NULL, ?, ?, NOW())`,
    [username, email, claims.picture || null]
  );

  const userId = result.insertId;

  // Create default permissions
  await createDefaultPermissions(userId);

  // Link the OAuth account
  await c2_query(
    `INSERT INTO oauth_accounts (user_id, provider, provider_user_id, provider_email) VALUES (?, 'google', ?, ?)`,
    [userId, googleUserId, email]
  );

  return { ok: true, userId, created: true };
}

/**
 * Derive a username from the Google profile email.
 * Takes the local part, strips invalid characters, and ensures uniqueness.
 */
export async function deriveUniqueUsername(email) {
  // Take local part of email, keep only valid chars, truncate to 32
  let base = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 28);
  if (base.length < 3) base = base.padEnd(3, '_');

  // Check if it's available
  const [existing] = await c2_query(
    `SELECT id FROM users WHERE LOWER(name) = LOWER(?) LIMIT 1`,
    [base]
  );
  if (!existing) return base;

  // Append random suffix
  for (let i = 0; i < 20; i++) {
    const candidate = `${base}_${crypto.randomBytes(2).toString('hex')}`.slice(0, 32);
    const [dup] = await c2_query(
      `SELECT id FROM users WHERE LOWER(name) = LOWER(?) LIMIT 1`,
      [candidate]
    );
    if (!dup) return candidate;
  }

  // Fallback: fully random
  return `user_${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * parseAuthProviders() now lives in services/auth-providers.js, which the database layer can import
 * without a cycle. The re-export keeps the existing import path.
 */
export { parseAuthProviders } from './auth-providers.js';
