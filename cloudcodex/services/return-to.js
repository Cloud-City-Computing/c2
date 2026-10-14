/**
 * The one validator for where a sign-in returns to, read at login and again at the callback
 *
 * A returnTo is an open redirect unless it is provably a same-origin path, so
 * the rule is exact and lives here alone. It answers the value unchanged when
 * it passes, and "/" for everything else; it never rewrites an accepted value.
 * The rules, per part (the path, and the query and fragment, which are used
 * differently):
 *
 * PATH. Printable ASCII only, NO percent sign at all, none of the characters a
 * browser percent-encodes anyway (" < > ` { } | ^), a single leading "/", no
 * "//" and no backslash, no ":" and no "api" as its first segment (the whole
 * segment, any case), and no "." or ".." segment.
 *
 * QUERY and FRAGMENT. Raw text must be printable ASCII and free of the same
 * " < > ` { } | ^, so non-ASCII arrives percent-encoded. Percent escapes are
 * allowed. "//" is allowed here: the query and fragment never change the path a
 * browser resolves. Each decoded layer is checked for C0, DEL and C1 controls, a
 * backslash, and (from the first decode on) a decoded "#" or "?". Layers decode
 * to a fixed point, at most MAX_DECODE_LAYERS deep; a value that needs more is
 * refused.
 *
 * The hostile-input corpus, tests/fixtures/return-to-corpus.json, is Cloud
 * The contract for this function, copied byte for byte from a sibling implementation. Every change here
 * must keep every case in it passing.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

/** The longest raw value the validator will look at, checked before any decoding. */
export const RETURN_TO_MAX_LENGTH = 2048;

const MAX_DECODE_LAYERS = 8;

const PRINTABLE_ASCII = /^[\x21-\x7e]*$/;

/** Printable ASCII that browsers percent-encode anyway, refused raw so a sealed value is never escaped. */
const BROWSER_ENCODED_ASCII = /["<>`{}|^]/;

/** C0, DEL and C1 control characters, checked by code unit. */
function hasControlOrC1(text) {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function isSafePath(path) {
  if (!path.startsWith('/')) return false;
  if (!PRINTABLE_ASCII.test(path) || path.includes('%') || BROWSER_ENCODED_ASCII.test(path)) return false;
  if (path.includes('//') || path.includes('\\')) return false;
  const segments = path.split('/');
  const first = segments[1] ?? '';
  if (first.includes(':') || first.toLowerCase() === 'api') return false;
  if (segments.some(segment => segment === '.' || segment === '..')) return false;
  return true;
}

function isSafeQueryOrFragment(text) {
  let layer = text;
  for (let depth = 0; depth < MAX_DECODE_LAYERS; depth += 1) {
    if (depth === 0 && (!PRINTABLE_ASCII.test(layer) || BROWSER_ENCODED_ASCII.test(layer))) return false;
    if (hasControlOrC1(layer)) return false;
    if (layer.includes('\\')) return false;
    if (depth > 0 && (layer.includes('#') || layer.includes('?'))) return false;
    if (!layer.includes('%')) return true;
    let next;
    try {
      next = decodeURIComponent(layer);
    } catch {
      return false;
    }
    layer = next;
  }
  // Still percent-encoded after the bound: refuse rather than guess.
  return false;
}

/**
 * The value itself when it is a same-origin path (with an optional query and
 * fragment) that passes every rule above; "/" otherwise.
 * @param {unknown} value - Express hands a repeated query key over as an array, so anything goes in
 * @returns {string}
 */
export function safeReturnTo(value) {
  if (typeof value !== 'string') return '/';
  if (value.length === 0 || value.length > RETURN_TO_MAX_LENGTH) return '/';

  const hashAt = value.indexOf('#');
  const beforeHash = hashAt === -1 ? value : value.slice(0, hashAt);
  const fragment = hashAt === -1 ? null : value.slice(hashAt + 1);

  const queryAt = beforeHash.indexOf('?');
  const path = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
  const query = queryAt === -1 ? null : beforeHash.slice(queryAt + 1);

  if (!isSafePath(path)) return '/';
  if (query !== null && !isSafeQueryOrFragment(query)) return '/';
  if (fragment !== null && !isSafeQueryOrFragment(fragment)) return '/';
  return value;
}
