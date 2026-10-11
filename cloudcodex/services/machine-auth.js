/**
 * Machine (service-to-service) authentication for Cloud Codex
 *
 * The single seam through which a non-human caller is authenticated. It takes
 * one of two paths, and no call site knows which:
 *
 *   - The static path: a shared SERVICE_TOKEN, compared by digest. Unchanged.
 *   - The JWT path (W6-CDX-7): a JWS-shaped token is an OIDC client-credentials
 *     access token from Cloud City ID, verified with jose against the issuer's
 *     cached key set. It is taken only when OIDC_ISSUER_URL,
 *     MACHINE_OIDC_AUDIENCE and MACHINE_OIDC_SUBJECTS are all set. It is reached
 *     only after the static digest has missed, so a dotted SERVICE_TOKEN still
 *     matches as the secret it is. The audience pins this instance's
 *     own project; it is NOT the tenant boundary, because Zitadel lets any
 *     client request any project's audience. The subject allowlist is the
 *     control: a token must name one of this instance's service users.
 *
 * An outage (discovery or the key set cannot be read) raises
 * MachineAuthUnavailable where it happens, opens a 30-second window in which
 * the issuer is not asked again, and is answered 503. It is never a null, so a
 * caller cannot read an outage as a revoked credential. Every other error jose
 * reports about a token is a refusal.
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
 * Both paths need SERVICE_TOKEN_USER, and the static path also needs
 * SERVICE_TOKEN. An install that sets neither the static pair nor the JWT
 * variables gains no new authentication path.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import crypto from 'crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { c2_query } from '../mysql_connect.js';

/**
 * Three base64url segments with none empty: a compact JWS. Anything else, a session token included,
 * takes the static path or none. A JWE (five segments) does not match.
 */
const JWS_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** Seconds of skew allowed on exp and nbf, and on how far iat may sit in the future. */
const CLOCK_TOLERANCE_SECONDS = 60;
const DISCOVERY_TIMEOUT_MS = 5000;
const JWKS_TIMEOUT_MS = 5000;
/** How long jose waits before refetching the key set for an unknown kid. */
const JWKS_COOLDOWN_MS = 30000;
const JWKS_MAX_AGE_MS = 10 * 60 * 1000;

/** The key set answering that the token's kid is not published: a refusal of the token, not an outage. */
const KEY_MISS_CODES = new Set(['ERR_JWKS_NO_MATCHING_KEY', 'ERR_JWKS_MULTIPLE_MATCHING_KEYS']);

/**
 * Asymmetric algorithms only. HS256 is absent on purpose: a token MACed with the public key, or with
 * any shared secret, must never verify here. jose also refuses alg none outright.
 */
const ASYMMETRIC_ALGORITHMS = [
  'RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA',
];

/**
 * The issuer's keys could not be read, so the caller's token is unknown, not refused. The middleware
 * answers 503 for it. The message names what failed, never the token.
 */
export class MachineAuthUnavailable extends Error {
  /** @param {string} detail */
  constructor(detail) {
    super(`machine-auth: ${detail}`);
    this.name = 'MachineAuthUnavailable';
    this.code = 'MACHINE_AUTH_UNAVAILABLE';
  }
}

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
  if (typeof token !== 'string' || token.length === 0) return null;

  // The static digest is compared first, in constant time over two SHA-256 digests. Hashing first
  // means the buffers are always 32 bytes, so a token of the wrong length is rejected without
  // timingSafeEqual throwing and without leaking the configured token's length. Never `===`. A
  // SERVICE_TOKEN with dots is therefore matched as the secret it is.
  const config = resolveConfig();
  if (config.enabled && crypto.timingSafeEqual(sha256(token), config.digest)) {
    // Deliberately after the comparison: a caller who does not hold the secret never reaches the
    // database, so a wrong token costs no query.
    return await principalFor(config.email);
  }

  // W6-CDX-7: only a token that missed the static digest and is JWS-shaped goes to jose, and only
  // when the JWT path is configured. A 64-character session token has no dots, so it never does.
  const jwt = jwtConfig();
  if (jwt !== null && JWS_SHAPE.test(token)) return await verifyMachineJwt(token, jwt);
  return null;
}

