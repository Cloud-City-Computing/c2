/**
 * Pins how the production image starts, stops and reports its health
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(APP, '..');

const dockerfile = readFileSync(path.join(APP, 'Dockerfile'), 'utf8');
// The runtime stage is everything after the last FROM.
const runtimeStage = dockerfile.slice(dockerfile.lastIndexOf('\nFROM '));

/** The `app:` service block of a compose file, up to the next top-level key. */
function appService(file) {
  const text = readFileSync(path.join(REPO, file), 'utf8');
  const start = text.indexOf('\n  app:\n');
  expect(start).toBeGreaterThan(-1);
  const rest = text.slice(start + 1);
  const end = rest.search(/\n\S/);
  return end === -1 ? rest : rest.slice(0, end);
}

describe('Dockerfile', () => {
  // With npm in between, the stop signal reaches npm, not Node, and the
  // graceful shutdown in server.js never runs.
  it('runs node as the process, not npm', () => {
    const cmds = runtimeStage.match(/^CMD .*$/gm);
    expect(cmds).toEqual(['CMD ["node", "server.js"]']);
  });

  it('keeps NODE_ENV=production in the runtime stage, which the npm start script used to set', () => {
    expect(runtimeStage).toMatch(/^ENV NODE_ENV=production$/m);
  });

  it('probes /readyz, on the port the app binds, with the timings the compose grace period assumes', () => {
    const healthcheck = runtimeStage.match(/^HEALTHCHECK [\s\S]*?(?<!\\)\n/m);
    expect(healthcheck).not.toBeNull();
    const text = healthcheck[0];
    expect(text).toMatch(/--interval=10s/);
    expect(text).toMatch(/--timeout=3s/);
    expect(text).toMatch(/--start-period=20s/);
    expect(text).toMatch(/--retries=3/);
    expect(text).toMatch(/127\.0\.0\.1:'\+\(process\.env\.PORT\|\|3000\)\+'\/readyz/);
    // node:20-slim ships no curl or wget, so the probe is Node's own fetch.
    expect(text).toMatch(/CMD node -e/);
  });
});

describe('.env.example', () => {
  // Copied to .env, a blank NODE_ENV= line would override the image's ENV.
  it('ships NODE_ENV commented out, never as a blank assignment', () => {
    const example = readFileSync(path.join(REPO, '.env.example'), 'utf8');
    expect(example).not.toMatch(/^NODE_ENV=/m);
    expect(example).toMatch(/^# NODE_ENV=$/m);
  });
});

describe('production compose files', () => {
  for (const file of ['docker-compose-release.yml', 'docker-compose-prod.yml']) {
    // Longer than the shutdown's own ten-second bound, so the process exits by
    // itself before Docker's SIGKILL; Docker's default is ten seconds, a tie.
    it(`${file} gives the app a 20-second stop grace period`, () => {
      expect(appService(file)).toMatch(/^ {4}stop_grace_period: 20s$/m);
    });

    // The image runs node directly (above), so NODE_ENV=production comes from
    // its ENV alone, and Compose lets an env_file line `NODE_ENV=` replace that
    // with an empty value. `environment` wins over `env_file`.
    it(`${file} pins NODE_ENV=production on the app, over anything .env says`, () => {
      expect(appService(file)).toMatch(/^ {4}environment:\n(?: {6}.*\n)*? {6}NODE_ENV: production$/m);
    });
  }
});
