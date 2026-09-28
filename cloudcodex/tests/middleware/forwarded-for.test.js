/**
 * Tests for middleware/forwarded-for.js, the once-per-peer warning about an ignored X-Forwarded-For
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import { warnUntrustedForwarders, UNTRUSTED_FORWARDER_LIMIT } from '../../middleware/forwarded-for.js';
import { contractDefault } from '../contract-default.js';

// The trust function the app compiles from the default, so "trusted" here
// means what it means in production.
const app = express().set('trust proxy', contractDefault('TRUST_PROXY'));

function requestFrom(peer, { forwardedFor = '198.51.100.7' } = {}) {
  return {
    app,
    headers: forwardedFor === null ? {} : { 'x-forwarded-for': forwardedFor },
    socket: { remoteAddress: peer },
  };
}

function run(middleware, req) {
  const next = vi.fn();
  middleware(req, {}, next);
  expect(next).toHaveBeenCalledOnce();
}

describe('warnUntrustedForwarders', () => {
  it('warns when an untrusted peer sends X-Forwarded-For, naming the peer and TRUST_PROXY', () => {
    const log = vi.fn();
    run(warnUntrustedForwarders({ log }), requestFrom('172.18.0.1'));
    expect(log).toHaveBeenCalledOnce();
    const [line] = log.mock.calls[0];
    expect(line).toContain('172.18.0.1');
    expect(line).toContain('TRUST_PROXY');
    expect(line).toMatch(/one rate-limit bucket/);
  });

  it('warns once per peer, however many requests it sends', () => {
    const log = vi.fn();
    const middleware = warnUntrustedForwarders({ log });
    for (let i = 0; i < 5; i += 1) run(middleware, requestFrom('172.18.0.1', { forwardedFor: `198.51.100.${i}` }));
    expect(log).toHaveBeenCalledOnce();
    run(middleware, requestFrom('172.18.0.2'));
    expect(log).toHaveBeenCalledTimes(2);
  });

  it.each(['127.0.0.1', '::ffff:127.0.0.1', '172.29.0.1', '::1'])(
    'stays quiet for a trusted peer (%s), and does not remember it',
    (peer) => {
      const log = vi.fn();
      const middleware = warnUntrustedForwarders({ log });
      run(middleware, requestFrom(peer));
      expect(log).not.toHaveBeenCalled();
      expect(middleware.seen.size).toBe(0);
    },
  );

  // One IPv6 host holds a whole /64, so keying the set by address would let a
  // single client fill it and silence the warning for everyone after.
  it('counts an IPv6 /64 once, naming the address that arrived first', () => {
    const log = vi.fn();
    const middleware = warnUntrustedForwarders({ log });
    for (const peer of ['2001:db8:1:2::1', '2001:db8:1:2::ffff', '2001:db8:1:2:abcd:ef01:2345:6789', '2001:DB8:1:2::7']) {
      run(middleware, requestFrom(peer));
    }
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).toContain('2001:db8:1:2::1');
    expect(middleware.seen.size).toBe(1);
    run(middleware, requestFrom('2001:db8:1:3::1'));
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('cannot be filled from one /64', () => {
    const log = vi.fn();
    const middleware = warnUntrustedForwarders({ log, limit: 3 });
    for (let i = 1; i <= 100; i += 1) run(middleware, requestFrom(`2001:db8:9:9::${i.toString(16)}`));
    expect(middleware.seen.size).toBe(1);
    expect(log).toHaveBeenCalledOnce();
    run(middleware, requestFrom('203.0.113.50'));
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('keys an IPv4 peer, mapped or not, by its whole address', () => {
    const log = vi.fn();
    const middleware = warnUntrustedForwarders({ log });
    for (const peer of ['::ffff:203.0.113.1', '::ffff:203.0.113.2', '203.0.113.3']) run(middleware, requestFrom(peer));
    expect(log).toHaveBeenCalledTimes(3);
  });

  it('stays quiet for an untrusted peer that sends no X-Forwarded-For', () => {
    const log = vi.fn();
    const middleware = warnUntrustedForwarders({ log });
    run(middleware, requestFrom('203.0.113.9', { forwardedFor: null }));
    expect(log).not.toHaveBeenCalled();
    expect(middleware.seen.size).toBe(0);
  });

  it('stays quiet when the connection has no address left to report', () => {
    const log = vi.fn();
    const middleware = warnUntrustedForwarders({ log });
    run(middleware, requestFrom(undefined));
    expect(log).not.toHaveBeenCalled();
  });

  // A flood from changing addresses must not grow memory or the log: past the
  // limit it says so once and then remembers and logs nothing more.
  it('is bounded: at most `limit` peers are remembered and logged, then one closing line', () => {
    const log = vi.fn();
    const middleware = warnUntrustedForwarders({ log, limit: 3 });
    for (let i = 1; i <= 50; i += 1) run(middleware, requestFrom(`203.0.113.${i}`));
    expect(middleware.seen.size).toBe(3);
    expect(log).toHaveBeenCalledTimes(4);
    expect(log.mock.calls[3][0]).toMatch(/3 untrusted addresses/);
    expect(log.mock.calls[3][0]).toMatch(/no more are logged/);
  });

  it('defaults to a small limit and to console.error', () => {
    expect(UNTRUSTED_FORWARDER_LIMIT).toBeGreaterThan(0);
    expect(UNTRUSTED_FORWARDER_LIMIT).toBeLessThanOrEqual(100);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const middleware = warnUntrustedForwarders();
      for (let i = 1; i <= UNTRUSTED_FORWARDER_LIMIT + 10; i += 1) run(middleware, requestFrom(`198.51.100.${i}`));
      expect(middleware.seen.size).toBe(UNTRUSTED_FORWARDER_LIMIT);
      expect(errorSpy).toHaveBeenCalledTimes(UNTRUSTED_FORWARDER_LIMIT + 1);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
