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
vi.mock('../services/email.js', () => ({
  verifyEmailConnection: vi.fn(async () => true),
  initMail: vi.fn(async () => ({ enabled: false, reason: 'SMTP_HOST, SMTP_USER or SMTP_PASS not set' })),
  isMailEnabled: vi.fn(() => false),
  isMailConfigured: vi.fn(() => false),
  sendEmail: vi.fn(),
}));

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

describe('server.js: mail is optional', () => {
  it('does not exit when SMTP configuration is absent', async () => {
    const original = { ...process.env };
    try {
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;
      process.env.ADMIN_USERNAME = 'admin';
      process.env.ADMIN_PASSWORD = 'pw';
      process.env.ADMIN_EMAIL = 'admin@test.com';

      await import('../server.js');

      expect(exitSpy).not.toHaveBeenCalled();
      expect(listenMock).toHaveBeenCalled();
    } finally {
      process.env = original;
    }
  });

  it('still exits when admin configuration is absent', async () => {
    const original = { ...process.env };
    try {
      delete process.env.ADMIN_USERNAME;

      await import('../server.js');

      expect(exitSpy).toHaveBeenCalledWith(1);
      // Logged a useful message, same coverage the deleted
      // "exits with status 1 when ADMIN_USERNAME is missing" case had.
      const allLogs = errorSpy.mock.calls.flat().join(' ');
      expect(allLogs).toMatch(/ADMIN/i);
    } finally {
      process.env = original;
    }
  });

  // The two tests above only exercise the module-level admin gate: they
  // never invoke the ViteExpress.listen callback, so they cannot see
  // whether initMail() is actually called on the boot path or whether the
  // enabled/disabled branches log the right thing. These two do, by pulling
  // the callback vitest-express was handed and awaiting it directly.
  it('invokes initMail() on the boot path and logs the disabled reason when mail is unavailable', async () => {
    const original = { ...process.env };
    try {
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;
      process.env.ADMIN_USERNAME = 'admin';
      process.env.ADMIN_PASSWORD = 'pw';
      process.env.ADMIN_EMAIL = 'admin@test.com';

      await import('../server.js');
      const { initMail } = await import('../services/email.js');
      const listenCallback = listenMock.mock.calls[0][2];

      await listenCallback();

      expect(initMail).toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
      const allLogs = errorSpy.mock.calls.flat().join(' ');
      expect(allLogs).toMatch(/Email disabled/);
      expect(allLogs).toMatch(/SMTP_HOST, SMTP_USER or SMTP_PASS not set/);
    } finally {
      process.env = original;
    }
  });

  it('logs the verified line and does not exit when mail is available', async () => {
    const original = { ...process.env };
    let logSpy;
    try {
      process.env.SMTP_HOST = 'localhost';
      process.env.SMTP_USER = 'u';
      process.env.SMTP_PASS = 'p';
      process.env.ADMIN_USERNAME = 'admin';
      process.env.ADMIN_PASSWORD = 'pw';
      process.env.ADMIN_EMAIL = 'admin@test.com';

      await import('../server.js');
      const { initMail } = await import('../services/email.js');
      initMail.mockResolvedValueOnce({ enabled: true, reason: null });
      const listenCallback = listenMock.mock.calls[0][2];
      logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await listenCallback();

      expect(initMail).toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
      const allLogs = logSpy.mock.calls.flat().join(' ');
      expect(allLogs).toMatch(/SMTP connection verified/);
      expect(errorSpy.mock.calls.flat().join(' ')).not.toMatch(/Email disabled/);
    } finally {
      if (logSpy) logSpy.mockRestore();
      process.env = original;
    }
  });
});
