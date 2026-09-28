/**
 * Logs, once per peer address, a request whose X-Forwarded-For the trust proxy setting ignores
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { isIPv6 } from 'net';

// A reverse proxy whose address TRUST_PROXY does not name fails quietly: the
// X-Forwarded-For it sets is ignored, every client behind it is counted as
// the proxy, and they all share one rate-limit bucket, while every request
// still succeeds. This turns that into a log line. Each peer is named once,
// and at most UNTRUSTED_FORWARDER_LIMIT peers per process, so a flood of
// requests from changing addresses cannot grow memory or the log.
export const UNTRUSTED_FORWARDER_LIMIT = 32;

/**
 * The eight 16-bit groups of an IPv6 address, as lower-case hex. The WHATWG
 * URL parser validates and normalises it (hex groups only, an embedded dotted
 * quad folded in), so only `::` is left to expand. A zone (`%eth0`) names an
 * interface, not addresses, and the URL parser refuses one, so it is dropped.
 * @param { String } address
 * @returns { String[] }
 */
export function ipv6Groups(address) {
  const host = new URL(`http://[${address.replace(/%.*$/, '')}]/`).hostname.slice(1, -1);
  const [head, tail] = host.split('::');
  const groups = (part) => (part ? part.split(':') : []);
  return tail === undefined
    ? groups(head)
    : [...groups(head), ...Array(8 - groups(head).length - groups(tail).length).fill('0'), ...groups(tail)];
}

// What one entry in the set stands for: an IPv4 peer, plain or IPv4-mapped,
// by its address; an IPv6 peer by its /64, since one host holds a whole /64
// and could otherwise fill the set, and silence the warning, on its own.
function peerKey(peer) {
  if (!isIPv6(peer)) return peer;
  const groups = ipv6Groups(peer);
  const mapped = groups.slice(0, 5).every((g) => g === '0') && groups[5] === 'ffff';
  return mapped ? peer : `${groups.slice(0, 4).join(':')}::/64`;
}

/**
 * Middleware that warns when a peer `trust proxy` does not trust sends
 * X-Forwarded-For. `seen` (the peer keys, IPv6 by /64) is exposed on the
 * returned function for tests.
 * @param { { limit?: Number, log?: Function } } [options]
 * @returns { Function } Express middleware
 */
export function warnUntrustedForwarders({ limit = UNTRUSTED_FORWARDER_LIMIT, log = console.error } = {}) {
  const seen = new Set();
  const middleware = (req, _res, next) => {
    const peer = req.socket.remoteAddress;
    if (req.headers['x-forwarded-for'] === undefined || !peer || seen.size >= limit) return next();
    const key = peerKey(peer);
    if (seen.has(key) || req.app.get('trust proxy fn')(peer, 0)) return next();
    seen.add(key);
    log(`[${new Date().toISOString()}] ⚠ ${peer} sent X-Forwarded-For, but TRUST_PROXY does not name `
      + `${peer} as a proxy, so the header is ignored and its requests are counted as ${peer}. If ${peer} `
      + 'is your reverse proxy, every client behind it now shares one rate-limit bucket: add its address '
      + 'to TRUST_PROXY (see "Rate limiters" in docs/deployment.md).');
    if (seen.size >= limit) {
      log(`[${new Date().toISOString()}] ⚠ ${limit} untrusted addresses have sent X-Forwarded-For; `
        + 'no more are logged until the server restarts.');
    }
    return next();
  };
  middleware.seen = seen;
  return middleware;
}
