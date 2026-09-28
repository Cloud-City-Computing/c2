/**
 * The webhook SSRF guard: which receiver addresses a subscription may name
 *
 * A webhook makes this server send a request to an address an administrator
 * or the operator chose, so the address is checked before it is stored and
 * again when a delivery is sent (the delivery worker, W6-CDX-14, connects
 * through pinnedLookup so DNS cannot answer differently between the check and
 * the connect). Link-local, unspecified and reserved addresses, where cloud
 * metadata services live, are refused always. Loopback and private ranges are
 * refused unless the instance sets WEBHOOK_ALLOW_PRIVATE_TARGETS=1, for a
 * receiver on the same host or network.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { BlockList, isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

/** The longest receiver URL a subscription stores (webhook_subscriptions.url). */
export const MAX_WEBHOOK_URL_LENGTH = 2048;

// Refused whatever WEBHOOK_ALLOW_PRIVATE_TARGETS says: cloud metadata lives in
// link-local space, and "this network" and the reserved ranges are never a
// real receiver.
const ALWAYS = new BlockList();
ALWAYS.addSubnet('0.0.0.0', 8, 'ipv4');
ALWAYS.addSubnet('169.254.0.0', 16, 'ipv4');
ALWAYS.addSubnet('224.0.0.0', 4, 'ipv4');
ALWAYS.addSubnet('240.0.0.0', 4, 'ipv4');
ALWAYS.addAddress('::', 'ipv6');
ALWAYS.addSubnet('fe80::', 10, 'ipv6');
ALWAYS.addSubnet('ff00::', 8, 'ipv6');

// Refused unless the operator opts in (a receiver on the same box or network).
const PRIVATE = new BlockList();
PRIVATE.addSubnet('127.0.0.0', 8, 'ipv4');
PRIVATE.addSubnet('10.0.0.0', 8, 'ipv4');
PRIVATE.addSubnet('172.16.0.0', 12, 'ipv4');
PRIVATE.addSubnet('192.168.0.0', 16, 'ipv4');
PRIVATE.addSubnet('100.64.0.0', 10, 'ipv4');
PRIVATE.addSubnet('198.18.0.0', 15, 'ipv4');
PRIVATE.addAddress('::1', 'ipv6');
PRIVATE.addSubnet('fc00::', 7, 'ipv6');
PRIVATE.addSubnet('fec0::', 10, 'ipv6');

/**
 * The eight 16-bit groups of an IPv6 address, or null when it is not one.
 * Accepts `::` shorthand and a trailing dotted quad.
 * @param { String } address
 * @returns { number[] | null }
 */
