// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cloud City Computing, LLC

// node --test suite for MANIFEST.json. It passes in this repository and in a
// consumer's vendored copy alike: a consumer's MANIFEST.json carries an extra
// `upstream` block and its copy has no README.md, and neither changes the
// distributable set.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** Repository files at the package root: never listed, never copied. */
const ROOT_ONLY = new Set(['MANIFEST.json', 'README.md']);

/** @returns {Record<string, string>} every distributable file and its sha256, keys sorted */
function distributable() {
  /** @type {string[]} */
  const paths = [];
  for (const entry of readdirSync(ROOT, { recursive: true, encoding: 'utf8' })) {
    const path = entry.split('\\').join('/');
    if (path.split('/').some((segment) => segment.startsWith('.'))) continue;
    if (ROOT_ONLY.has(path)) continue;
    if (!statSync(join(ROOT, entry)).isFile()) continue;
    paths.push(path);
  }
  paths.sort();
  /** @type {Record<string, string>} */
  const out = {};
  for (const path of paths) out[path] = createHash('sha256').update(readFileSync(join(ROOT, path))).digest('hex');
  return out;
}

/** @type {{ name?: unknown, version?: unknown, license?: unknown, files?: Record<string, string> }} */
const manifest = JSON.parse(readFileSync(join(ROOT, 'MANIFEST.json'), 'utf8'));

test('the manifest names the package, a semantic version and the licence', () => {
  assert.equal(manifest.name, 'cloud-city-design');
  assert.match(String(manifest.version), /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.license, 'Apache-2.0');
});

test('every listed file exists with the sha256 the manifest records', () => {
  const actual = distributable();
  for (const [path, digest] of Object.entries(manifest.files ?? {})) {
    assert.ok(path in actual, `${path} is listed but missing`);
    assert.equal(actual[path], digest, `${path} does not match its sha256`);
  }
});

test('no distributable file is left unlisted', () => {
  const listed = manifest.files ?? {};
  for (const path of Object.keys(distributable())) assert.ok(path in listed, `${path} is present but not listed`);
});

test('the listing is sorted and carries no repository file', () => {
  const keys = Object.keys(manifest.files ?? {});
  assert.deepEqual(keys, [...keys].sort());
  for (const key of keys) {
    assert.ok(!ROOT_ONLY.has(key), key);
    assert.ok(!key.split('/').some((segment) => segment.startsWith('.')), key);
  }
});
