/**
 * Machine (service-to-service) authentication for Cloud Codex
 *
 * The single seam through which a non-human caller is authenticated. Today it
 * validates a shared secret from the environment; a later OIDC
 * client-credentials grant replaces the body of verifyMachineCredential() and
 * no call site changes.
 *
 * Two things make the blast radius small:
 *
 *   1. The credential acts as a REAL, EXISTING, NON-ADMIN user, so the whole
 *      existing access-control layer in routes/helpers/ownership.js applies
 *      unchanged and no new access-control SQL exists to get wrong.
 *   2. is_admin on the returned principal is forced to false and never copied
 *      from the users row. is_admin is the FIRST bound parameter of every
 *      fragment in ownership.js (`? = TRUE OR ...`), so a principal carrying
 *      it true would match every archive in the install. That is guarded
 *      twice: the admin row is refused outright below, and the principal is
 *      constructed with the literal false.
 *
 * Both SERVICE_TOKEN and SERVICE_TOKEN_USER are required. An install that
 * sets neither gains no new authentication path.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import crypto from 'crypto';
import { c2_query } from '../mysql_connect.js';

/**
 * A shared secret short enough to guess is still short behind a rate limiter,
 * so a SERVICE_TOKEN under this length disables the feature rather than
 * weakening it.
 */
const MIN_TOKEN_LENGTH = 32;

/**
 * Last resolved configuration, keyed by the raw environment pair it was built
 * from. Resolving is cheap, but caching keeps the misconfiguration warning to
 * once per distinct configuration instead of once per request, so an
 * unauthenticated caller cannot use a bad SERVICE_TOKEN to flood the log.
 */
let cachedConfig = null;

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Resolve SERVICE_TOKEN / SERVICE_TOKEN_USER into a usable configuration.
 * Read at call time rather than at import time so a test (or a restart-free
 * deployment tool) sees the current environment.
 *
 * @returns {{ enabled: boolean, digest: Buffer|null, email: string|null }}
 */
function resolveConfig() {
  const rawToken = process.env.SERVICE_TOKEN || '';
  const rawEmail = process.env.SERVICE_TOKEN_USER || '';

  if (cachedConfig && cachedConfig.rawToken === rawToken && cachedConfig.rawEmail === rawEmail) {
    return cachedConfig;
  }

  // Trimmed because a value pasted into .env commonly carries trailing
  // whitespace, and a secret that silently differs by a space is a support
  // ticket nobody enjoys.
  const token = rawToken.trim();
  const email = rawEmail.trim();

  let config = { rawToken, rawEmail, enabled: false, digest: null, email: null };

  if (token && email) {
    if (token.length < MIN_TOKEN_LENGTH) {
      // Never log the value, only the fact that it is too short.
      console.error(
        `[${new Date().toISOString()}] machine-auth: SERVICE_TOKEN is shorter than ` +
        `${MIN_TOKEN_LENGTH} characters, so machine authentication stays disabled`
      );
    } else {
      config = { rawToken, rawEmail, enabled: true, digest: sha256(token), email };
    }
  }

  cachedConfig = config;
  return config;
}

/**
 * Validate a machine credential and return the principal it acts as.
 *
 * Returns null when machine auth is not configured, when the token does not
 * match, or when the configured principal does not resolve to a usable
 * non-admin user. Callers treat null as "this is not a machine caller" and
 * fall through to ordinary session authentication.
 *
 * @param {string} token The credential presented by the caller.
 * @returns {Promise<{id: number, name: string, email: string, is_admin: false, is_machine: true}|null>}
 */
export async function verifyMachineCredential(token) {
  const config = resolveConfig();
  if (!config.enabled) return null;
  if (typeof token !== 'string' || token.length === 0) return null;

  // Constant-time comparison over two SHA-256 digests. Hashing first means the
  // buffers are always 32 bytes, so a presented token of the wrong length is
  // rejected without timingSafeEqual throwing and without the comparison
  // itself leaking the configured token's length. Never `===`.
  if (!crypto.timingSafeEqual(sha256(token), config.digest)) return null;

  // Deliberately after the comparison: a caller who does not hold the secret
  // never reaches the database, so a wrong token costs no query.
  const [row] = await c2_query(
    'SELECT id, name, email, is_admin FROM users WHERE email = ? LIMIT 1',
    [config.email]
  );
  if (!row) {
    // Worth a line: a typo in SERVICE_TOKEN_USER, or a user that was later
    // deleted, otherwise looks exactly like a wrong secret from the caller's
    // side, and the operator's first instinct is to rotate a secret that was
    // never the problem. Reachable only by a caller that already passed the
    // comparison above, so it cannot be driven by an anonymous flood.
    console.error(
      `[${new Date().toISOString()}] machine-auth: SERVICE_TOKEN_USER "${config.email}" ` +
      'matches no user, refusing to issue a machine principal'
    );
    return null;
  }

  // Guard one of two. See the file header: an admin principal would satisfy
  // clause 1 of every access fragment and reach every archive in the install.
  if (row.is_admin) {
    console.error(
      `[${new Date().toISOString()}] machine-auth: SERVICE_TOKEN_USER "${config.email}" ` +
      'is an admin account, refusing to issue a machine principal'
    );
    return null;
  }

  // Guard two of two: is_admin is the literal false, never the column.
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    is_admin: false,
    is_machine: true,
  };
}
