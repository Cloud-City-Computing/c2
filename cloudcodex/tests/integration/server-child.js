/**
 * Child processes for the integration project: server.js and the lock holder, run for real
 *
 * lifecycle.test.js and grants-sufficient.test.js both boot the real server
 * (and the instance lock) in a process of its own, so everything that runs at
 * boot, and the WebSocket servers, run exactly as they do in production.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { expect } from 'vitest';
import { fork } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const LOCK_HOLDER = path.join(APP, 'tests', 'integration', 'lock-holder.js');
export const SERVER = path.join(APP, 'server.js');

/** Every child started through `spawn`, until `killChildren` ends them. */
const children = new Set();

/** SIGKILL every child still running and wait for each to close. For afterEach. */
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

/**
 * The environment a child runs with: this file's schema and account unless
 * `overrides` names others, and none of the settings that would change what
 * boot does.
 */
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

/** Send `signal` to a spawned child and resolve with how it closed. */
export async function kill(run, signal) {
  run.child.kill(signal);
  return run.closed;
}

/**
 * Start a lock holder; `outcome` resolves `{ held, connectionId }` or
 * `{ held: false, code, stderr }`. `env` overrides the child's DB_* settings.
 */
export function holdLock(env = {}) {
  const run = spawn(LOCK_HOLDER, childEnv(env));
  const outcome = new Promise((resolve) => {
    run.child.stdout.on('data', () => {
      const m = run.out.stdout.match(/held (\d+)/);
      if (m) resolve({ held: true, connectionId: Number(m[1]) });
    });
    run.closed.then(({ code, stderr }) => resolve({ held: false, code, stderr }));
  });
  return { ...run, outcome };
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
 * Boot server.js in production mode on `port`, with `admin` as the boot
 * admin, and wait for /readyz to say 200. `env` overrides the child's
 * environment (DB_* to point it at another schema or account).
 */
export async function startServer(port, admin, env = {}) {
  const run = spawn(SERVER, childEnv({
    NODE_ENV: 'production',
    PORT: String(port),
    // Production refuses to boot without APP_URL (W6-CDX-32). The address this
    // test reaches the server on; a loopback URL boots with a warning.
    APP_URL: `http://127.0.0.1:${port}`,
    ADMIN_USERNAME: admin.username,
    ADMIN_PASSWORD: admin.password,
    ADMIN_EMAIL: admin.email,
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

/** Sign in as `admin` through the real login route and return the session token. */
export async function signIn(port, admin) {
  const res = await fetch(`http://127.0.0.1:${port}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: admin.username, password: admin.password }),
  });
  const body = await res.json();
  expect(res.status, JSON.stringify(body)).toBe(200);
  return body.token;
}

/**
 * Open /collab for `logId`, authenticate, and resolve once the server has
 * sent both its sync steps and the JSON `sync` frame. `doc` receives the
 * server's state.
 */
export async function openCollab(port, logId, token, doc) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/collab?logId=${logId}`, {
    headers: { Origin: `http://127.0.0.1:${port}` },
  });
  ws.binaryType = 'arraybuffer';
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const synced = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no sync frame within 5 s')), 5000);
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        syncProtocol.readSyncMessage(decoding.createDecoder(new Uint8Array(data)), encoding.createEncoder(), doc, 'server');
        return;
      }
      const msg = JSON.parse(data.toString());
      if (msg.type === 'sync') {
        clearTimeout(timer);
        resolve(msg);
      }
    });
  });
  ws.send(JSON.stringify({ type: 'auth', token }));
  const meta = await synced;
  expect(meta.canWrite).toBe(true);
  return ws;
}
