/**
 * Codex is a standalone product: no application source names a sibling product, the suite it was
 * once part of, or an identity provider
 *
 * The scan covers the application's source (the directories and files below). tests/ and vendor/
 * are not scanned: fixtures may say anything, and the vendored brand.json may carry a brand's name.
 * The company's legal name in a file header is the only "Cloud City" form allowed.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './buckets.js';

const FORBIDDEN = [
  /Cloud City(?! Computing)/, // the company's legal name in a header is the only allowed form
  /Cloud Command/,
  /\bsuite mode\b/i,
  /\bSUITE_[A-Z_]+\b/,
  /\bW6-CMD-\d+/,
  /\bzitadel\b/i,
  /\b(paired|sibling) product\b/i,
];

// Allowed by exact string: the two preference storage names, which are a stored contract (the
// cookie and localStorage keys a browser already holds).
const ALLOWED_EXACT = ['cc_suite_theme', 'cc_suite_accent'];

// SUITE_ names are allowed only where they name a removed variable: a `kind: 'removed'` entry of
// env-contract.js, and services/removed-env.js, which reads each removed variable to warn about it.
const SUITE_NAME = /\bSUITE_[A-Z_]+\b/;
const SUITE_ALLOWED_FILES = new Set(['services/removed-env.js']);

const DIRS = ['src', 'routes', 'services', 'middleware', 'scripts'];
const FILES = ['app.js', 'server.js', 'mysql_connect.js', 'index.html', 'env-contract.js'];

function sources() {
  const found = FILES.map((f) => path.join(ROOT, f)).filter((f) => {
    try { return statSync(f).isFile(); } catch { return false; }
  });
  for (const dir of DIRS) {
    for (const entry of readdirSync(path.join(ROOT, dir), { recursive: true, encoding: 'utf8' })) {
      const file = path.join(ROOT, dir, entry);
      if (/\.(js|jsx|mjs|css|html)$/.test(file) && statSync(file).isFile()) found.push(file);
    }
  }
  return found;
}

/**
 * The lines of env-contract.js that name a SUITE_ variable outside a `kind: 'removed'` entry. An entry
 * is one object literal that starts on a line with `{ name:`, so its block runs to the next such line.
 */
function unremovedSuiteLines(text) {
  const lines = text.split('\n');
  const starts = lines.map((l, i) => (/^\s*\{ name:/.test(l) ? i : -1)).filter((i) => i >= 0);
  const bad = [];
  lines.forEach((line, i) => {
    if (!SUITE_NAME.test(line)) return;
    const start = starts.filter((s) => s <= i).pop();
    if (start === undefined) { bad.push(i + 1); return; }
    const block = lines.slice(start, starts.find((s) => s > start) ?? lines.length).join('\n');
    if (!/kind: 'removed'/.test(block)) bad.push(i + 1);
  });
  return bad;
}

function violations(file, text) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  let scrubbed = text;
  for (const allowed of ALLOWED_EXACT) scrubbed = scrubbed.split(allowed).join('');
  const found = [];
  for (const pattern of FORBIDDEN) {
    if (pattern === SUITE_NAME || pattern.source === SUITE_NAME.source) continue;
    if (pattern.test(scrubbed)) found.push(`${rel}: ${pattern}`);
  }
  if (SUITE_NAME.test(scrubbed)) {
    if (rel === 'env-contract.js') {
      for (const line of unremovedSuiteLines(scrubbed)) found.push(`${rel}:${line}: SUITE_ outside a removed entry`);
    } else if (!SUITE_ALLOWED_FILES.has(rel)) {
      found.push(`${rel}: ${SUITE_NAME}`);
    }
  }
  return found;
}

describe('Codex is a standalone product', () => {
  it('no application source names a sibling product, the suite, or an identity provider', () => {
    const files = sources();
    expect(files.length).toBeGreaterThan(100); // non-vacuity
    const hits = files.flatMap((f) => violations(f, readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });
});
