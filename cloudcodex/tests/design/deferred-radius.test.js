/**
 * The deferred families (comments, the editor, Draw.io, Version History, GitHub) keep Codex's own 4, 8 and 12px
 * radii until W6-CDX-43. K3 says no geometry change there, so they read --cx-deferred-radius-*, not core's steps.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseThemeTokens, resolveTokenValue } from '../../vendor/cloud-city-design/gates/contrast.mjs';
import { banners, ROOT, THEME_OPTIONS } from './buckets.js';

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const src = read('src/index.css');
const codex = read('src/codex.css');
const dark = parseThemeTokens(`${read('vendor/cloud-city-design/core.css')}\n${codex}`, THEME_OPTIONS).dark;
const DEFERRED = [
  'Comments & Annotations', 'GitHub Integration', 'Editor Log', 'Markdown Editor', 'Version History',
  'Collaborative Editing - Presence UI', 'Remote Cursors - Collaborative Editing', 'Draw.io Diagram Block',
];

/** The lines of src/index.css inside the deferred banners, each banner running to the next one. */
function deferredLines() {
  const lines = src.split('\n');
  const marks = banners(src);
  const out = [];
  marks.forEach((mark, i) => {
    if (!DEFERRED.includes(mark.name)) return;
    const end = marks[i + 1]?.line ?? lines.length;
    for (let n = mark.line; n < end; n += 1) out.push({ n, text: lines[n - 1] });
  });
  return out;
}

describe('the deferred families keep Codex\'s own radii until W6-CDX-43', () => {
  it('declares the three legacy radii in the shared block, at 4, 8 and 12px', () => {
    const resolved = (name) => resolveTokenValue(dark, name);
    expect(resolved('--cx-deferred-radius-sm')).toBe('4px');
    expect(resolved('--cx-deferred-radius-md')).toBe('8px');
    expect(resolved('--cx-deferred-radius-lg')).toBe('12px');
  });

  it('reads no core radius in a deferred banner', () => {
    const offenders = deferredLines().filter(({ text }) => /var\(--radius-(sm|md|lg)\)/.test(text));
    expect(offenders.map(({ n, text }) => `${n}: ${text.trim()}`)).toEqual([]);
  });

  it('is in use: the deferred banners read the legacy alias at least once', () => {
    expect(deferredLines().some(({ text }) => /var\(--cx-deferred-radius-(sm|md|lg)\)/.test(text))).toBe(true);
  });
});
