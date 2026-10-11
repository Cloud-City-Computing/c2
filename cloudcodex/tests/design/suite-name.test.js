/**
 * No application source spells the suite's name: it is configuration (SUITE_NAME), not a literal
 *
 * The company's legal name in a file header is allowed, and nothing else. tests/ and vendor/
 * are not scanned: fixtures may say it, and the vendored brand.json may carry the suite's brand.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './buckets.js';

// The company's legal name in every file header is allowed; nothing else is.
const SUITE_LITERAL = /Cloud City(?! Computing)/;
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

describe('the suite name is configuration', () => {
  it('no application source spells the suite name', () => {
    const files = sources();
    expect(files.length).toBeGreaterThan(100); // non-vacuity
    const hits = files.filter((f) => SUITE_LITERAL.test(readFileSync(f, 'utf8')));
    expect(hits.map((f) => path.relative(ROOT, f))).toEqual([]);
  });
});
