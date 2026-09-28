/**
 * Tests for the webhook SSRF guard: which receiver addresses a subscription may name
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi } from 'vitest';
import { checkWebhookTarget, pinnedLookup, embeddedIPv4 } from '../../services/webhook-target.js';

/** A resolver that answers every name with `addresses` and records what it was asked. */
function resolver(...addresses) {
  return vi.fn(async () => addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })));
}

const PUBLIC = '93.184.215.14';
const PUBLIC_V6 = '2606:2800:21f:cb07:6820:80da:af6b:8b2c';

describe('checkWebhookTarget', () => {
  // [description, url, resolved addresses, options, expected ok]
  const cases = [
    ['https to a public address', 'https://receiver.example/hook', [PUBLIC], {}, true],
    ['https to a public IPv6 address', 'https://receiver.example/hook', [PUBLIC_V6], {}, true],
    ['http outside production', 'http://receiver.example/hook', [PUBLIC], {}, true],
    ['http in production', 'http://receiver.example/hook', [PUBLIC], { production: true }, false],
    ['https in production', 'https://receiver.example/hook', [PUBLIC], { production: true }, true],
    ['another scheme', 'ftp://receiver.example/hook', [PUBLIC], {}, false],
    ['a user name in the URL', 'https://user@receiver.example/hook', [PUBLIC], {}, false],
    ['a user name and password in the URL', 'https://user:pw@receiver.example/hook', [PUBLIC], {}, false],
    ['not a URL', 'receiver.example/hook', [PUBLIC], {}, false],
    ['loopback', 'https://receiver.example/hook', ['127.0.0.1'], {}, false],
    ['loopback, allowed', 'https://receiver.example/hook', ['127.0.0.1'], { allowPrivate: true }, true],
    ['IPv6 loopback', 'https://receiver.example/hook', ['::1'], {}, false],
    ['10/8', 'https://receiver.example/hook', ['10.0.0.5'], {}, false],
    ['10/8, allowed', 'https://receiver.example/hook', ['10.0.0.5'], { allowPrivate: true }, true],
    ['172.16/12', 'https://receiver.example/hook', ['172.31.255.1'], {}, false],
    ['just outside 172.16/12', 'https://receiver.example/hook', ['172.32.0.1'], {}, true],
    ['192.168/16', 'https://receiver.example/hook', ['192.168.1.20'], {}, false],
    ['carrier-grade NAT', 'https://receiver.example/hook', ['100.64.0.1'], {}, false],
    ['IPv6 unique-local', 'https://receiver.example/hook', ['fd12:3456::1'], {}, false],
    ['cloud metadata', 'https://receiver.example/hook', ['169.254.169.254'], {}, false],
    ['cloud metadata, even with private allowed', 'https://receiver.example/hook', ['169.254.169.254'], { allowPrivate: true }, false],
    ['IPv6 link-local, even with private allowed', 'https://receiver.example/hook', ['fe80::1'], { allowPrivate: true }, false],
    ['the unspecified address, even with private allowed', 'https://receiver.example/hook', ['0.0.0.0'], { allowPrivate: true }, false],
    ['0/8, even with private allowed', 'https://receiver.example/hook', ['0.1.2.3'], { allowPrivate: true }, false],
    ['the IPv6 unspecified address, even with private allowed', 'https://receiver.example/hook', ['::'], { allowPrivate: true }, false],
    ['IPv4-mapped loopback, dotted', 'https://receiver.example/hook', ['::ffff:127.0.0.1'], {}, false],
    ['IPv4-mapped loopback, hex', 'https://receiver.example/hook', ['::ffff:7f00:1'], {}, false],
    ['IPv4-mapped metadata, even with private allowed', 'https://receiver.example/hook', ['::ffff:a9fe:a9fe'], { allowPrivate: true }, false],
    ['IPv4-mapped public', 'https://receiver.example/hook', [`::ffff:${PUBLIC}`], {}, true],
    ['NAT64 of a private address', 'https://receiver.example/hook', ['64:ff9b::a00:5'], {}, false],
    ['IPv4-compatible loopback', 'https://receiver.example/hook', ['::127.0.0.1'], {}, false],
    // IPv6 transition forms that reach an IPv4 host through a relay or a
    // local translator: 6to4 (here the metadata address), Teredo, and the
    // local-use NAT64 prefix. None is a real receiver, so all are refused.
    ['6to4 of the metadata address, even with private allowed', 'https://receiver.example/hook', ['2002:a9fe:a9fe::1'], { allowPrivate: true }, false],
    ['6to4 of a public address', 'https://receiver.example/hook', ['2002:5db8:d70e::1'], {}, false],
    ['Teredo, even with private allowed', 'https://receiver.example/hook', ['2001:0:4136:e378:8000:63bf:3fff:fdd2'], { allowPrivate: true }, false],
    ['local-use NAT64, even with private allowed', 'https://receiver.example/hook', ['64:ff9b:1::a9fe:a9fe'], { allowPrivate: true }, false],
    ['just outside Teredo', 'https://receiver.example/hook', ['2001:1::1'], {}, true],
    ['one public and one private address', 'https://receiver.example/hook', [PUBLIC, '10.0.0.5'], {}, false],
    ['one private and one public address', 'https://receiver.example/hook', ['10.0.0.5', PUBLIC], {}, false],
    ['a public and a metadata address, private allowed', 'https://receiver.example/hook', [PUBLIC, '169.254.169.254'], { allowPrivate: true }, false],
  ];

  it.each(cases)('%s', async (_name, url, addresses, options, ok) => {
    const result = await checkWebhookTarget(url, { resolve: resolver(...addresses), ...options });
    expect(result.ok).toBe(ok);
    if (ok) {
      expect(result.addresses.map((a) => a.address)).toEqual(addresses);
    } else {
      expect(result.reason).toMatch(/^The webhook URL /);
      expect(result.reason.length).toBeLessThanOrEqual(255);
    }
  });

  it('checks an IP literal without asking DNS, and refuses a private one', async () => {
    const resolve = resolver(PUBLIC);
    expect((await checkWebhookTarget('https://10.1.2.3/hook', { resolve })).ok).toBe(false);
    expect((await checkWebhookTarget('https://[::1]:8443/hook', { resolve })).ok).toBe(false);
    expect((await checkWebhookTarget('https://[::ffff:127.0.0.1]/hook', { resolve })).ok).toBe(false);
    const literal = await checkWebhookTarget(`https://${PUBLIC}:8443/hook`, { resolve });
    expect(literal).toEqual({ ok: true, url: `https://${PUBLIC}:8443/hook`, addresses: [{ address: PUBLIC, family: 4 }] });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('asks the resolver for every address, and returns the normalised URL', async () => {
    const resolve = resolver(PUBLIC, PUBLIC_V6);
    const result = await checkWebhookTarget('  https://Receiver.Example/hook?instance=abc  ', { resolve });
    expect(resolve).toHaveBeenCalledWith('receiver.example', { all: true, verbatim: true });
    expect(result).toEqual({
      ok: true,
      url: 'https://receiver.example/hook?instance=abc',
      addresses: [{ address: PUBLIC, family: 4 }, { address: PUBLIC_V6, family: 6 }],
    });
  });

  it('names the refused address and the setting that would allow a private one', async () => {
    const privateOne = await checkWebhookTarget('https://receiver.example/', { resolve: resolver('10.0.0.5') });
    expect(privateOne.reason).toContain('10.0.0.5');
    expect(privateOne.reason).toContain('WEBHOOK_ALLOW_PRIVATE_TARGETS');
    const metadata = await checkWebhookTarget('https://receiver.example/', { resolve: resolver('169.254.169.254'), allowPrivate: true });
    expect(metadata.reason).toContain('169.254.169.254');
    expect(metadata.reason).not.toContain('WEBHOOK_ALLOW_PRIVATE_TARGETS');
  });

  it('refuses a name that resolves to nothing, and marks a lookup failure as transient', async () => {
    const empty = await checkWebhookTarget('https://receiver.example/', { resolve: vi.fn(async () => []) });
    expect(empty).toMatchObject({ ok: false, transient: true });
    const failed = await checkWebhookTarget('https://receiver.example/', {
      resolve: vi.fn(async () => { throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }); }),
    });
    expect(failed).toMatchObject({ ok: false, transient: true });
    expect(failed.reason).toMatch(/could not be resolved/);
    // A policy refusal is not transient: it will not change on a retry.
    const policy = await checkWebhookTarget('https://receiver.example/', { resolve: resolver('10.0.0.5') });
    expect(policy.transient).toBeUndefined();
  });

  it('refuses a URL longer than 2048 characters', async () => {
    const result = await checkWebhookTarget(`https://receiver.example/${'a'.repeat(2048)}`, { resolve: resolver(PUBLIC) });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/2048/);
  });

  it('refuses a URL whose normalised form is longer than 2048 characters, before anything stores it', async () => {
    // 1,020 characters as typed, but each é becomes six (%C3%A9) in the href
    // the subscription stores, which would not fit the column.
    const raw = `https://receiver.example/${'\u00e9'.repeat(1000)}`;
    expect(raw.length).toBeLessThanOrEqual(2048);
    const result = await checkWebhookTarget(raw, { resolve: resolver(PUBLIC) });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/2048/);
  });

  it('refuses a value that is not a string', async () => {
    expect((await checkWebhookTarget(undefined, { resolve: resolver(PUBLIC) })).ok).toBe(false);
    expect((await checkWebhookTarget(42, { resolve: resolver(PUBLIC) })).ok).toBe(false);
  });
});

