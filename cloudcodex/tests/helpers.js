/**
 * Shared test helpers and fixtures.
 */

import { vi } from 'vitest';
import { c2_query, validateAndAutoLogin, generateSessionToken, touchSession, withTransaction } from '../mysql_connect.js';

/** A standard authenticated test user. */
export const TEST_USER = { id: 1, name: 'testuser', email: 'test@example.com' };

/** A second user for multi-user scenarios. */
export const TEST_USER_2 = { id: 2, name: 'otheruser', email: 'other@example.com' };

/**
 * Configure mocks so that requireAuth middleware passes.
 * Call this in a beforeEach block for authenticated route tests.
 */
export function mockAuthenticated(user = TEST_USER) {
  validateAndAutoLogin.mockResolvedValue(user);
  touchSession.mockResolvedValue(undefined);
}

/**
 * Configure mocks so that requireAuth middleware rejects (no valid session).
 */
export function mockUnauthenticated() {
  validateAndAutoLogin.mockResolvedValue(null);
}

/**
 * Reset all database and email mocks between tests.
 */
export function resetMocks() {
  vi.resetAllMocks();
  // Restore default mock implementations
  c2_query.mockResolvedValue([]);
  generateSessionToken.mockResolvedValue('mock-session-token');
  validateAndAutoLogin.mockResolvedValue(null);
  touchSession.mockResolvedValue(undefined);
  // Default: forward straight to c2_query so existing call-ordered
  // mockResolvedValueOnce queues work unchanged for transactional code.
  withTransaction.mockImplementation(async fn => fn(c2_query));
}
