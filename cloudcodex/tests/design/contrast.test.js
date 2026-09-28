/**
 * Contrast of Codex's declared text-on-surface pairs, through the vendored contrast gate
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  contrastRatio, parseThemeTokens, resolveToken, round,
} from '../../vendor/cloud-city-design/gates/contrast.mjs';
import { declaredNames } from '../../vendor/cloud-city-design/gates/dangling.mjs';
import { ROOT } from './buckets.js';

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const core = read('vendor/cloud-city-design/core.css');
const codex = read('src/codex.css');
const spec = JSON.parse(read('tests/design/pairs.json'));

// core.css is the :root base; codex.css's [data-theme='dark'] block lays over it.
const dark = parseThemeTokens(`${core}\n${codex}`).dark;

const pairs = spec.groups.flatMap((group) => (group.on === 'surfaces' ? spec.surfaces : group.on)
  .map((surface) => ({ text: group.text, surface, min: group.min })));

describe('codex.css contrast', () => {
  it('declares a real matrix', () => {
    // 10 groups over 5 surfaces plus the on-accent pair.
    expect(pairs.length).toBeGreaterThanOrEqual(51);
    for (const group of spec.groups) expect(group.reason.length, group.text).toBeGreaterThan(10);
  });

  it('resolves every token a pair names to a colour', () => {
    const unresolved = [...new Set(pairs.flatMap((p) => [p.text, p.surface]))]
      .filter((name) => resolveToken(dark, name) === undefined);
    expect(unresolved).toEqual([]);
  });

  it.each(pairs)('$text on $surface clears $min:1', ({ text, surface, min }) => {
    const ratio = contrastRatio(resolveToken(dark, text), resolveToken(dark, surface));
    expect(ratio, `${text} on ${surface} measures ${round(ratio)}:1`).toBeGreaterThanOrEqual(min);
  });

  it('measures every colour binding in codex.css, or says why it is decorative', () => {
    const named = new Set([...pairs.flatMap((p) => [p.text, p.surface]), ...Object.keys(spec.decorative)]);
    const colours = declaredNames(codex).filter((name) => resolveToken(dark, name) !== undefined);
    expect(colours.length).toBeGreaterThanOrEqual(19);
    expect(colours.filter((name) => !named.has(name))).toEqual([]);
  });
});
