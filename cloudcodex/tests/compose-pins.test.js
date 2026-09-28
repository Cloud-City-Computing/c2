/**
 * Pins MySQL to one exact patch release in every compose file, workflow and bootstrap script
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Every file that names a MySQL image. A floating tag (mysql:8, mysql:8.4)
// moves under an install on the next pull: the release compose file would
// then run a server nobody tested, and CI would test one nobody ships.
const FILES = [
  'docker-compose.yaml',
  'docker-compose-prod.yml',
  'docker-compose-release.yml',
  'start.sh',
  // Every workflow that mentions MySQL at all, so a new one cannot slip past.
  ...readdirSync(path.join(REPO, '.github', 'workflows'))
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => `.github/workflows/${f}`)
    .filter((f) => /mysql/i.test(readFileSync(path.join(REPO, f), 'utf8'))),
];

// `mysql:` followed directly by a tag. A YAML key (`mysql:` then a newline or
// a space) is not an image reference and does not match.
const imageRefs = (text) =>
  text.split('\n').flatMap((line, i) =>
    [...line.matchAll(/\bmysql:([\w.-]+)/gi)].map((m) => ({ line: i + 1, tag: m[1] })));

const refs = FILES.flatMap((file) =>
  imageRefs(readFileSync(path.join(REPO, file), 'utf8')).map((r) => ({ file, ...r })));

describe('MySQL image pins', () => {
  it('every file that runs MySQL names an image (non-vacuity)', () => {
    const named = new Set(refs.map((r) => r.file));
    expect(FILES.filter((file) => !named.has(file))).toEqual([]);
    expect(FILES).toEqual(expect.arrayContaining(['.github/workflows/ci.yml', '.github/workflows/release.yml']));
  });

  it('no file names a MySQL image without a patch version', () => {
    const floating = refs.filter((r) => !/^\d+\.\d+\.\d+$/.test(r.tag));
    expect(floating.map((r) => `${r.file}:${r.line} mysql:${r.tag}`)).toEqual([]);
  });

  // One pin, so the image CI tests is the image every compose file runs.
  it('every file names the same patch release', () => {
    expect([...new Set(refs.map((r) => r.tag))]).toHaveLength(1);
  });
});
