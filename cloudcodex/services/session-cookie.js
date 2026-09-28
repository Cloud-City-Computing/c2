/**
 * The one server-side definition of the session cookie: its names, and which one a request carries
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

/*
 * WHY __Host-. Hosts under one registrable domain can set cookies for each
 * other: script on any sibling can set `sessionToken=<its own>;
 * Domain=<parent>; Path=/api`, a browser sends the longer path first, and a
 * reader taking the first match signs the victim in as the tosser. A browser
 * refuses to store a __Host- cookie that carries a Domain, lacks Secure or has
 * any Path but /, so no other host can plant one here.
 *
 * The client writes the same names (src/util.jsx), and must: the page reads
 * the token to authenticate its WebSockets, so the cookie is not HttpOnly.
 */

export const SESSION_COOKIE = '__Host-sessionToken';
export const LEGACY_SESSION_COOKIE = 'sessionToken';

/** The whitespace a Cookie header puts around a pair: ASCII space and tab, nothing else. */
export const COOKIE_OWS = /^[ \t]+|[ \t]+$/g;

/**
 * The name a cookie with this Secure flag must carry: a browser drops a
 * __Host- cookie that is not Secure, so a plain-http instance keeps the
 * legacy name.
 * @param {{ secure: boolean }} options
 * @returns {string}
 */
export function sessionCookieName({ secure }) {
  return secure ? SESSION_COOKIE : LEGACY_SESSION_COOKIE;
}

/**
 * Whether a lone legacy `sessionToken` cookie still authenticates. On unless
 * LEGACY_SESSION_COOKIE is exactly 0, so a self-hoster's existing sessions
 * survive the upgrade; a hosted instance sets 0. Read by literal name, so the
 * configuration contract's scan sees it.
 * @returns {boolean}
 */
export function legacyCookieAllowed() {
  return process.env.LEGACY_SESSION_COOKIE !== '0';
}

/**
 * The session token in a Cookie header, or null. The prefixed cookie always
 * wins, wherever it sits in the header. The legacy name is read only when no
 * prefixed cookie is present at all (an empty one included) and the fallback
 * is allowed. Names match exactly, after stripping only ASCII space and tab;
 * an empty value is no token.
 * @param {string | undefined} cookieHeader
 * @param {{ allowLegacy: boolean }} options
 * @returns {string | null}
 */
export function readSessionCookie(cookieHeader, { allowLegacy }) {
  if (!cookieHeader) return null;
  // Strip only the ASCII space and tab that separate pairs. trim() would also
  // strip Unicode whitespace, turning a differently named cookie (one a
  // browser stores without the __Host- rules) into the prefixed one.
  const pairs = cookieHeader.split(';').map((pair) => pair.replace(COOKIE_OWS, ''));
  const valueOf = (name) => {
    const hit = pairs.find((pair) => pair.startsWith(`${name}=`));
    return hit === undefined ? undefined : hit.slice(name.length + 1);
  };

  const prefixed = valueOf(SESSION_COOKIE);
  if (prefixed !== undefined) return prefixed || null;
  if (!allowLegacy) return null;
  return valueOf(LEGACY_SESSION_COOKIE) || null;
}
