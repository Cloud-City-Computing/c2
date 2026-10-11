/**
 * OIDC Back-Channel Logout 1.0: verifies a logout token and ends the sessions it names (W6-CDX-6)
 *
 * The issuer POSTs a logout token when it ends a session that signed in to this relying party. This
 * module decides whether the token is genuine and what it ends; routes/oidc.js answers the request.
 * Answers are split by who is at fault. A token that fails any check is refused (null, answered 400),
 * because the issuer treats a 400 as final. A key that cannot be fetched is LogoutTokenUnavailable
 * (answered 503), because the issuer retries anything that is not 200, 202, 204 or 400.
 *
 * Every delete is bounded by created_at <= iat + 60 seconds, so a replayed token cannot end a session
 * the person opened after the logout. The jti map is a duplicate filter for the issuer's own retries,
 * correct for the single process this relying party runs as. It records a jti only after its delete
 * has committed, so a failed attempt's retry still runs.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import * as jose from 'jose';
import { withTransaction } from '../mysql_connect.js';
import { loadConfiguration } from './oidc.js';

/** The event the logout token must carry, which marks it as a back-channel logout. */
export const LOGOUT_EVENT = 'http://schemas.openid.net/event/backchannel-logout';

/** Asymmetric algorithms only. A symmetric one would let a shared secret mint logout tokens. */
const ASYMMETRIC_ALGORITHMS = ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA'];

const CLOCK_TOLERANCE_SECONDS = 60;
/** How old a token's iat may be; with the skew above, a token is accepted up to six minutes after iat. */
const MAX_TOKEN_AGE = '5m';
/** Seconds after a token's iat that a session may have been created and still be ended by it. */
const CREATED_AT_SLACK_SECONDS = 60;

const JTI_CAPACITY = 10000;
const JTI_TTL_MS = 10 * 60 * 1000;

/** The same subject rule the callback applies to a stored sub (services/oidc.js). */
const SUBJECT_RE = /^[\x21-\x7e]{1,255}$/;

/** The key side failed: discovery, or the issuer's keys could not be fetched. The issuer should retry. */
export class LogoutTokenUnavailable extends Error {
  constructor(message) {
    super(message);
    this.name = 'LogoutTokenUnavailable';
  }
}

/**
 * The token names a key id the issuer did not publish, on a key set fetched for this very request.
 * A forged kid is a refused token (400): the issuer must not retry it forever.
 */
class UnknownKeyId extends Error {
  constructor() {
    super('The token names a key the issuer does not publish.');
    this.name = 'UnknownKeyId';
  }
}

/**
 * How long after a key fetch an unknown kid is answered 503 rather than refetched and refused. A
 * key rotation can publish a new kid moments before the token that uses it, so inside this window the
 * answer is "try again" (the issuer retries), not "never".
 */
const KEY_REFRESH_COOLDOWN_MS = 30 * 1000;
const KEY_FETCH_TIMEOUT_MS = 5000;

/** The jose classes that mean the token itself is refused, as opposed to the keys being unavailable. */
const TOKEN_REFUSALS = [
  jose.errors.JWTClaimValidationFailed,
  jose.errors.JWTExpired,
  jose.errors.JWTInvalid,
  jose.errors.JWSInvalid,
  jose.errors.JWSSignatureVerificationFailed,
  jose.errors.JOSEAlgNotAllowed,
];

/** The key set per discovered jwks_uri: { local, fetchedAt }, kept for the process. */
const keySets = new Map();

/** jti -> the time it was recorded. Insertion order is age order, so eviction walks from the front. */
const seenJtis = new Map();

/**
 * Fetches the issuer's key set and makes it the one used for this process. Any failure (the network,
 * a non-200, a body that is not a JWKS) is LogoutTokenUnavailable.
 * @param {string} jwksUri
 * @returns {Promise<{ local: Function, fetchedAt: number }>}
 */
