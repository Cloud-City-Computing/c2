import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../mysql_connect.js', () => ({
  c2_query: vi.fn(async () => []),
  validateAndAutoLogin: vi.fn(async () => null),
  generateSessionToken: vi.fn(async () => 'tok'),
  touchSession: vi.fn(async () => {}),
}));

import { broadcastToUser, isUserConnected, getConnectedUserCount } from '../../services/user-channel.js';

describe('services/user-channel (broadcast helpers)', () => {
  beforeEach(() => {
    // Force re-import to clear in-memory channel map between tests by
    // using a fresh broadcast — there's no public reset API, but the
    // map is keyed by userId, so untracked users return 0 from the start.
  });

  it('broadcastToUser returns 0 when the user has no open tabs', () => {
    const sent = broadcastToUser(999_999_999, { type: 'notification', notification: { id: 1 } });
    expect(sent).toBe(0);
  });

  it('isUserConnected returns false for an untracked user', () => {
    expect(isUserConnected(999_999_999)).toBe(false);
  });

  it('getConnectedUserCount returns a non-negative integer', () => {
    const n = getConnectedUserCount();
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(0);
  });
});
