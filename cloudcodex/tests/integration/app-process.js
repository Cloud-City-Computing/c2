/**
 * Child processes for the live-MySQL integration project: server.js and the lock holder, as real processes
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { fork } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

export const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const LOCK_HOLDER = path.join(APP, 'tests', 'integration', 'lock-holder.js');
export const SERVER = path.join(APP, 'server.js');

/** The boot admin every server this project starts is given. */
export const ADMIN = { username: 'lcadmin', password: 'Lifecycle-Passw0rd!', email: 'lcadmin@example.com' };

/** Every child started through `spawn`, so a test file can kill what is left in afterEach. */
export const children = new Set();

/** SIGKILL every child still running, and wait for each to close. */
export async function killChildren() {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = new Promise((resolve) => child.once('close', resolve));
      child.kill('SIGKILL');
      await closed;
    }
  }
  children.clear();
}

/** The environment a child runs with: this file's schema unless told otherwise. */
export function childEnv(overrides = {}) {
  const env = { ...process.env, ...overrides };
  for (const name of ['C2_INSTANCE_LOCK', 'AUTH_PROVIDERS', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
    'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'NODE_OPTIONS', 'VITEST', 'VITEST_POOL_ID', 'VITEST_WORKER_ID']) {
    if (!(name in overrides)) delete env[name];
  }
  return env;
}

/**
 * Fork `script` and collect its output. `closed` resolves with the exit code,
 * the signal and everything it printed, once its stdio has drained.
 */
export function spawn(script, env) {
  const child = fork(script, [], { cwd: APP, env, silent: true });
  children.add(child);
  const out = { stdout: '', stderr: '' };
  child.stdout.on('data', (d) => { out.stdout += d; });
  child.stderr.on('data', (d) => { out.stderr += d; });
  const closed = new Promise((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal, ...out }));
  });
  return { child, out, closed };
}

/** Start a lock holder; resolves `{ held, connectionId }` or `{ held: false, code, stderr }`. */
export function holdLock(dbName = process.env.DB_NAME) {
  const run = spawn(LOCK_HOLDER, childEnv({ DB_NAME: dbName }));
  const outcome = new Promise((resolve) => {
    run.child.stdout.on('data', () => {
      const m = run.out.stdout.match(/held (\d+)/);
      if (m) resolve({ held: true, connectionId: Number(m[1]) });
    });
    run.closed.then(({ code, stderr }) => resolve({ held: false, code, stderr }));
  });
  return { ...run, outcome };
}

/** Send `signal` to a child started by `spawn` and wait for it to close. */
export async function kill(run, signal) {
  run.child.kill(signal);
  return run.closed;
}

/** A port nothing is listening on, from the OS. */
export async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/**
 * Boot server.js on `port` against this file's schema (or `env.DB_NAME`) and
 * wait for /readyz to say 200.
 */
export async function startServer(port, env = {}) {
  const run = spawn(SERVER, childEnv({
    NODE_ENV: 'production',
    PORT: String(port),
    // Production refuses to boot without APP_URL (W6-CDX-32). The address this
    // test reaches the server on; a loopback URL boots with a warning.
    APP_URL: `http://127.0.0.1:${port}`,
    ADMIN_USERNAME: ADMIN.username,
    ADMIN_PASSWORD: ADMIN.password,
    ADMIN_EMAIL: ADMIN.email,
    ...env,
  }));
  const deadline = Date.now() + 45_000;
  let last = 'no answer';
  while (Date.now() < deadline) {
    if (run.child.exitCode !== null) {
      throw new Error(`server.js exited ${run.child.exitCode} during boot:\n${run.out.stdout}\n${run.out.stderr}`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/readyz`);
      last = `${res.status} ${await res.text()}`;
      if (res.status === 200) return run;
    } catch (err) {
      last = err.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`server.js never became ready (last: ${last}):\n${run.out.stdout}\n${run.out.stderr}`);
}

/** Sign in as the boot admin through the real login route. */
export async function signIn(port) {
  const res = await fetch(`http://127.0.0.1:${port}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN.username, password: ADMIN.password }),
  });
  const body = await res.json();
  expect(res.status, JSON.stringify(body)).toBe(200);
  return body.token;
}
