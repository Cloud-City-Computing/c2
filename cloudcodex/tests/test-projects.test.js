/**
 * Pins which Vitest projects the default `npm test` runs
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../vitest.config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// Projects that need something a contributor may not have (a MySQL server).
// Everything else MUST be in the default run, or it silently stops running.
const OPT_IN = new Set(['integration']);

const projectFlags = (script) => [...script.matchAll(/--project\s+(\S+)/g)].map((m) => m[1]).sort();

describe('the default test run', () => {
  const declared = config.test.projects.map((p) => p.test.name);

  it('declares the integration project', () => {
    expect(declared).toContain('integration');
  });

  for (const script of ['test', 'test:watch', 'test:coverage']) {
    it(`${script} names every project except the opt-in ones`, () => {
      expect(projectFlags(pkg.scripts[script])).toEqual(declared.filter((n) => !OPT_IN.has(n)).sort());
    });
  }

  it('test:integration runs the integration project and nothing else', () => {
    expect(projectFlags(pkg.scripts['test:integration'])).toEqual(['integration']);
  });
});
