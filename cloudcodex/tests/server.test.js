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
import { contractDefault } from './contract-default.js';

// server.js registers an 'error' handler on the returned server and reads
// `server.listening` and `server.address()` inside listen's callback, so the
// fake has to carry all three. A bare {} throws on `.on` and would fail every
// test in this file for a reason that looks unrelated.
//
// The callback is CAPTURED, never invoked during listen. Production defers it
// (vite-express awaits Vite startup before calling it), and invoking it
// synchronously here would run it before `const server = ...` is assigned,
// producing a TDZ error that says nothing about the code under test.
const serverHandlers = {};
let listenCallback;
const fakeServer = {
  listening: true,
  on: vi.fn((event, handler) => { serverHandlers[event] = handler; }),
  close: vi.fn(),
  // The real server reports the port it actually bound, which differs from the
  // requested one when PORT is 0. Tests override this to drive that case.
  address: vi.fn(() => ({ port: 4100 })),
};
const listenMock = vi.fn((_app, _port, callback) => {
  listenCallback = callback;
  return fakeServer;
});
vi.mock('vite-express', () => ({ default: { listen: listenMock } }));
vi.mock('../services/collab.js', () => ({
  setupCollabServer: vi.fn(),
  flushPendingSaves: vi.fn(async () => ({ saved: 0, failed: 0 })),
  closeAll: vi.fn(),
}));
vi.mock('../services/user-channel.js', () => ({ setupUserChannelServer: vi.fn(), closeAll: vi.fn() }));
// The lock opens a real MySQL connection; here it is a double that holds.
const heldLock = { held: true, disabled: false, connectionId: 7, release: vi.fn(async () => {}) };
vi.mock('../services/instance-lock.js', () => ({ acquireInstanceLock: vi.fn(async () => heldLock) }));
vi.mock('../routes/admin.js', () => ({ default: {}, ensureAdminUser: vi.fn(), bootstrapInstance: vi.fn() }));
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

let logSpy;

// server.js installs SIGTERM and SIGINT handlers on every import. Capture them
// instead, so a test can deliver a signal, and so twenty imports do not stack
// twenty real handlers on the test worker. Both `on` and `once` are captured,
// so a handler installed either way is found; `signalInstalledAt` is the
// invocation order of the first install, for the boot-order test.
let onSpy;
let onceSpy;
let signalHandlers;
let signalInstalledAt;

beforeEach(() => {
  vi.resetModules();
  signalHandlers = {};
  signalInstalledAt = undefined;
  const capture = (real) => (event, handler) => {
    if (event === 'SIGTERM' || event === 'SIGINT') {
      signalHandlers[event] = handler;
      signalInstalledAt ??= onSpy.mock.invocationCallOrder.concat(onceSpy.mock.invocationCallOrder)
        .sort((a, b) => a - b).at(-1);
      return process;
    }
    return real(event, handler);
  };
  onSpy = vi.spyOn(process, 'on').mockImplementation(capture(process.on.bind(process)));
  onceSpy = vi.spyOn(process, 'once').mockImplementation(capture(process.once.bind(process)));
  fakeServer.close.mockClear();
  heldLock.release.mockClear();
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  listenMock.mockClear();
  fakeServer.on.mockClear();
  fakeServer.listening = true;
  fakeServer.address.mockReturnValue({ port: 4100 });
  listenCallback = undefined;
  Object.keys(serverHandlers).forEach(k => delete serverHandlers[k]);
});

afterEach(() => {
  onSpy.mockRestore();
  onceSpy.mockRestore();
  exitSpy.mockRestore();
  errorSpy.mockRestore();
  logSpy.mockRestore();
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
      // Explicit, because this assertion became environment-sensitive when
      // PORT started being read: a PORT exported in a developer's or CI's
      // shell would otherwise decide it. (dotenv does not reach this test,
      // its only two importers are mocked in tests/setup.js.)
      delete process.env.PORT;
      await import('../server.js');
      expect(exitSpy).not.toHaveBeenCalled();
      // ViteExpress.listen called with the app and a port number
      expect(listenMock).toHaveBeenCalled();
      const [, port] = listenMock.mock.calls[0];
      expect(port).toBe(Number(contractDefault('PORT')));
    } finally {
      process.env = original;
    }
  });
});

