/**
 * Global test setup — mocks for database and email modules.
 *
 * Every test file that imports the app will get these mocks automatically.
 */

import { vi } from 'vitest';

// Mock the database module
vi.mock('../mysql_connect.js', () => ({
  c2_query: vi.fn(async () => []),
  generateSessionToken: vi.fn(async () => 'mock-session-token'),
  validateAndAutoLogin: vi.fn(async () => null),
  touchSession: vi.fn(async () => {}),
}));

// Mock the email service
vi.mock('../services/email.js', () => ({
  sendEmail: vi.fn(async () => ({ messageId: 'mock' })),
  verifyEmailConnection: vi.fn(async () => true),
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
