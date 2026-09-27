/**
 * Tests for services/session-token.js, the one definition of how a session token is stored
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { hashSessionToken } from '../../services/session-token.js';

describe('hashSessionToken', () => {
  it('is SHA-256, lowercase hex (the FIPS 180-2 "abc" vector)', () => {
    expect(hashSessionToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('is 64 lowercase hex characters, so sessions.id stays CHAR(64)', () => {
    const token = 'Ab3'.repeat(21) + 'Z';
    expect(token).toHaveLength(64);
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never returns the token itself', () => {
    const token = 'x'.repeat(64);
    expect(hashSessionToken(token)).not.toBe(token);
  });

  it('gives different digests for different tokens, and the same digest for the same one', () => {
    expect(hashSessionToken('token-a')).not.toBe(hashSessionToken('token-b'));
    // Case matters: a raw token is mixed-case, so two tokens differing only in
    // case are two sessions.
    expect(hashSessionToken('Token')).not.toBe(hashSessionToken('token'));
    expect(hashSessionToken('token-a')).toBe(hashSessionToken('token-a'));
  });
});