/**
 * The principal a machine credential acts as: the SERVICE_TOKEN_USER row, refused when it is
 * missing or an admin. Shared by both paths, so the JWT branch cannot grow its own ladder.
 *
 * @param {string} email
 * @returns {Promise<{id: number, name: string, email: string, is_admin: false, is_machine: true}|null>}
 */
async function principalFor(email) {
  const [row] = await c2_query(
    // A deactivated service user is no principal, on either path: the same answer as a missing row.
    'SELECT id, name, email, is_admin FROM users WHERE email = ? AND deactivated_at IS NULL LIMIT 1',
    [email]
  );
  if (!row) {
    // Worth a line: a typo in SERVICE_TOKEN_USER, or a user that was later
    // deleted, otherwise looks exactly like a wrong secret from the caller's
    // side, and the operator's first instinct is to rotate a secret that was
    // never the problem. Reachable only by a caller that already passed the
    // comparison above, so it cannot be driven by an anonymous flood.
    console.error(
      `[${new Date().toISOString()}] machine-auth: SERVICE_TOKEN_USER "${email}" ` +
      'matches no active user (missing, or deactivated), refusing to issue a machine principal'
    );
    return null;
  }

  // Guard one of two. See the file header: an admin principal would satisfy
  // clause 1 of every access fragment and reach every archive in the install.
  if (row.is_admin) {
    console.error(
      `[${new Date().toISOString()}] machine-auth: SERVICE_TOKEN_USER "${email}" ` +
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

/**
 * The JWT path (W6-CDX-7). Returns the principal, null for a token that is refused, or throws
 * MachineAuthUnavailable when the issuer's keys cannot be read. Read in this order: signature,
 * issuer, audience, expiry, then the subject allowlist, then the principal.
 *
 * @param {string} token
 * @param {{ issuer: string, audience: string, subjects: Set<string> }} jwt
 */
async function verifyMachineJwt(token, jwt) {
  // Inside the cooldown after an outage the answer comes from memory: no fetch, no token parsing,
  // and no log line, so a flood of bearers costs one fetch per window.
  if (coolingDown()) throw new MachineAuthUnavailable('the issuer is unavailable (cooling down)');
  let payload;
  try {
    const keys = await remoteKeySet(jwt.issuer);
    ({ payload } = await jwtVerify(token, guardedKeys(keys), {
      issuer: jwt.issuer,
      audience: jwt.audience,
      algorithms: ASYMMETRIC_ALGORITHMS,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      requiredClaims: ['exp', 'iat', 'sub'],
    }));
  } catch (err) {
    // Outages were already thrown as MachineAuthUnavailable where they happened: discovery, the
    // key set fetch in guardedKeys. Every other error jose reports is about this token (an unknown
    // crit header, a bad signature, a claim), so it is a refusal whatever its code.
    if (err instanceof MachineAuthUnavailable) throw err;
    return null;
  }
  outageUntil = 0;

  // jose checks exp and nbf but not iat, so a token dated in the future is refused here.
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.iat !== 'number' || payload.iat > now + CLOCK_TOLERANCE_SECONDS) return null;

  if (typeof payload.sub !== 'string' || !jwt.subjects.has(payload.sub)) return null;

  const email = (process.env.SERVICE_TOKEN_USER || '').trim();
  if (email === '') {
    console.error(
      `[${new Date().toISOString()}] machine-auth: a JWT was presented but SERVICE_TOKEN_USER is ` +
      'unset, so there is no principal to act as; refusing'
    );
    return null;
  }
  return principalFor(email);
}

/**
 * The JWT branch's configuration, read at call time like the static one. Null, which keeps the
 * branch off, unless all three variables are set and the subject list has at least one entry.
 *
 * @returns {null | { issuer: string, audience: string, subjects: Set<string> }}
 */
function jwtConfig() {
  const issuer = (process.env.OIDC_ISSUER_URL || '').trim();
  const audience = (process.env.MACHINE_OIDC_AUDIENCE || '').trim();
  const subjects = new Set(
    (process.env.MACHINE_OIDC_SUBJECTS || '').split(',').map((s) => s.trim()).filter(Boolean)
  );
  if (issuer === '' || audience === '' || subjects.size === 0) return null;
  return { issuer, audience, subjects };
}

/**
 * The issuer's key set, cached for the process. The discovery document and the key set are fetched
 * once and kept; a failed discovery is not kept, so one outage does not refuse every later call
 * until a restart. Concurrent first calls share one discovery.
 */
let jwksCache = null;
let pendingJwks = null;

/**
 * After an outage (discovery or the key set failing), calls answer 503 from memory for this long, and
 * the issuer is not asked again. One window, one fetch, one log line.
 */
const OUTAGE_COOLDOWN_MS = 30 * 1000;
let outageUntil = 0;

function remoteKeySet(issuer) {
  if (jwksCache !== null && jwksCache.issuer === issuer) return jwksCache.keys;
  if (pendingJwks !== null && pendingJwks.issuer === issuer) return pendingJwks.promise;

  const promise = discoverJwksUri(issuer)
    .then((uri) => {
      let keys;
      try {
        keys = createRemoteJWKSet(new URL(uri), {
          timeoutDuration: JWKS_TIMEOUT_MS,
          cooldownDuration: JWKS_COOLDOWN_MS,
          cacheMaxAge: JWKS_MAX_AGE_MS,
        });
      } catch {
        throw markOutage('the discovery document names an unusable key set URL');
      }
      jwksCache = { issuer, keys };
      return keys;
    })
    .finally(() => {
      if (pendingJwks !== null && pendingJwks.promise === promise) pendingJwks = null;
    });
  pendingJwks = { issuer, promise };
  return promise;
}

/**
 * The jwks_uri from the issuer's discovery document. The document must name the configured issuer
 * exactly, the same check jose makes on the token's iss.
 *
 * @param {string} issuer
 * @returns {Promise<string>}
 */
async function discoverJwksUri(issuer) {
  const url = `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`;
  let document;
  try {
    const res = await fetch(url, {
      redirect: 'manual',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    document = await res.json();
  } catch (err) {
    throw markOutage(`discovery failed (${err?.name || 'error'})`);
  }
  if (document?.issuer !== issuer || typeof document.jwks_uri !== 'string') {
    throw markOutage('the discovery document names another issuer or no key set');
  }
  return document.jwks_uri;
}

/**
 * The key set as jose sees it. A fetch or parse failure inside the key set is an outage, marked
 * where it happens. A key miss (no matching kid) is about the token, and passes through as a
 * refusal.
 */
function guardedKeys(keys) {
  return async (header, token) => {
    try {
      return await keys(header, token);
    } catch (err) {
      if (KEY_MISS_CODES.has(err?.code)) throw err;
      throw markOutage(`the key set could not be read (${err?.code || err?.name || 'error'})`);
    }
  };
}

/**
 * Records an outage: opens the cooldown window, logs the detail (never the token) once, and returns
 * the error to throw. Callers inside an open window do not come here, so a window logs once.
 */
function markOutage(detail) {
  outageUntil = Date.now() + OUTAGE_COOLDOWN_MS;
  console.error(`[${new Date().toISOString()}] machine-auth: the issuer is unavailable (${detail}), answering 503`);
  return new MachineAuthUnavailable(detail);
}

function coolingDown() {
  return Date.now() < outageUntil;
}

/**
 * Test-only: forget the cached discovery, key set and any open outage window, so the next call
 * fetches them again.
 */
export function resetMachineJwtCache() {
  jwksCache = null;
  pendingJwks = null;
  outageUntil = 0;
}
