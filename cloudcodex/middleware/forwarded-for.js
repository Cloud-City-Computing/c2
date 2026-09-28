/**
 * Logs, once per peer address, a request whose X-Forwarded-For the trust proxy setting ignores
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

// A reverse proxy whose address TRUST_PROXY does not name fails quietly: the
// X-Forwarded-For it sets is ignored, every client behind it is counted as
// the proxy, and they all share one rate-limit bucket, while every request
// still succeeds. This turns that into a log line. Each peer is named once,
// and at most UNTRUSTED_FORWARDER_LIMIT peers per process, so a flood of
// requests from changing addresses cannot grow memory or the log.
export const UNTRUSTED_FORWARDER_LIMIT = 32;

/**
 * Middleware that warns when a peer `trust proxy` does not trust sends
 * X-Forwarded-For. `seen` is exposed on the returned function for tests.
 * @param { { limit?: Number, log?: Function } } [options]
 * @returns { Function } Express middleware
 */
export function warnUntrustedForwarders({ limit = UNTRUSTED_FORWARDER_LIMIT, log = console.error } = {}) {
  const seen = new Set();
  const middleware = (req, _res, next) => {
    const peer = req.socket.remoteAddress;
    if (req.headers['x-forwarded-for'] === undefined || !peer || seen.size >= limit || seen.has(peer)
      || req.app.get('trust proxy fn')(peer, 0)) {
      return next();
    }
    seen.add(peer);
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
