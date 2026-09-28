/**
 * Pins vendor/cloud-city-design to the exact upstream files its MANIFEST.json lists
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './buckets.js';

const VENDOR = path.join(ROOT, 'vendor', 'cloud-city-design');
const manifest = JSON.parse(readFileSync(path.join(VENDOR, 'MANIFEST.json'), 'utf8'));
const commit = manifest.upstream?.commit;
const UPSTREAM = 'https://github.com/Cloud-City-Computing/cloud-city-design';

const why = (detail) => `${detail}. vendor/cloud-city-design is a vendored copy of `
  + `Cloud-City-Computing/cloud-city-design at ${commit}. Propose the change there, then re-vendor.`;

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

const SUITES = Object.keys(manifest.files).filter((file) => file.endsWith('.test.mjs'));

// Runs the package's own node:test suites inside the copy and reads the pass and fail
// counts from the run's summary. The TAP reporter is named, because the default is
// spec from Node 24 on; NODE_OPTIONS is dropped, because a reporter named there
// too makes node refuse two reporters for one destination.
function runSuites(env = process.env) {
  const childEnv = { ...env };
  delete childEnv.NODE_OPTIONS;
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...SUITES],
    { cwd: VENDOR, encoding: 'utf8', timeout: 25000, env: childEnv });
  const summary = /# pass (\d+)[\s\S]*# fail (\d+)/.exec(run.stdout);
  return { run, pass: Number(summary?.[1]), fail: Number(summary?.[2]) };
}

function presentFiles() {
  return readdirSync(VENDOR, { recursive: true, encoding: 'utf8' })
    .map((entry) => entry.split(path.sep).join('/'))
    .filter((entry) => statSync(path.join(VENDOR, entry)).isFile())
    .sort();
}

describe('the vendored cloud-city-design package', () => {
  it('names its upstream repository and a full commit', () => {
    expect(manifest.name).toBe('cloud-city-design');
    expect(manifest.license).toBe('Apache-2.0');
    expect(manifest.upstream?.repository).toBe(UPSTREAM);
    expect(commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('lists the 37 distributable files of package 0.2.0', () => {
    // A re-vendor that changes the listed set updates this number on purpose.
    expect(Object.keys(manifest.files)).toHaveLength(37);
  });

  it('holds every listed file with the SHA-256 the manifest records', () => {
    for (const [file, digest] of Object.entries(manifest.files)) {
      const full = path.join(VENDOR, file);
      expect(existsSync(full), why(`${file} is listed but missing`)).toBe(true);
      expect(sha256(full), why(`${file} does not match its SHA-256`)).toBe(digest);
    }
  });

  it('holds no file the manifest does not list', () => {
    const unlisted = presentFiles().filter((file) => file !== 'MANIFEST.json' && !(file in manifest.files));
    expect(unlisted, why(`unlisted file(s) present: ${unlisted.join(', ')}`)).toEqual([]);
  });

  it('passes the package\'s own node:test suites in this copy', () => {
    expect(SUITES.length).toBeGreaterThanOrEqual(5);
    const { run, pass, fail } = runSuites();
    expect(run.status, why(`node --test failed:\n${run.stdout}\n${run.stderr}`)).toBe(0);
    // Non-vacuity: the suites ran their cases, not zero of them.
    expect(pass).toBeGreaterThanOrEqual(50);
    expect(fail).toBe(0);
  });

  it('reads the same counts whatever test reporter the environment asks for', () => {
    // Node 24 prints the spec reporter by default, and NODE_OPTIONS can name one too.
    const { run, pass, fail } = runSuites({ ...process.env, NODE_OPTIONS: '--test-reporter=spec' });
    expect(run.status, `node --test failed:\n${run.stdout}\n${run.stderr}`).toBe(0);
    expect(pass).toBeGreaterThanOrEqual(50);
    expect(fail).toBe(0);
  });
});
