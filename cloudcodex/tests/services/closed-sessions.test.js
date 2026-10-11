/**
 * services/closed-sessions.js: the digests a sign-out just closed (W6-CDX-6 review)
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { markSessionsClosed, sessionClosedRecently, resetClosedSessions } from '../../services/closed-sessions.js';

describe('services/closed-sessions', () => {
  beforeEach(() => resetClosedSessions());
  afterEach(() => vi.restoreAllMocks());

  it('remembers a digest a sign-out closed, and no other', () => {
    markSessionsClosed(['d-1']);
    expect(sessionClosedRecently('d-1')).toBe(true);
    expect(sessionClosedRecently('d-2')).toBe(false);
  });

  it('forgets a digest after the five-minute window', () => {
    const start = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(start);
    markSessionsClosed(['d-old']);
    spy.mockReturnValue(start + 5 * 60 * 1000 + 1);
    expect(sessionClosedRecently('d-old')).toBe(false);
  });

  it('bounds the set: the oldest digests go first once it is over capacity', () => {
    const digests = Array.from({ length: 10001 }, (_, i) => `d-${i}`);
    markSessionsClosed(digests);
    expect(sessionClosedRecently('d-0')).toBe(false);
    expect(sessionClosedRecently('d-10000')).toBe(true);
  });

  it('re-marks a digest as the newest, so it is not evicted by an older entry', () => {
    markSessionsClosed(['d-keep']);
    markSessionsClosed(['d-keep']);
    expect(sessionClosedRecently('d-keep')).toBe(true);
  });

  it('answers false for everything after a reset', () => {
    markSessionsClosed(['d-gone']);
    resetClosedSessions();
    expect(sessionClosedRecently('d-gone')).toBe(false);
  });
});