describe('embeddedIPv4', () => {
  it.each([
    ['::ffff:127.0.0.1', '127.0.0.1'],
    ['::ffff:7f00:1', '127.0.0.1'],
    ['::FFFF:A9FE:A9FE', '169.254.169.254'],
    ['0:0:0:0:0:ffff:0a00:0005', '10.0.0.5'],
    ['64:ff9b::a00:5', '10.0.0.5'],
    ['::127.0.0.1', '127.0.0.1'],
    ['::1', null],
    ['::', null],
    ['fe80::1', null],
    ['2606:2800:21f:cb07:6820:80da:af6b:8b2c', null],
  ])('%s is %s', (address, expected) => {
    expect(embeddedIPv4(address)).toBe(expected);
  });
});

describe('pinnedLookup', () => {
  const addresses = [{ address: PUBLIC, family: 4 }, { address: PUBLIC_V6, family: 6 }];

  it('answers only with the approved addresses, whatever name it is asked', () => {
    const lookup = pinnedLookup(addresses);
    const one = vi.fn();
    lookup('rebound.example', {}, one);
    expect(one).toHaveBeenCalledWith(null, PUBLIC, 4);

    const all = vi.fn();
    lookup('rebound.example', { all: true }, all);
    expect(all).toHaveBeenCalledWith(null, addresses);
  });

  it('honours a requested family, and fails when none of that family was approved', () => {
    const lookup = pinnedLookup(addresses);
    const six = vi.fn();
    lookup('x', { family: 6 }, six);
    expect(six).toHaveBeenCalledWith(null, PUBLIC_V6, 6);

    const numeric = vi.fn();
    lookup('x', 6, numeric);
    expect(numeric).toHaveBeenCalledWith(null, PUBLIC_V6, 6);

    const none = vi.fn();
    pinnedLookup([{ address: PUBLIC, family: 4 }])('x', { family: 6, all: true }, none);
    expect(none.mock.calls[0][0]).toMatchObject({ code: 'ENOTFOUND' });
  });

  it('accepts the two-argument form', () => {
    const cb = vi.fn();
    pinnedLookup(addresses)('x', cb);
    expect(cb).toHaveBeenCalledWith(null, PUBLIC, 4);
  });
});
