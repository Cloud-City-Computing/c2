/**
 * The top bar is opaque: page text must never show through it when the page scrolls under it.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseThemeTokens, resolveTokenValue } from '../../vendor/cloud-city-design/gates/contrast.mjs';
import { ROOT, THEME_OPTIONS } from './buckets.js';

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const dark = parseThemeTokens(`${read('vendor/cloud-city-design/core.css')}\n${read('src/codex.css')}`, THEME_OPTIONS).dark;
const index = read('src/index.css').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

function topbarRule() {
  const m = [...index.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((r) => r[1].trim() === '.topbar');
  expect(m.length, 'one .topbar rule').toBeGreaterThan(0);
  return m.map((r) => r[2]).join(';');
}

describe('the top bar is opaque', () => {
  it('paints a background from an opaque token, not a translucent one', () => {
    const bg = /background:\s*([^;]+);/.exec(topbarRule())?.[1].trim();
    expect(bg).toBe('var(--bg-elevated)');
    // The bridge maps --bg-elevated to --cx-surface-1 (index.css :root), a bare oklch with no alpha.
    expect(/--bg-elevated:\s*var\(--cx-surface-1\)/.test(index)).toBe(true);
    const literal = resolveTokenValue(dark, '--cx-surface-1') ?? '';
    // Any "/ x" or rgba() in the literal would make the bar translucent.
    expect(literal).toMatch(/^oklch\([^/()]*\)$/);
    expect(literal).not.toMatch(/\/|transparent|rgba/);
  });

  it('declares no opacity or translucent background on the bar', () => {
    expect(topbarRule()).not.toMatch(/opacity\s*:\s*(0?\.\d+)/);
  });
});
