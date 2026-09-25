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
 * Google callback used to carry inline, with the same SQL in the same order:
 * route tests queue c2_query mocks in call order, so moving a query is a
 * behaviour change even when the result looks the same.
 *
 * parseAuthProviders() is the boot-time answer to "which sign-in methods does
 * this instance offer", validated so a typo stops the process instead of
 * quietly offering something the operator did not ask for.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import crypto from 'crypto';
import { c2_query } from '../mysql_connect.js';
import { createDefaultPermissions } from '../routes/helpers/shared.js';

/**
 * Decide which local user a verified external identity is.
 *
 * Returns { ok: true, userId, created } or { ok: false, reason } where reason is
 * one of: email_not_verified, domain_not_allowed, no_account,
 * identity_conflict, email_conflict. Never throws for a refusal; a thrown
 * error is a database failure and reaches errorHandler.
 *
 * The Google branch never answers identity_conflict: today's ladder links a
 * second Google account to a user who already has one, and this seam moves
 * that ladder without changing it (docs/maps/open-questions.md records it).
 * identity_conflict arrives with the OIDC branch.
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
  if (claims.provider !== 'google') {
    // A programming error, not a refusal: no route may hand this seam a
    // provider it has no ladder for.
    throw new Error(`resolveIdentity: provider "${claims.provider}" is not implemented`);
  }
  return resolveGoogleIdentity(claims, policy);
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
    `SELECT user_id FROM oauth_accounts WHERE provider = 'google' AND provider_user_id = ? LIMIT 1`,
    [googleUserId]
  );

  if (existingOAuth) {
    // Already linked, log them in
    return { ok: true, userId: existingOAuth.user_id, created: false };
  }

  // Check if a user with this email already exists
  const [existingUser] = await c2_query(
    `SELECT id FROM users WHERE email = ? LIMIT 1`,
    [email]
  );

  if (existingUser) {
    if (!policy.linkByVerifiedEmail) {
      // The address belongs to someone this identity may not claim, and
      // creating a second user with it would collide on users.email.
      return { ok: false, reason: 'email_conflict' };
    }
    // Link Google account to existing user
    await c2_query(
      `INSERT INTO oauth_accounts (user_id, provider, provider_user_id, provider_email) VALUES (?, 'google', ?, ?)`,
      [existingUser.id, googleUserId, email]
    );
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

/** Sign-in providers this version knows. `oidc` joins with the relying party. */
const KNOWN_AUTH_PROVIDERS = ['local', 'google'];

/**
 * Google counts as configured on the same rule routes/oauth.js applies: both
 * the client id and the secret set. Read here at call time, by literal name.
 */
function isGoogleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/**
 * The sign-in providers this instance offers, from AUTH_PROVIDERS.
 *
 * Unset (or blank): today's derived set, `local` always plus `google` when
 * Google is configured. Set: a comma list of `local` and `google`, compared
 * case-insensitively. Throws, with a sentence naming the variable, on an
 * unknown name, on a list without `local` (an instance without local sign-in
 * is not supported yet), on a listed provider that is not configured, and on
 * a configured Google the list leaves out, because the Google routes would
 * still offer it and the variable would then say something untrue.
 *
 * @returns {Set<string>}
 */
export function parseAuthProviders() {
  const googleConfigured = isGoogleConfigured();
  const raw = process.env.AUTH_PROVIDERS;

  if (raw === undefined || raw.trim() === '') {
    return new Set(googleConfigured ? ['local', 'google'] : ['local']);
  }

  const names = raw.split(',').map(name => name.trim().toLowerCase()).filter(name => name !== '');

  for (const name of names) {
    if (!KNOWN_AUTH_PROVIDERS.includes(name)) {
      throw new Error(
        `AUTH_PROVIDERS lists "${name}", which is not a sign-in provider this version knows; ` +
        `use a comma list of ${KNOWN_AUTH_PROVIDERS.join(' and ')}, or leave AUTH_PROVIDERS unset.`
      );
    }
  }

  const providers = new Set(names);

  if (!providers.has('local')) {
    throw new Error(
      'AUTH_PROVIDERS must include local, because an instance without local sign-in is not ' +
      'supported yet; add local, or leave AUTH_PROVIDERS unset.'
    );
  }

  if (providers.has('google') && !googleConfigured) {
    throw new Error(
      'AUTH_PROVIDERS lists google, but GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not both ' +
      'set; set them, or remove google from AUTH_PROVIDERS.'
    );
  }

  if (!providers.has('google') && googleConfigured) {
    throw new Error(
      'AUTH_PROVIDERS does not list google, but GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are ' +
      'set, so Google sign-in would still be offered; add google to AUTH_PROVIDERS, or unset ' +
      'the Google variables.'
    );
  }

  return providers;
}
