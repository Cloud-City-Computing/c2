/**
 * Shared test helpers and fixtures.
 */

import { vi } from 'vitest';
import { c2_query, validateAndAutoLogin, generateSessionToken, touchSession } from '../mysql_connect.js';

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
}
