/**
 * Every var() with no fallback names a property some loaded stylesheet declares
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { inspectDangling } from '../../vendor/cloud-city-design/gates/dangling.mjs';
import { ROOT, EXTENSIONS, SCAN_ROOTS } from './buckets.js';

// Declarations come from every stylesheet the page loads: Codex's own under
// src/ and the vendored primitives. fonts.css declares no custom property.
const DECLARATION_ROOTS = ['src', 'vendor/cloud-city-design/core.css'];

const ledger = JSON.parse(readFileSync(path.join(ROOT, 'tests', 'design', 'dangling-ledger.json'), 'utf8'));
const inspection = inspectDangling({
  base: ROOT, declarationRoots: DECLARATION_ROOTS, referrerRoots: SCAN_ROOTS, extensions: EXTENSIONS,
});

describe('dangling var() references', () => {
  it('lists nothing beyond the ledger', () => {
    const counts = new Map();
    for (const { file, name, line } of inspection.findings) {
      const key = `${file} ${name}`;
      counts.set(key, [...(counts.get(key) ?? []), line]);
    }
    const unexplained = [...counts]
      .filter(([key, lines]) => {
        const [file, name] = key.split(' ');
        return lines.length !== ledger[file]?.[name]?.count;
      })
      .map(([key, lines]) => `${key} at line(s) ${lines.join(', ')}`);
    expect(unexplained, 'Point each reference at a declared name, or give it a fallback if it may '
      + 'really be absent. Only a false positive goes on tests/design/dangling-ledger.json.').toEqual([]);
  });

  it('has no stale ledger entry, and a reason for every entry', () => {
    for (const [file, names] of Object.entries(ledger)) {
      if (file.startsWith('_')) continue;
      for (const [name, entry] of Object.entries(names)) {
        const found = inspection.findings.filter((f) => f.file === file && f.name === name).length;
        expect(found, `${file} ${name}: the ledger says ${entry.count}`).toBe(entry.count);
        expect(entry.reason.length, `${file} ${name} needs a reason`).toBeGreaterThan(20);
      }
    }
  });

  it('read the code base, not nothing', () => {
    // Measured when the gate landed: 69 referrer files (57 .jsx), 753 no-fallback
    // references, and the 27 index.css names, 61 core.css primitives and 19
    // codex.css bindings declared.
    expect(inspection.referrerFiles).toContain('src/index.css');
    expect(inspection.referrerFiles.filter((f) => f.endsWith('.jsx')).length).toBeGreaterThanOrEqual(50);
    expect(inspection.referrerFiles.length).toBeGreaterThanOrEqual(60);
    expect(inspection.referenceSites).toBeGreaterThanOrEqual(600);
    for (const name of ['--bg-main', '--accent-300', '--cx-accent']) {
      expect(inspection.declared.has(name), `${name} should be declared`).toBe(true);
    }
  });
});