describe('server.js: PORT', () => {
  const withEnv = async (env, assertions) => {
    const original = { ...process.env };
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD = 'pw';
    process.env.ADMIN_EMAIL = 'admin@test.com';
    Object.assign(process.env, env);
    try {
      await import('../server.js');
      await assertions();
    } finally {
      process.env = original;
    }
  };

  it('listens on PORT when it is set', async () => {
    await withEnv({ PORT: '4100' }, () => {
      expect(exitSpy).not.toHaveBeenCalled();
      expect(listenMock.mock.calls[0][1]).toBe(4100);
    });
  });

  it('treats a blank PORT as unset, which is what .env.example ships', async () => {
    await withEnv({ PORT: '   ' }, () => {
      expect(exitSpy).not.toHaveBeenCalled();
      expect(listenMock.mock.calls[0][1]).toBe(3000);
    });
  });

  it('exits rather than silently falling back when PORT is not a number', async () => {
    await withEnv({ PORT: 'notaport' }, () => {
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy.mock.calls.flat().join(' ')).toMatch(/Invalid PORT/);
    });
  });

  it('exits when PORT is outside the valid range', async () => {
    await withEnv({ PORT: '70000' }, () => {
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  // Express 5 aliases listen's callback onto the socket's 'error' event, so it
  // runs on a FAILED bind too. `server.listening` is what separates the two,
  // and these three pin that: same callback, opposite outcomes.
  it('announces the real port when the bind succeeded', async () => {
    await withEnv({ PORT: '4100' }, () => {
      listenCallback();
      expect(logSpy.mock.calls.flat().join(' ')).toMatch(/running on http:\/\/localhost:4100/);
    });
  });

  it('stays silent when the callback runs but the bind failed', async () => {
    await withEnv({ PORT: '4100' }, () => {
      fakeServer.listening = false;
      listenCallback();
      expect(logSpy.mock.calls.flat().join(' ')).not.toMatch(/running on/);
    });
  });

  it('reports the port actually bound, not the one requested, when PORT is 0', async () => {
    await withEnv({ PORT: '0' }, () => {
      expect(listenMock.mock.calls[0][1]).toBe(0);
      fakeServer.address.mockReturnValue({ port: 45123 });
      listenCallback();
      expect(logSpy.mock.calls.flat().join(' ')).toMatch(/running on http:\/\/localhost:45123/);
    });
  });

  it('reports an in-use port and exits instead of leaving an unhandled error', async () => {
    await withEnv({ PORT: '4100' }, () => {
      expect(fakeServer.on).toHaveBeenCalledWith('error', expect.any(Function));
      const err = new Error('listen EADDRINUSE');
      err.code = 'EADDRINUSE';
      serverHandlers.error(err);
      expect(errorSpy.mock.calls.flat().join(' ')).toMatch(/Port 4100 is already in use/);
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  it('reports any other server error and exits', async () => {
    await withEnv({ PORT: '4100' }, () => {
      serverHandlers.error(Object.assign(new Error('boom'), { code: 'EACCES' }));
      expect(errorSpy.mock.calls.flat().join(' ')).toMatch(/HTTP server error/);
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
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

  // The two tests above only exercise the module-level admin gate: they say
  // nothing about whether initMail() is actually called on the boot path or
  // whether the enabled/disabled branches log the right thing. These do.
  //
  // The boot sequence used to live inside the ViteExpress.listen callback, so
  // these tests pulled `listenMock.mock.calls[0][2]` and awaited it. It now
  // runs as top-level awaits BEFORE listen(), so importing the module is what
  // runs it: any mock return value has to be primed before the import, and the
  // assertions run straight after it. The wiring being proved is unchanged.
  it('invokes initMail() on the boot path and logs the disabled reason when mail is unavailable', async () => {
    const original = { ...process.env };
    try {
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;
      process.env.ADMIN_USERNAME = 'admin';
      process.env.ADMIN_PASSWORD = 'pw';
      process.env.ADMIN_EMAIL = 'admin@test.com';

      const { initMail } = await import('../services/email.js');
      await import('../server.js');

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

      const { initMail } = await import('../services/email.js');
      initMail.mockResolvedValueOnce({ enabled: true, reason: null });
      logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await import('../server.js');

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

  // The two tests above prove initMail() is on the boot path but say
  // nothing about the ensureAdminUser -> bootstrapInstance wiring right
  // below it. `bootstrapInstance: vi.fn()` in the module mock above only
  // stops that line from throwing — on its own it does not prove
  // server.js passes the right value through. This closes that gap by
  // controlling what ensureAdminUser() resolves to and asserting
  // bootstrapInstance receives exactly that id.
  it('calls bootstrapInstance with the id ensureAdminUser resolved', async () => {
    const original = { ...process.env };
    try {
      process.env.SMTP_HOST = 'localhost';
      process.env.SMTP_USER = 'u';
      process.env.SMTP_PASS = 'p';
      process.env.ADMIN_USERNAME = 'admin';
      process.env.ADMIN_PASSWORD = 'pw';
      process.env.ADMIN_EMAIL = 'admin@test.com';

      const { ensureAdminUser, bootstrapInstance } = await import('../routes/admin.js');
      ensureAdminUser.mockResolvedValueOnce(7);

      await import('../server.js');

      expect(bootstrapInstance).toHaveBeenCalledWith(7);
    } finally {
      process.env = original;
    }
  });
});

// The boot sequence no longer hides behind a listen callback, so the ordering
// and the failure handling are both directly observable.
describe('server.js: boot ordering and failure handling', () => {
  const bootEnv = () => {
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD = 'pw';
    process.env.ADMIN_EMAIL = 'admin@test.com';
  };

  it('resolves mail capability and seeds before the port opens', async () => {
    const original = { ...process.env };
    try {
      bootEnv();

      const { initMail } = await import('../services/email.js');
      const { ensureAdminUser, bootstrapInstance } = await import('../routes/admin.js');
      await import('../server.js');

      // listen() must be the last thing to happen: while any of these are in
      // flight the app would otherwise be answering requests with mail
      // reported disabled and no seeded content.
      expect(listenMock).toHaveBeenCalledTimes(1);
      const listenOrder = listenMock.mock.invocationCallOrder[0];
      expect(initMail.mock.invocationCallOrder[0]).toBeLessThan(listenOrder);
      expect(ensureAdminUser.mock.invocationCallOrder[0]).toBeLessThan(listenOrder);
      expect(bootstrapInstance.mock.invocationCallOrder[0]).toBeLessThan(listenOrder);
    } finally {
      process.env = original;
    }
  });

  it('logs and keeps serving when the first-boot seed throws', async () => {
    const original = { ...process.env };
    try {
      bootEnv();

      const { bootstrapInstance } = await import('../routes/admin.js');
      bootstrapInstance.mockRejectedValueOnce(new Error('archive insert failed'));

      await import('../server.js');

      // Usable-but-empty beats a dead process: an unhandled rejection here
      // would take the instance down over a seed that the next restart retries.
      expect(listenMock).toHaveBeenCalledTimes(1);
      expect(exitSpy).not.toHaveBeenCalled();
      const allLogs = errorSpy.mock.calls.flat().map(String).join(' ');
      expect(allLogs).toMatch(/instance bootstrap failed/);
      expect(allLogs).toMatch(/archive insert failed/);
    } finally {
      process.env = original;
    }
  });

  it('logs and keeps serving when the admin sync throws', async () => {
    const original = { ...process.env };
    try {
      bootEnv();

      const { ensureAdminUser, bootstrapInstance } = await import('../routes/admin.js');
      ensureAdminUser.mockRejectedValueOnce(new Error('db unreachable'));

      await import('../server.js');

      expect(listenMock).toHaveBeenCalledTimes(1);
      expect(exitSpy).not.toHaveBeenCalled();
      // No admin id means nothing to seed against; bootstrapInstance's own
      // null guard handles it rather than the seed running with undefined.
      expect(bootstrapInstance).toHaveBeenCalledWith(null);
      const allLogs = errorSpy.mock.calls.flat().map(String).join(' ');
      expect(allLogs).toMatch(/admin user sync failed/);
    } finally {
      process.env = original;
    }
  });

  // initMail() cannot throw today (verifyEmailConnection swallows its own
  // errors and isMailConfigured is a pure boolean check), but its two
  // siblings below it are each try/catch-wrapped so a rejection cannot take
  // the process down. This proves the same guard on initMail(): a rejection
  // must degrade to mail-disabled, not stop the port from opening.
  it('logs and keeps serving when the mail capability check throws', async () => {
    const original = { ...process.env };
    try {
      bootEnv();

      const { initMail } = await import('../services/email.js');
      initMail.mockRejectedValueOnce(new Error('SMTP verify blew up'));

      await import('../server.js');

      expect(listenMock).toHaveBeenCalledTimes(1);
      expect(exitSpy).not.toHaveBeenCalled();
      const allLogs = errorSpy.mock.calls.flat().map(String).join(' ');
      expect(allLogs).toMatch(/mail capability check failed/);
      expect(allLogs).toMatch(/SMTP verify blew up/);
      expect(allLogs).toMatch(/Email disabled/);
    } finally {
      process.env = original;
    }
  });
});

describe('server.js: AUTH_PROVIDERS', () => {
  const withEnv = async (env, assertions) => {
    const original = { ...process.env };
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD = 'pw';
    process.env.ADMIN_EMAIL = 'admin@test.com';
    delete process.env.AUTH_PROVIDERS;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    Object.assign(process.env, env);
    try {
      await import('../server.js');
      await assertions();
    } finally {
      process.env = original;
    }
  };

  it('boots when AUTH_PROVIDERS is unset, which is what .env.example ships', async () => {
    await withEnv({}, () => {
      expect(exitSpy).not.toHaveBeenCalled();
      expect(listenMock).toHaveBeenCalledTimes(1);
    });
  });

  it('boots with a valid explicit list', async () => {
    await withEnv({ AUTH_PROVIDERS: 'local' }, () => {
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  it('exits 1 with the parser\'s sentence on an unknown provider', async () => {
    await withEnv({ AUTH_PROVIDERS: 'local,saml' }, () => {
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy.mock.calls.flat().map(String).join(' ')).toMatch(/AUTH_PROVIDERS lists "saml"/);
    });
  });

  it('exits 1 when a listed provider is not configured', async () => {
    await withEnv({ AUTH_PROVIDERS: 'local,google' }, () => {
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy.mock.calls.flat().map(String).join(' ')).toMatch(/GOOGLE_CLIENT_ID/);
    });
  });
});

describe('server.js: the single-writer lock', () => {
  const bootEnv = () => {
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD = 'pw';
    process.env.ADMIN_EMAIL = 'admin@test.com';
    delete process.env.AUTH_PROVIDERS;
  };

  it('takes the lock before anything writes and before the port opens', async () => {
    const original = { ...process.env };
    try {
      bootEnv();
      const { acquireInstanceLock } = await import('../services/instance-lock.js');
      acquireInstanceLock.mockClear();
      const { ensureAdminUser } = await import('../routes/admin.js');
      const { openConnection } = await import('../mysql_connect.js');

      await import('../server.js');

      expect(acquireInstanceLock).toHaveBeenCalledTimes(1);
      // Its own connection, never the pool: GET_LOCK belongs to a connection.
      expect(acquireInstanceLock.mock.calls[0][0].connect).toBe(openConnection);
      const lockOrder = acquireInstanceLock.mock.invocationCallOrder[0];
      expect(lockOrder).toBeLessThan(ensureAdminUser.mock.invocationCallOrder.at(-1));
      expect(lockOrder).toBeLessThan(listenMock.mock.invocationCallOrder[0]);
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      process.env = original;
    }
  });

  it('hands the lock to /readyz', async () => {
    const original = { ...process.env };
    try {
      bootEnv();
      await import('../server.js');
      const { readiness } = await import('../routes/health.js');
      expect(readiness.lock).toBe(heldLock);
    } finally {
      process.env = original;
    }
  });

  it('exits 1 with the lock\'s sentence, before the admin sync, when another process holds it', async () => {
    const original = { ...process.env };
    try {
      bootEnv();
      const { acquireInstanceLock } = await import('../services/instance-lock.js');
      acquireInstanceLock.mockRejectedValueOnce(new Error('Another Cloud Codex process (MySQL connection 9) already serves this database.'));
      const { ensureAdminUser } = await import('../routes/admin.js');

      await import('../server.js');

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy.mock.calls.flat().map(String).join(' ')).toMatch(/MySQL connection 9/);
      expect(exitSpy.mock.invocationCallOrder[0]).toBeLessThan(ensureAdminUser.mock.invocationCallOrder.at(-1));
    } finally {
      process.env = original;
    }
  });
});

describe('server.js: stop signals', () => {
  const bootEnv = () => {
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD = 'pw';
    process.env.ADMIN_EMAIL = 'admin@test.com';
    delete process.env.AUTH_PROVIDERS;
  };

  it('installs a handler for SIGTERM and for SIGINT', async () => {
    const original = { ...process.env };
    try {
      bootEnv();
      await import('../server.js');
      expect(signalHandlers.SIGTERM).toEqual(expect.any(Function));
      expect(signalHandlers.SIGINT).toEqual(expect.any(Function));
    } finally {
      process.env = original;
    }
  });

  it('on SIGTERM: readiness goes 503, saves flush, both socket servers close with 1001, the lock and the pool are released, exit 0', async () => {
    const original = { ...process.env };
    try {
      bootEnv();
      const collab = await import('../services/collab.js');
      const userChannel = await import('../services/user-channel.js');
      const { endPool } = await import('../mysql_connect.js');
      collab.flushPendingSaves.mockClear();
      collab.closeAll.mockClear();
      userChannel.closeAll.mockClear();
      endPool.mockClear();

      await import('../server.js');
      const { readiness } = await import('../routes/health.js');
      await signalHandlers.SIGTERM('SIGTERM');

      expect(readiness.shuttingDown).toBe(true);
      expect(fakeServer.close).toHaveBeenCalledTimes(1);
      expect(collab.flushPendingSaves).toHaveBeenCalledTimes(1);
      expect(collab.closeAll).toHaveBeenCalledWith(1001, 'Server shutting down');
      expect(userChannel.closeAll).toHaveBeenCalledWith(1001, 'Server shutting down');
      expect(heldLock.release).toHaveBeenCalledTimes(1);
      expect(endPool).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalledWith(0);
      expect(errorSpy.mock.calls.flat().map(String).join(' ')).toMatch(/stopped cleanly on SIGTERM/);
      // The flush comes before the sockets close, and the pool ends last.
      expect(collab.flushPendingSaves.mock.invocationCallOrder[0]).toBeLessThan(collab.closeAll.mock.invocationCallOrder[0]);
      expect(heldLock.release.mock.invocationCallOrder[0]).toBeLessThan(endPool.mock.invocationCallOrder[0]);
    } finally {
      process.env = original;
    }
  });

  it('installs the handlers before the boot awaits anything, so a stop during boot is not dropped', async () => {
    const original = { ...process.env };
    try {
      bootEnv();
      const { acquireInstanceLock } = await import('../services/instance-lock.js');
      acquireInstanceLock.mockClear();

      await import('../server.js');

      // Node is PID 1 in the image, and the kernel drops a signal PID 1 has no
      // handler for: a docker stop during boot would then wait for SIGKILL.
      expect(signalInstalledAt).toBeLessThan(acquireInstanceLock.mock.invocationCallOrder[0]);
    } finally {
      process.env = original;
    }
  });

  it('a signal during boot ends the process at once, with 0', async () => {
    const original = { ...process.env };
    try {
      bootEnv();
      const { initMail } = await import('../services/email.js');
      initMail.mockClear();
      initMail.mockImplementationOnce(() => new Promise(() => {}));   // an SMTP verify that never answers
      const collab = await import('../services/collab.js');
      collab.flushPendingSaves.mockClear();

      import('../server.js');
      await vi.waitFor(() => expect(initMail).toHaveBeenCalled());
      signalHandlers.SIGTERM('SIGTERM');

      expect(exitSpy).toHaveBeenCalledWith(0);
      expect(errorSpy.mock.calls.flat().map(String).join(' ')).toMatch(/stopped on SIGTERM during boot/);
      expect(collab.flushPendingSaves).not.toHaveBeenCalled();
      expect(listenMock).not.toHaveBeenCalled();
    } finally {
      process.env = original;
    }
  });

  it('a second signal ends the process at once, with 1, instead of waiting for the first stop', async () => {
    const original = { ...process.env };
    try {
      bootEnv();
      const collab = await import('../services/collab.js');
      collab.flushPendingSaves.mockImplementationOnce(() => new Promise(() => {}));

      await import('../server.js');
      signalHandlers.SIGINT('SIGINT');
      await vi.waitFor(() => expect(collab.flushPendingSaves).toHaveBeenCalled());
      expect(exitSpy).not.toHaveBeenCalled();

      signalHandlers.SIGINT('SIGINT');

      expect(exitSpy).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy.mock.calls.flat().map(String).join(' ')).toMatch(/second SIGINT/);
    } finally {
      process.env = original;
    }
  });
});

describe('server.js: a lock taken over by another process', () => {
  const bootEnv = () => {
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD = 'pw';
    process.env.ADMIN_EMAIL = 'admin@test.com';
    delete process.env.AUTH_PROVIDERS;
  };

  it('stops through the whole graceful shutdown and exits 1', async () => {
    const original = { ...process.env };
    try {
      bootEnv();
      const { acquireInstanceLock } = await import('../services/instance-lock.js');
      acquireInstanceLock.mockClear();
      const collab = await import('../services/collab.js');
      const { endPool } = await import('../mysql_connect.js');
      collab.flushPendingSaves.mockClear();
      endPool.mockClear();

      await import('../server.js');
      const { onSuperseded } = acquireInstanceLock.mock.calls[0][0];
      expect(onSuperseded).toEqual(expect.any(Function));
      const { readiness } = await import('../routes/health.js');

      await onSuperseded(new Error('Another Cloud Codex process (MySQL connection 29) already serves this database.'));
      await vi.waitFor(() => expect(exitSpy).toHaveBeenCalled());

      // Two live writers on one schema is what the lock prevents; the one that
      // lost it stops, and its supervisor restarts it into a clean refusal.
      expect(readiness.shuttingDown).toBe(true);
      expect(collab.flushPendingSaves).toHaveBeenCalledTimes(1);
      expect(heldLock.release).toHaveBeenCalledTimes(1);
      expect(endPool).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalledWith(1);
      const logged = errorSpy.mock.calls.flat().map(String).join(' ');
      expect(logged).toMatch(/another process took the instance lock/i);
      expect(logged).not.toMatch(/stopped cleanly/);
    } finally {
      process.env = original;
    }
  });

  it('during boot, exits 1 at once', async () => {
    const original = { ...process.env };
    try {
      bootEnv();
      const { acquireInstanceLock } = await import('../services/instance-lock.js');
      acquireInstanceLock.mockClear();
      const { initMail } = await import('../services/email.js');
      initMail.mockClear();
      initMail.mockImplementationOnce(() => new Promise(() => {}));

      import('../server.js');
      await vi.waitFor(() => expect(initMail).toHaveBeenCalled());
      acquireInstanceLock.mock.calls[0][0].onSuperseded(new Error('Another Cloud Codex process (MySQL connection 29) already serves this database.'));

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(listenMock).not.toHaveBeenCalled();
    } finally {
      process.env = original;
    }
  });
});

// Sessions are one row per sign-in with a fixed life, and nothing refreshes a
// row in place, so the table only grows unless something reaps it. The prune
// is a named function handed to the timers, so these find it by name rather
// than by position among server.js's other timers.
describe('server.js: the expired-session prune', () => {
  let intervalSpy;
  let timeoutSpy;

  beforeEach(() => {
    intervalSpy = vi.spyOn(globalThis, 'setInterval');
    timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
  });

  afterEach(() => {
    intervalSpy.mockRestore();
    timeoutSpy.mockRestore();
  });

  const boot = async () => {
    const original = { ...process.env };
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD = 'pw';
    process.env.ADMIN_EMAIL = 'admin@test.com';
    try {
      await import('../server.js');
    } finally {
      process.env = original;
    }
    const { c2_query } = await import('../mysql_connect.js');
    const named = (spy) => spy.mock.calls.filter(([fn]) => fn?.name === 'pruneExpiredSessions');
    return { c2_query, intervals: named(intervalSpy), timeouts: named(timeoutSpy) };
  };

  it('runs daily, and once a minute after boot', async () => {
    const { intervals, timeouts } = await boot();

    expect(intervals.map(([, ms]) => ms)).toEqual([24 * 60 * 60 * 1000]);
    expect(timeouts.map(([, ms]) => ms)).toEqual([60 * 1000]);
  });

  it('deletes only expired rows, and logs how many it removed', async () => {
    const { c2_query, intervals } = await boot();
    c2_query.mockClear();
    c2_query.mockResolvedValueOnce({ affectedRows: 3 });

    await intervals[0][0]();

    expect(c2_query).toHaveBeenCalledTimes(1);
    expect(c2_query.mock.calls[0][0]).toMatch(/^\s*DELETE FROM sessions WHERE expires_at < NOW\(\)\s*$/);
    expect(c2_query.mock.calls[0][1]).toEqual([]);
    expect(errorSpy.mock.calls.flat().map(String).join(' ')).toMatch(/session prune: removed 3 rows/);
  });

  it('stays quiet when nothing had expired', async () => {
    const { c2_query, intervals } = await boot();
    c2_query.mockResolvedValueOnce({ affectedRows: 0 });
    errorSpy.mockClear();

    await intervals[0][0]();

    expect(errorSpy.mock.calls.flat().map(String).join(' ')).not.toMatch(/session prune/);
  });

  it('logs a failure and does not throw, so a bad night never takes the process down', async () => {
    const { c2_query, timeouts } = await boot();
    c2_query.mockRejectedValueOnce(new Error('db unreachable'));

    await expect(timeouts[0][0]()).resolves.toBeUndefined();

    const logged = errorSpy.mock.calls.flat().map(String).join(' ');
    expect(logged).toMatch(/session prune failed/);
    expect(logged).toMatch(/db unreachable/);
  });
});

describe('server.js: APP_URL', () => {
  const withEnv = async (env, assertions) => {
    const original = { ...process.env };
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD = 'pw';
    process.env.ADMIN_EMAIL = 'admin@test.com';
    delete process.env.APP_URL;
    delete process.env.AUTH_PROVIDERS;
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try {
      await import('../server.js');
      await assertions();
    } finally {
      process.env = original;
    }
  };
  const logged = () => errorSpy.mock.calls.flat().map(String).join(' ');

  // Invitation, reset and notification links carry APP_URL, and unset it is
  // http://localhost:3000, so a production instance without it emails links
  // that point at the reader's own machine and never says so.
  it('exits 1 in production when APP_URL is unset, naming the variable', async () => {
    await withEnv({ NODE_ENV: 'production' }, () => {
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(logged()).toContain(
        '✖ APP_URL is required in production: set it to the address people use to reach this instance.'
      );
    });
  });

  it('exits 1 in production when APP_URL is blank', async () => {
    await withEnv({ NODE_ENV: 'production', APP_URL: '  ' }, () => {
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(logged()).toMatch(/APP_URL is required in production/);
    });
  });

  it.each(['codex.example.com', 'ftp://codex.example.com', 'javascript:alert(1)', 'http://'])(
    'exits 1 in production when APP_URL is %j, which is not an http(s) URL',
    async (value) => {
      await withEnv({ NODE_ENV: 'production', APP_URL: value }, () => {
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(logged()).toContain(`APP_URL "${value}" is not an http or https URL`);
      });
    }
  );

  it.each(['https://codex.example.com', 'http://localhost:3000', 'https://example.com/codex/'])(
    'boots in production with APP_URL %j',
    async (value) => {
      await withEnv({ NODE_ENV: 'production', APP_URL: value }, () => {
        expect(exitSpy).not.toHaveBeenCalled();
        expect(listenMock).toHaveBeenCalledTimes(1);
      });
    }
  );

  // .env.example ships http://localhost:3000, which the gate accepts because
  // the release compose file's evaluation run on one machine is legitimate.
  // Copied to a public host it would still email links to the reader's own
  // machine, so production boots but says so.
  it.each(['http://localhost:3000', 'https://LOCALHOST', 'http://127.0.0.1:8080/', 'http://[::1]:3000', 'http://docs.localhost'])(
    'boots in production with APP_URL %j but warns that links will point at this machine',
    async (value) => {
      await withEnv({ NODE_ENV: 'production', APP_URL: value }, () => {
        expect(exitSpy).not.toHaveBeenCalled();
        expect(listenMock).toHaveBeenCalledTimes(1);
        expect(logged()).toContain(`⚠ APP_URL "${value}" points at this machine`);
      });
    }
  );

  it.each(['https://codex.example.com', 'http://10.0.0.5:3000', 'https://localhost.example.com', 'http://notlocalhost:3000'])(
    'does not warn in production for APP_URL %j',
    async (value) => {
      await withEnv({ NODE_ENV: 'production', APP_URL: value }, () => {
        expect(logged()).not.toMatch(/APP_URL/);
      });
    }
  );

  it('does not warn outside production, where localhost is the default', async () => {
    await withEnv({ NODE_ENV: 'development', APP_URL: 'http://localhost:3000' }, () => {
      expect(logged()).not.toMatch(/APP_URL/);
    });
  });

  it.each(['development', 'test', undefined])(
    'boots with APP_URL unset when NODE_ENV is %j, keeping the localhost default',
    async (nodeEnv) => {
      await withEnv({ NODE_ENV: nodeEnv }, () => {
        expect(exitSpy).not.toHaveBeenCalled();
        expect(logged()).not.toMatch(/APP_URL/);
      });
    }
  );
});
