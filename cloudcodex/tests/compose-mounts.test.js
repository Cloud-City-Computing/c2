/**
 * Pins the SELinux label on every host bind mount in the production compose files
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// The files an operator runs as they are. The dev base (docker-compose.yaml)
// is deliberately unlabelled and gets its labels from docker-compose.linux.yml.
const PRODUCTION_COMPOSE = ['docker-compose-release.yml', 'docker-compose-prod.yml'];

// A host bind mount is a volumes entry whose source is a path: `- ./x:/y[:opts]`.
const bindMounts = (text) =>
  text
    .split('\n')
    .map((line, i) => ({ line: i + 1, m: line.match(/^\s*-\s*(\.{1,2}\/[^:\s]*):([^:\s]+)(?::(\S+))?\s*$/) }))
    .filter(({ m }) => m)
    .map(({ line, m }) => ({ line, source: m[1], target: m[2], options: (m[3] || '').split(',') }));

describe('production compose bind mounts', () => {
  for (const file of PRODUCTION_COMPOSE) {
    const mounts = bindMounts(readFileSync(path.join(REPO, file), 'utf8'));

    it(`${file} has bind mounts to check (non-vacuity)`, () => {
      expect(mounts.map((m) => m.source)).toEqual(expect.arrayContaining(['./init.sql', './migrations']));
    });

    // Without z (shared) or Z (private), an SELinux-enforcing host refuses the
    // container the file: MySQL's entrypoint then fails on init.sql with
    // "Permission denied", restarts on a data directory that is no longer
    // empty, skips initialisation, and the app finds no tables.
    it(`every bind mount in ${file} carries an SELinux label`, () => {
      const unlabelled = mounts.filter((m) => !m.options.includes('z') && !m.options.includes('Z'));
      expect(unlabelled.map((m) => `${file}:${m.line} ${m.source}`)).toEqual([]);
    });
  }
});