async function fetchKeySet(jwksUri) {
  let body;
  try {
    const response = await fetch(jwksUri, { signal: AbortSignal.timeout(KEY_FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`status ${response.status}`);
    body = await response.json();
    const entry = { local: jose.createLocalJWKSet(body), fetchedAt: Date.now() };
    keySets.set(jwksUri, entry);
    return entry;
  } catch {
    throw new LogoutTokenUnavailable('The issuer\'s keys could not be fetched.');
  }
}

/**
 * The jwt key resolver for one jwks_uri. A kid already cached verifies. An unknown kid is refetched
 * once, unless the cached set was fetched within the cooldown before this request (then it is a
 * 503), and a kid still unknown after a fresh fetch is UnknownKeyId.
 * @param {string} jwksUri
 * @returns {Function}
 */
function keyResolver(jwksUri) {
  return async (header, token) => {
    let entry = keySets.get(jwksUri);
    let fetchedNow = false;
    if (entry === undefined) {
      entry = await fetchKeySet(jwksUri);
      fetchedNow = true;
    }
    try {
      return await entry.local(header, token);
    } catch (err) {
      if (!(err instanceof jose.errors.JWKSNoMatchingKey)) throw err;
      if (fetchedNow) throw new UnknownKeyId();
      if (Date.now() - entry.fetchedAt < KEY_REFRESH_COOLDOWN_MS) {
        throw new LogoutTokenUnavailable('An unknown key id arrived inside the key refresh cooldown.');
      }
      entry = await fetchKeySet(jwksUri);
      try {
        return await entry.local(header, token);
      } catch (retryErr) {
        if (retryErr instanceof jose.errors.JWKSNoMatchingKey) throw new UnknownKeyId();
        throw retryErr;
      }
    }
  };
}

function pruneJtis(now) {
  for (const [jti, recordedAt] of seenJtis) {
    if (seenJtis.size <= JTI_CAPACITY && now - recordedAt <= JTI_TTL_MS) break;
    seenJtis.delete(jti);
  }
}

/**
 * Whether a jti was already applied and recorded while this process ran.
 * @param {string} jti
 * @returns {boolean}
 */
export function isJtiSeen(jti) {
  pruneJtis(Date.now());
  return seenJtis.has(jti);
}

/**
 * Records a jti after its delete has committed. Never before: a jti recorded ahead of a failed
 * delete would turn the issuer's retry into a refusal, and the session would survive.
 * @param {string} jti
 */
export function rememberJti(jti) {
  const now = Date.now();
  seenJtis.delete(jti);
  seenJtis.set(jti, now);
  pruneJtis(now);
}

/** Test-only: forget the key sets and the jtis, so each test starts as a fresh process would. */
export function resetLogoutTokenState() {
  keySets.clear();
  seenJtis.clear();
}

/**
 * Verifies a logout token. Returns the claims the deletes need, or null for any token that is not
 * valid (every answer a 400). Throws LogoutTokenUnavailable when the discovery or the keys are
 * unavailable (a 503). Never returns or throws with the token's text.
 * @param {{ clientId: string }} config - from getOidcConfig()
 * @param {unknown} token - the logout_token form field
 * @returns {Promise<null | { iss: string, sid: string | null, sub: string | null, jti: string, iat: number }>}
 */
export async function verifyLogoutToken(config, token) {
  if (typeof token !== 'string' || token === '') return null;

  let metadata;
  try {
    const configuration = await loadConfiguration(config);
    metadata = configuration.serverMetadata();
  } catch {
    throw new LogoutTokenUnavailable('The issuer could not be discovered.');
  }

  let payload;
  try {
    ({ payload } = await jose.jwtVerify(token, keyResolver(metadata.jwks_uri), {
      issuer: metadata.issuer,
      audience: config.clientId,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      maxTokenAge: MAX_TOKEN_AGE,
      algorithms: ASYMMETRIC_ALGORITHMS,
      requiredClaims: ['iat', 'exp', 'jti'],
    }));
  } catch (err) {
    if (err instanceof LogoutTokenUnavailable) throw err;
    if (err instanceof UnknownKeyId) return null;
    if (TOKEN_REFUSALS.some(refusal => err instanceof refusal)) return null;
    throw new LogoutTokenUnavailable('The token could not be checked against the issuer\'s keys.');
  }

  const events = payload.events;
  if (typeof events !== 'object' || events === null || Array.isArray(events) || !(LOGOUT_EVENT in events)) return null;
  // A logout token carries no nonce: a token that does is an ID token, and must not end a session.
  if (payload.nonce !== undefined) return null;

  const sid = typeof payload.sid === 'string' && payload.sid !== '' ? payload.sid : null;
  const subPresent = payload.sub !== undefined;
  const sub = typeof payload.sub === 'string' && SUBJECT_RE.test(payload.sub) ? payload.sub : null;
  if (subPresent && sub === null) return null;
  if (sid === null && sub === null) return null;

  if (typeof payload.jti !== 'string' || payload.jti === '') return null;
  if (isJtiSeen(payload.jti)) return null;

  return { iss: payload.iss, sid, sub, jti: payload.jti, iat: payload.iat };
}

/**
 * Ends the oidc sessions a verified logout token names, in one transaction, and returns the
 * digests (sessions.id) of the rows it deleted, so the caller can close their sockets.
 *
 * A token with a sid ends the oidc sessions that carry that sid at this issuer. A token with only a sub
 * ends every oidc session of that (issuer, subject) identity. Both shapes are bounded by
 * signed_in_at (created_at for a row without one) <= iat + 60 s: a session the person signed in to
 * after this logout was issued is never ended by a replay, and a rotated session still is.
 * @param {{ iss: string, sid: string | null, sub: string | null, iat: number }} claims
 * @returns {Promise<string[]>}
 */
export function revokeForLogoutToken(claims) {
  const signedBy = claims.iat + CREATED_AT_SLACK_SECONDS;
  return withTransaction(async (query) => {
    // signed_in_at, not created_at: a password or email change re-mints the session (created_at = the
    // change), and the bound must still see the sign-in the logout ended (W6-CDX-6 review).
    let rows;
    if (claims.sid !== null) {
      rows = await query(
        `SELECT s.id FROM sessions s
           JOIN user_identities ui ON ui.id = s.identity_id
          WHERE s.auth_provider = 'oidc' AND s.provider_sid = ? AND ui.issuer = ?
            AND UNIX_TIMESTAMP(COALESCE(s.signed_in_at, s.created_at)) <= ?`,
        [claims.sid, claims.iss, signedBy]
      );
    } else {
      rows = await query(
        `SELECT s.id FROM sessions s
           JOIN user_identities ui ON ui.id = s.identity_id
          WHERE s.auth_provider = 'oidc' AND ui.issuer = ? AND ui.subject = ?
            AND UNIX_TIMESTAMP(COALESCE(s.signed_in_at, s.created_at)) <= ?`,
        [claims.iss, claims.sub, signedBy]
      );
    }
    const ids = rows.map(row => row.id);
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(', ');
    await query(
      `DELETE FROM sessions WHERE auth_provider = 'oidc' AND id IN (${placeholders})`,
      ids
    );
    return ids;
  });
}
