/**
 * The sidebar is opaque: page text must never show through it. It is the one full-height column of the shell
 * (W6-CDX-40, replacing the top bar, whose opacity test this file was).
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseThemeTokens, resolveTokenValue } from '../../vendor/cloud-city-design/gates/contrast.mjs';
import { ROOT, THEME_OPTIONS, THEME_NAMES } from './buckets.js';

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const themed = parseThemeTokens(`${read('vendor/cloud-city-design/core.css')}\n${read('src/codex.css')}`, THEME_OPTIONS);
describe.each(THEME_NAMES)('%s theme', (theme) => {
  const dark = themed[theme];

  const index = read('src/index.css').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

  function sidebarRule() {
    const m = [...index.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((r) => r[1].trim() === '.sidebar');
    expect(m.length, 'one top-level .sidebar rule').toBeGreaterThan(0);
    return m[0][2];
  }

  describe('the sidebar is opaque', () => {
    it('paints a background from an opaque token, not a translucent one', () => {
      const bg = /background:\s*([^;]+);/.exec(sidebarRule())?.[1].trim();
      expect(bg).toBe('var(--cx-surface-1)');
      const literal = resolveTokenValue(dark, '--cx-surface-1') ?? '';
      expect(literal).toMatch(/^oklch\([^/()]*\)$/);
      expect(literal).not.toMatch(/\/|transparent|rgba/);
    });

    it('declares no opacity on the column', () => {
      expect(sidebarRule()).not.toMatch(/opacity\s*:\s*(0?\.\d+)/);
    });
  });
});
