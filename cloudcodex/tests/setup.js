/**
 * Global test setup — mocks for database and email modules.
 *
 * Every test file that imports the app will get these mocks automatically.
 */

import { vi } from 'vitest';

// Mock the database module. `withTransaction`'s default implementation just
// forwards the caller's callback straight to the shared `c2_query` mock, so
// existing call-ordered `mockResolvedValueOnce` queues keep working for code
// that runs its writes inside a transaction without every test needing to
// know that. Tests that care about transaction semantics (commit/rollback)
// override `withTransaction` directly.
vi.mock('../mysql_connect.js', () => {
  const c2_query = vi.fn(async () => []);
  return {
    c2_query,
    generateSessionToken: vi.fn(async () => 'mock-session-token'),
    validateAndAutoLogin: vi.fn(async () => null),
    touchSession: vi.fn(async () => {}),
    withTransaction: vi.fn(async fn => fn(c2_query)),
  };
});

// Mock the email service
vi.mock('../services/email.js', () => ({
  sendEmail: vi.fn(async () => ({ messageId: 'mock' })),
  verifyEmailConnection: vi.fn(async () => true),
  initMail: vi.fn(async () => ({ enabled: true, reason: null })),
  isMailEnabled: vi.fn(() => true),
  isMailConfigured: vi.fn(() => true),
}));

// Mock sharp for avatar upload tests (avoid real image processing)
vi.mock('sharp', () => {
  const inst = {};
  inst.resize = vi.fn(() => inst);
  inst.webp = vi.fn(() => inst);
  inst.toFile = vi.fn(async () => ({}));
  return { default: vi.fn(() => inst) };
});

// Mock fs/promises for avatar file operations
vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn(async () => {}),
    unlink: vi.fn(async () => {}),
  },
  mkdir: vi.fn(async () => {}),
  unlink: vi.fn(async () => {}),
}));