function ipv6Groups(address) {
  let text = address.toLowerCase().replace(/%.*$/, '');
  const dotted = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (dotted) {
    if (isIP(dotted[2]) !== 4) return null;
    const [a, b, c, d] = dotted[2].split('.').map(Number);
    text = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = [...head, ...Array(Math.max(fill, 0)).fill('0'), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

/**
 * The IPv4 address an IPv6 address carries, when it is one of the forms that
 * reach an IPv4 host: IPv4-mapped (::ffff:a.b.c.d, either spelling), the NAT64
 * well-known prefix (64:ff9b::/96) and IPv4-compatible (::a.b.c.d). Null for
 * any other address, including :: and ::1.
 * @param { String } address
 * @returns { String | null }
 */
export function embeddedIPv4(address) {
  if (isIP(address) !== 6) return null;
  const g = ipv6Groups(address);
  if (!g) return null;
  const zeroUpTo = (n) => g.slice(0, n).every((x) => x === 0);
  const mapped = zeroUpTo(5) && g[5] === 0xffff;
  const nat64 = g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0);
  const compatible = zeroUpTo(6) && (g[6] !== 0 || g[7] > 1);
  if (!mapped && !nat64 && !compatible) return null;
  return `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`;
}

/**
 * Why `address` may not be a receiver: 'always', 'private', or null when it
 * may. An IPv6 address that carries an IPv4 one is checked in both forms.
 * @param { String } address
 * @param { Boolean } allowPrivate
 */
function refusalFor(address, allowPrivate) {
  const family = isIP(address);
  if (family === 0) return 'always';
  const forms = [[address, family === 6 ? 'ipv6' : 'ipv4']];
  const v4 = embeddedIPv4(address);
  if (v4) forms.push([v4, 'ipv4']);
  if (forms.some(([a, type]) => ALWAYS.check(a, type))) return 'always';
  if (!allowPrivate && forms.some(([a, type]) => PRIVATE.check(a, type))) return 'private';
  return null;
}

const refuse = (reason, extra = {}) => ({ ok: false, reason, ...extra });

/**
 * Check a receiver URL, resolving its host and checking every address it
 * resolves to, not only the first.
 *
 * Returns `{ ok: true, url, addresses }` (the normalised URL, and the
 * addresses to connect to, for pinnedLookup) or `{ ok: false, reason }` with a
 * sentence for a person. A host that does not resolve is also marked
 * `transient: true`, since it may resolve later where a policy refusal never
 * will.
 *
 * @param { unknown } raw - the URL as supplied
 * @param { { allowPrivate?: Boolean, production?: Boolean, resolve?: Function } } [options]
 *   production refuses plain http; resolve is dns.promises.lookup's shape,
 *   injectable so tests never touch DNS
 * @returns { Promise<{ ok: true, url: String, addresses: Array<{ address: String, family: Number }> } |
 *   { ok: false, reason: String, transient?: true }> }
 */
export async function checkWebhookTarget(raw, { allowPrivate = false, production = false, resolve = lookup } = {}) {
  if (typeof raw !== 'string' || raw.trim() === '') return refuse('The webhook URL is required.');
  const text = raw.trim();
  if (text.length > MAX_WEBHOOK_URL_LENGTH) {
    return refuse(`The webhook URL is longer than ${MAX_WEBHOOK_URL_LENGTH} characters.`);
  }

  let url;
  try {
    url = new URL(text);
  } catch {
    return refuse('The webhook URL is not a valid URL.');
  }
  if (url.protocol === 'http:') {
    if (production) return refuse('The webhook URL must use https in production.');
  } else if (url.protocol !== 'https:') {
    return refuse(production ? 'The webhook URL must use https.' : 'The webhook URL must use https or http.');
  }
  if (url.username || url.password) return refuse('The webhook URL must not carry a user name or password.');

  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
  let resolved;
  if (isIP(host)) {
    resolved = [{ address: host }];
  } else {
    try {
      resolved = await resolve(host, { all: true, verbatim: true });
    } catch {
      resolved = [];
    }
    if (!Array.isArray(resolved) || resolved.length === 0) {
      return refuse('The webhook URL names a host that could not be resolved.', { transient: true });
    }
  }

  const addresses = resolved.map(({ address }) => ({ address, family: isIP(address) }));
  for (const { address } of addresses) {
    const refusal = refusalFor(address, allowPrivate);
    if (refusal === 'always') {
      return refuse(
        `The webhook URL resolves to ${address}, a link-local, unspecified or reserved address, which is never allowed.`
      );
    }
    if (refusal === 'private') {
      return refuse(
        `The webhook URL resolves to ${address}, a loopback or private address. ` +
        'Set WEBHOOK_ALLOW_PRIVATE_TARGETS=1 on this instance to allow private receivers.'
      );
    }
  }
  return { ok: true, url: url.href, addresses };
}

/**
 * A `lookup` for http.request / https.request that answers only with the
 * addresses checkWebhookTarget approved, whatever name it is asked about, so
 * DNS cannot be rebound between the check and the connect.
 * @param { Array<{ address: String, family: Number }> } addresses
 * @returns { Function } dns.lookup's callback shape
 */
export function pinnedLookup(addresses) {
  return (hostname, options, callback) => {
    let opts = options;
    let done = callback;
    if (typeof opts === 'function') {
      done = opts;
      opts = {};
    }
    if (typeof opts === 'number') opts = { family: opts };
    const wanted = opts?.family === 'IPv4' ? 4 : opts?.family === 'IPv6' ? 6 : Number(opts?.family) || 0;
    const usable = wanted ? addresses.filter((a) => a.family === wanted) : addresses;
    if (usable.length === 0) {
      const err = new Error(`no approved address for ${hostname}`);
      err.code = 'ENOTFOUND';
      done(err);
      return;
    }
    if (opts?.all) {
      done(null, usable.map(({ address, family }) => ({ address, family })));
    } else {
      done(null, usable[0].address, usable[0].family);
    }
  };
}
