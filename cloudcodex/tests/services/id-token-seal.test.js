/**
 * services/id-token-seal.js: the sealed ID token a sign-out needs (W6-CDX-6)
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { sealIdToken, openIdToken } from '../../services/id-token-seal.js';

const SECRET = 'a-client-secret-for-the-seal-tests';
const TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ6aXRhZG8tdXNlci0xIn0.c2lnbmF0dXJl';

describe('sealIdToken / openIdToken', () => {
  it('round-trips the token under the same client secret', () => {
    expect(openIdToken(sealIdToken(TOKEN, SECRET), SECRET)).toBe(TOKEN);
  });

  it('never stores the token in the clear', () => {
    const sealed = sealIdToken(TOKEN, SECRET);
    expect(sealed).not.toContain(TOKEN);
    expect(sealed).not.toContain('eyJzdWIi');
  });

  it('seals the same token differently each time (a fresh iv)', () => {
    expect(sealIdToken(TOKEN, SECRET)).not.toBe(sealIdToken(TOKEN, SECRET));
  });

  it('answers null, and does not throw, under a different secret', () => {
    expect(openIdToken(sealIdToken(TOKEN, SECRET), 'another-secret')).toBeNull();
  });

  it('answers null for a tampered value', () => {
    const sealed = sealIdToken(TOKEN, SECRET);
    const [iv, tag, ct] = sealed.split(':');
    const flipped = ct.slice(0, -2) + (ct.slice(-2) === '00' ? '11' : '00');
    expect(openIdToken(`${iv}:${tag}:${flipped}`, SECRET)).toBeNull();
  });

  it.each([
    [null],
    [undefined],
    [''],
    ['not-a-sealed-value'],
    ['zz:zz:zz'],
    ['00:00:00'],
  ])('answers null for a value that is not a sealed token (%j)', (value) => {
    expect(openIdToken(value, SECRET)).toBeNull();
  });
});
