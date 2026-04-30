/**
 * Cloud Codex — Tests for server.js startup checks
 *
 * server.js has top-level side effects (env validation, ViteExpress.listen,
 * setInterval / setTimeout for the activity-log prune). We isolate the
 * env-validation logic by re-importing under controlled process.env state
 * with all I/O-ish modules mocked.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const listenMock = vi.fn(() => ({}));
vi.mock('vite-express', () => ({ default: { listen: listenMock } }));
vi.mock('../services/collab.js', () => ({ setupCollabServer: vi.fn() }));
vi.mock('../services/user-channel.js', () => ({ setupUserChannelServer: vi.fn() }));
vi.mock('../routes/admin.js', () => ({ default: {}, ensureAdminUser: vi.fn() }));
vi.mock('../app.js', () => ({ default: {} }));

let exitSpy;
let errorSpy;

beforeEach(() => {
  vi.resetModules();
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  listenMock.mockClear();
});

afterEach(() => {
  exitSpy.mockRestore();
  errorSpy.mockRestore();
});

describe('server.js — startup env validation', () => {
  it('exits with status 1 when SMTP_HOST is missing', async () => {
    const original = { ...process.env };
    delete process.env.SMTP_HOST;
    process.env.SMTP_USER = 'u';
    process.env.SMTP_PASS = 'p';

    try {
      await import('../server.js');
      expect(exitSpy).toHaveBeenCalledWith(1);
      // Logged a useful message
      const allLogs = errorSpy.mock.calls.flat().join(' ');
      expect(allLogs).toMatch(/SMTP/i);
    } finally {
      process.env = original;
    }
  });

  it('exits with status 1 when SMTP_USER is missing', async () => {
    const original = { ...process.env };
    process.env.SMTP_HOST = 'localhost';
    delete process.env.SMTP_USER;
    process.env.SMTP_PASS = 'p';
    try {
      await import('../server.js');
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      process.env = original;
    }
  });

  it('exits with status 1 when ADMIN_USERNAME is missing (after SMTP passes)', async () => {
    const original = { ...process.env };
    process.env.SMTP_HOST = 'localhost';
    process.env.SMTP_USER = 'u';
    process.env.SMTP_PASS = 'p';
    delete process.env.ADMIN_USERNAME;
    process.env.ADMIN_PASSWORD = 'p';
    process.env.ADMIN_EMAIL = 'a@b.c';
    try {
      await import('../server.js');
      expect(exitSpy).toHaveBeenCalledWith(1);
      const allLogs = errorSpy.mock.calls.flat().join(' ');
      expect(allLogs).toMatch(/ADMIN/i);
    } finally {
      process.env = original;
    }
  });

  it('does not exit when all required env vars are present', async () => {
    const original = { ...process.env };
    process.env.SMTP_HOST = 'localhost';
    process.env.SMTP_USER = 'u';
    process.env.SMTP_PASS = 'p';
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD = 'p';
    process.env.ADMIN_EMAIL = 'a@b.c';
    try {
      await import('../server.js');
      expect(exitSpy).not.toHaveBeenCalled();
      // ViteExpress.listen called with the app and a port number
      expect(listenMock).toHaveBeenCalled();
      const [, port] = listenMock.mock.calls[0];
      expect(port).toBe(3000);
    } finally {
      process.env = original;
    }
  });
});
