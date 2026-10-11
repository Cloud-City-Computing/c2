/**
 * Every stacking order in src/ is a token from the shared z-scale, never a raw number
 *
 * The scale is vendored in vendor/cloud-city-design/core.css (--z-base through --z-toast). The
 * floor of 12 is the count of distinct raw values the stylesheet held before W6-CDX-25, so a
 * scan that finds fewer declarations than that has stopped reading the files it should.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { scanTargets, relativePath } from './buckets.js';
import { maskComments } from '../../vendor/cloud-city-design/gates/token-discipline.mjs';

const CORE = new URL('../../vendor/cloud-city-design/core.css', import.meta.url);
const SCALE = [...readFileSync(CORE, 'utf8').matchAll(/--(z-[a-z]+)\s*:/g)].map((m) => `--${m[1]}`);

// A CSS declaration, `z-index: value`, and a React style object key, `zIndex: value`.
const CSS_DECL = /(?<![\w-])z-index\s*:\s*([^;{}]+)/g;
const JS_KEY = /(?<![\w$])zIndex\s*:\s*([^,}\n]+)/g;

function declarations() {
  const found = { css: [], js: [] };
  for (const file of scanTargets()) {
    const rel = relativePath(file);
    const code = maskComments(readFileSync(file, 'utf8'));
    for (const m of code.matchAll(CSS_DECL)) found.css.push({ rel, value: m[1].trim() });
    for (const m of code.matchAll(JS_KEY)) found.js.push({ rel, value: m[1].trim().replace(/^['"]|['"]$/g, '') });
  }
  return found;
}

describe('stacking order', () => {
  it('the vendored scale has the seven named levels', () => {
    expect(SCALE).toEqual(['--z-base', '--z-sticky', '--z-scrim', '--z-modal', '--z-skip', '--z-menu', '--z-toast']);
  });

  it('every CSS z-index is a var() of a scale token', () => {
    const { css } = declarations();
    expect(css.length).toBeGreaterThanOrEqual(12);
    const raw = css.filter((d) => !/^var\(--z-[a-z]+\)$/.test(d.value));
    expect(raw.map((d) => `${d.rel}: z-index: ${d.value}`)).toEqual([]);
    for (const d of css) {
      const token = /^var\((--z-[a-z]+)\)$/.exec(d.value)[1];
      expect(SCALE).toContain(token);
    }
  });

  it('every React style zIndex is a var() of a scale token', () => {
    const { js } = declarations();
    expect(js.length).toBeGreaterThanOrEqual(2);
    const raw = js.filter((d) => !/^var\(--z-[a-z]+\)$/.test(d.value));
    expect(raw.map((d) => `${d.rel}: zIndex: ${d.value}`)).toEqual([]);
  });
});
