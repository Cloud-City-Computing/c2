/**
 * Every hover background in the deferred families differs visibly from the surface beneath it, in both themes
 * (W6-CDX-43 review, item 8). The step is the composited lightness difference (oklab L) against each surface the hover
 * can sit on; the smallest must be 0.025 or more. A light wash at 1 or 2 percent ink was invisible (0.01).
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { compositeOver, parseColor, parseThemeTokens, resolveTokenValue } from '../../vendor/cloud-city-design/gates/contrast.mjs';
import { ROOT, THEME_NAMES, THEME_OPTIONS } from './buckets.js';
import { rulesOf, isDeferredRule } from './geometry.js';

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const index = read('src/index.css');
const bridge = /:root\s*\{([^}]*)\}/.exec(index)[1];
const themed = parseThemeTokens(`${read('vendor/cloud-city-design/core.css')}\n${read('src/codex.css')}\n:root {${bridge}}`, THEME_OPTIONS);
const SURFACES = ['--cx-surface-0', '--cx-surface-1', '--cx-surface-2', '--cx-select-wash'];
const MIN_STEP = 0.025;

const lin = (x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
/** oklab lightness of a colour, the perceptual scale the step is measured on. */
function lightness({ r, g, b }) {
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
}
function colourOf(value, tokens) {
  let raw = value.trim();
  for (let i = 0; i < 8; i += 1) {
    const v = /^var\((--[\w-]+)\)$/.exec(raw);
    if (!v) break;
    raw = resolveTokenValue(tokens, v[1]);
    if (raw === undefined) return undefined;
  }
  const rgba = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(raw);
  if (rgba) return { r: rgba[1] / 255, g: rgba[2] / 255, b: rgba[3] / 255, alpha: Number(rgba[4]) };
  return parseColor(raw);
}

const HOVERS = rulesOf(index).filter(isDeferredRule).filter((rule) => /:hover/.test(rule.selector))
  .map((rule) => {
    const m = /(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/.exec(rule.body);
    return m ? { ...rule, value: m[1].replace(/!important/i, '').trim() } : null;
  })
  .filter((rule) => rule && /var\(--cx-deferred-|rgba|oklch/.test(rule.value));

describe.each(THEME_NAMES)('the deferred hovers step visibly from their surface, %s theme', (theme) => {
  const tokens = themed[theme];
  it('reads the translucent hover backgrounds of the deferred families (a real set)', () => {
    expect(HOVERS.length).toBeGreaterThan(10);
  });
  it.each(HOVERS.map((rule) => [`${rule.line} ${rule.selector}`, rule]))('%s', (_, rule) => {
    const hover = colourOf(rule.value, tokens);
    expect(hover, rule.value).toBeDefined();
    const steps = SURFACES.map((surface) => {
      const page = colourOf(`var(${surface})`, tokens);
      const ground = hover.alpha >= 1 ? hover : compositeOver(hover, page);
      return Math.abs(lightness(ground) - lightness(page));
    });
    expect(Math.min(...steps), `${rule.selector} steps ${Math.min(...steps).toFixed(4)} from its surface`).toBeGreaterThanOrEqual(MIN_STEP);
  });
});
