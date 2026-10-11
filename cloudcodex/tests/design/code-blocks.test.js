/**
 * Every syntax-highlighting colour measured on the code background it is painted on, over every surface
 *
 * A code block is a translucent black wash (the editor's `pre` and the code-block wrapper) over the
 * surface the editor or embed sits on, and each highlight.js token colour is painted on that. The
 * colours are read from the real `.hljs-*` declarations of src/index.css, and the wash is read from
 * the real `.editor-container .tiptap pre` declaration, composited over each of the five surfaces
 * (the strongest hover included) and measured with the vendored contrast gate. A revert of a hue to
 * the darker value, which measures 3.79:1 on the page's strongest surface, turns the named test red.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  compositeOver, contrastRatio, parseColor, parseThemeTokens, resolveTokenValue, round,
} from '../../vendor/cloud-city-design/gates/contrast.mjs';
import { ROOT } from './buckets.js';

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const core = read('vendor/cloud-city-design/core.css');
const codex = read('src/codex.css');
const index = read('src/index.css');
const tokens = parseThemeTokens(`${core}\n${codex}`).dark;

const SURFACES = ['--cx-surface-0', '--cx-surface-1', '--cx-surface-2', '--cx-surface-3', '--cx-surface-4'];

/** The value of one property in the last rule whose selector is exactly `selector`. */
function declared(selector, prop) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let value;
  for (const m of index.matchAll(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`, 'g'))) {
    for (const d of m[1].matchAll(/(?:^|;|\s)([a-z-]+)\s*:\s*([^;]+);/g)) {
      if (d[1] === prop) value = d[2].trim();
    }
  }
  if (value === undefined) throw new Error(`${selector} declares no ${prop} in src/index.css`);
  return value;
}

/** A literal rgba(r, g, b, a) as the gate's colour; the gate parses oklch and hex only. */
function rgba(value) {
  const m = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(value);
  if (!m) throw new Error(`${value} is not an rgba() literal`);
  return { r: m[1] / 255, g: m[2] / 255, b: m[3] / 255, alpha: Number(m[4]) };
}

/** The colour a token-or-literal paints, for the code wash and the surfaces. */
function paint(value) {
  const v = /^var\((--[\w-]+)\)$/.exec(value);
  if (v) return parseColor(resolveTokenValue(tokens, v[1]));
  if (value.startsWith('rgba(')) return rgba(value);
  return parseColor(value);
}

// Every highlight.js token rule in index.css: a selector list with one colour, read from its own declaration.
const HLJS = [...index.matchAll(/^((?:\.hljs[^{]*?))\{\s*color:\s*(#[0-9a-fA-F]{6})/gm)]
  .map((m) => ({ selectors: m[1].trim(), colour: m[2] }));

describe('the code wash is read from the real declaration, not from a copy of it', () => {
  it('declares the editor code block as a translucent black over the editor surface', () => {
    expect(declared('.editor-container .tiptap pre', 'background')).toBe('rgba(0, 0, 0, 0.25)');
    expect(paint(declared('.editor-container .tiptap pre', 'background')).alpha).toBeLessThan(1);
  });
});

describe('every highlight.js token colour is at 4.5:1 or more on the code wash, over every surface', () => {
  it('reads the token rules from src/index.css', () => {
    expect(HLJS.length).toBeGreaterThanOrEqual(8);
    expect(HLJS.map((r) => r.colour)).toContain('#78a763');
  });

  it.each(HLJS.map((r) => [r.selectors.replace(/\s+/g, ' '), r.colour]))('%s (%s)', (selectors, colour) => {
    const wash = paint(declared('.editor-container .tiptap pre', 'background'));
    const measured = [];
    for (const surface of SURFACES) {
      const flat = compositeOver(wash, paint(`var(${surface})`));
      const ratio = contrastRatio(parseColor(colour), flat);
      measured.push(ratio);
      expect(ratio, `${colour} on the code wash over ${surface} measures ${round(ratio)}:1`)
        .toBeGreaterThanOrEqual(4.5);
    }
    expect(measured.length).toBe(SURFACES.length);
  });
});
