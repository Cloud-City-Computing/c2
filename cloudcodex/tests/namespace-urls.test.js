/**
 * Pins every XML namespace in the repository to a real W3C URL, and keeps product words out of URL hosts
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// The rename from organizations, teams, projects and pages to workspaces,
// squads, archives and logs was a text substitution, and it reached inside
// URLs: ten inline SVG icons (the sidebar's, and the search and explore
// boxes') declared xmlns="http://www.w3.workspace/2000/svg". React creates
// an <svg> in the SVG namespace whatever the attribute says, so nothing looked
// wrong, but the same markup saved as an .svg file, or read as XML, is not SVG.

// Every namespace the app may declare. An allowlist, so a misspelling of any
// kind fails, not only the one the rename produced.
const ALLOWED_NAMESPACES = new Set([
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/1999/xhtml',
  'http://www.w3.org/1998/Math/MathML',
]);

// The product's own vocabulary. No real top-level domain is one of these
// words, so a URL host ending in one is a substitution that went too far.
const PRODUCT_WORDS = ['workspace', 'workspaces', 'squad', 'squads', 'archive', 'archives', 'log', 'logs'];

const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', 'db-data', 'public']);
const TEXT_EXT = /\.(js|jsx|mjs|cjs|md|html|css|svg|sql|ya?ml|json|sh)$/;

function textFiles(dir, rel = '') {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...textFiles(path.join(dir, entry.name), relPath));
    } else if (TEXT_EXT.test(entry.name) && entry.name !== 'package-lock.json') {
      out.push(relPath);
    }
  }
  return out;
}

/** Every xmlns declaration whose value is not an allowed namespace, as `file:line value`. */
function badNamespaces(text, file) {
  return text.split('\n').flatMap((line, i) =>
    [...line.matchAll(/\bxmlns(?::[\w-]+)?\s*=\s*["']([^"']*)["']/g)]
      .filter((m) => !ALLOWED_NAMESPACES.has(m[1]))
      .map((m) => `${file}:${i + 1} ${m[1]}`));
}

/** Every http(s) URL whose host ends in a product word, as `file:line host`. */
function productWordHosts(text, file) {
  return text.split('\n').flatMap((line, i) =>
    [...line.matchAll(/\bhttps?:\/\/([a-z0-9.-]+)/gi)]
      .filter((m) => PRODUCT_WORDS.includes(m[1].toLowerCase().split('.').pop()))
      .map((m) => `${file}:${i + 1} ${m[1]}`));
}

describe('the scanners (non-vacuity)', () => {
  it('flag the namespace the rename produced, and any other one not allowed', () => {
    const fixture = [
      '<svg xmlns="http://www.w3.workspace/2000/svg" />',
      "<svg xmlns='http://www.w3.org/2000/svg' xmlns:xlink=\"http://www.w3.org/1999/xlink\" />",
      '<svg xmlns="https://www.w3.org/2000/svg" />',
    ].join('\n');
    expect(badNamespaces(fixture, 'f.jsx')).toEqual([
      'f.jsx:1 http://www.w3.workspace/2000/svg',
      'f.jsx:3 https://www.w3.org/2000/svg',
    ]);
  });

  it('flag a URL host ending in a product word, and leave paths alone', () => {
    const fixture = [
      '[Marked](https://marked.js.workspace)',
      'https://github.com/org/repo/squads/archives.log',
      'http://docs.example.squads/x',
    ].join('\n');
    expect(productWordHosts(fixture, 'f.md')).toEqual([
      'f.md:1 marked.js.workspace',
      'f.md:3 docs.example.squads',
    ]);
  });
});

describe('the repository', () => {
  // This file is left out because its fixtures above are the broken spellings.
  const SELF = path.relative(REPO, fileURLToPath(import.meta.url)).split(path.sep).join('/');
  const files = textFiles(REPO).filter((f) => f !== SELF);

  it('scans the source, the docs and the compose files (non-vacuity)', () => {
    expect(SELF).toBe('cloudcodex/tests/namespace-urls.test.js');
    expect(files).toEqual(expect.arrayContaining([
      'cloudcodex/src/page_layouts/Std_Layout.jsx',
      'README.md',
      'docs/deployment.md',
      'docker-compose-prod.yml',
    ]));
    const declared = files.flatMap((f) =>
      [...readFileSync(path.join(REPO, f), 'utf8').matchAll(/\bxmlns\s*=/g)]);
    expect(declared.length).toBeGreaterThan(10);
  });

  it('declares only real XML namespaces', () => {
    const bad = files.flatMap((f) => badNamespaces(readFileSync(path.join(REPO, f), 'utf8'), f));
    expect(bad).toEqual([]);
  });

  it('has no URL whose host ends in a product word', () => {
    const bad = files.flatMap((f) => productWordHosts(readFileSync(path.join(REPO, f), 'utf8'), f));
    expect(bad).toEqual([]);
  });
});
