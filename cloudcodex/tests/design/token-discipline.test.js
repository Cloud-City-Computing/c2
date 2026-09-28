/**
 * Token discipline over src/ and index.html, held exactly to an exemption ledger that can only shrink
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ROOT, banners, liveBuckets, relativePath, scanSource, scanTargets, total, TOKEN_DEFINITIONS,
} from './buckets.js';

const ledger = JSON.parse(readFileSync(path.join(ROOT, 'tests', 'design', 'ledger.json'), 'utf8'));
const live = liveBuckets();

function rows(buckets) {
  const out = new Map();
  for (const [file, sections] of Object.entries(buckets)) {
    if (file.startsWith('_')) continue;
    for (const [section, count] of Object.entries(sections)) out.set(`${file} :: ${section}`, count);
  }
  return out;
}

describe('token discipline against the ledger', () => {
  const recorded = rows(ledger);
  const measured = rows(live);

  it('has no bucket above its ledger number (a regression)', () => {
    const over = [...measured]
      .filter(([key, count]) => count > (recorded.get(key) ?? 0))
      .map(([key, count]) => `${key}: ${count} found, ledger allows ${recorded.get(key) ?? 0}`);
    expect(over, 'Use a token from src/codex.css or core.css instead of the literal, the fill shade '
      + 'or the suppressed outline. Run node tests/design/report.mjs to see the buckets.').toEqual([]);
  });

  it('has no bucket below its ledger number (a fix nobody recorded)', () => {
    const under = [...recorded]
      .filter(([key, count]) => (measured.get(key) ?? 0) < count)
      .map(([key, count]) => `${key}: ledger says ${count}, ${measured.get(key) ?? 0} found`);
    expect(under, 'Lower tests/design/ledger.json by exactly what was fixed (delete a bucket at zero).')
      .toEqual([]);
  });

  it('keeps the ledger total equal to the scanner count', () => {
    expect(total(ledger)).toBe(total(live));
  });
});

describe('the scan is looking at the code base', () => {
  const targets = scanTargets().map(relativePath);

  it('reads index.html, the stylesheets and the .js and .jsx sources', () => {
    expect(targets).toContain('index.html');
    expect(targets).toContain('src/index.css');
    expect(targets).toContain('src/codex.css');
    expect(targets).toContain('src/userPrefs.js');
    // Measured at 69 files, 45 of them .jsx, when the gate landed.
    expect(targets.length).toBeGreaterThanOrEqual(60);
    expect(targets.filter((file) => file.endsWith('.jsx')).length).toBeGreaterThanOrEqual(40);
  });

  it('finds each of the three rules in a seeded source', () => {
    const rules = scanSource([
      'const style = { color: "#ff0000" };',
      '.x:focus { outline: none; }',
      '.y { color: var(--cx-accent-fill); }',
    ].join('\n'), 'seed.jsx').map((finding) => finding.rule);
    expect(rules.sort()).toEqual(['token-accent-position', 'token-literal-color', 'token-outline-suppressed']);
  });

  it('skips literal colours only in the token definitions, and still applies the other rules there', () => {
    expect(TOKEN_DEFINITIONS).toEqual(['src/codex.css']);
    const seed = '[data-theme=\'dark\'] { --cx-x: oklch(0.5 0 0); }\n.z { outline: 0; color: var(--brand-blue); }';
    expect(scanSource(seed, 'src/codex.css').map((f) => f.rule).sort())
      .toEqual(['token-accent-position', 'token-outline-suppressed']);
    expect(scanSource(seed, 'src/other.css').map((f) => f.rule)).toContain('token-literal-color');
  });

  it('buckets index.css findings by both banner shapes, with em dashes as hyphens', () => {
    const marks = banners([
      '/* =========================',
      '   Buttons',
      '========================= */',
      '/* ─── GitHub Integration ─── */',
      '/* ==========',
      '   Remote Cursors — Collaborative Editing',
    ].join('\n'));
    expect(marks).toEqual([
      { line: 1, name: 'Buttons' },
      { line: 4, name: 'GitHub Integration' },
      { line: 5, name: 'Remote Cursors - Collaborative Editing' },
    ]);
  });
});
