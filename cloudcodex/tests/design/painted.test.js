/**
 * The colours a label is painted in, measured on the fill the page paints behind it.
 *
 * Each site is read from the real declarations of src/index.css, resolved through the
 * bridge and codex.css (with the picker's values written over the three accent names,
 * as applyPrefsToDOM does), and measured with the vendored contrast gate. A revert of
 * the fix (a #fff label back on the pale fill, a hover that is no darker than rest)
 * turns the named test red.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  contrastRatio, parseColor, parseThemeTokens, relativeLuminance, resolveTokenValue, round,
} from '../../vendor/cloud-city-design/gates/contrast.mjs';
import { ACCENTS, accentFill, accentDark } from '../../src/tokens/accents.js';
import { ROOT } from './buckets.js';

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const core = read('vendor/cloud-city-design/core.css');
const codex = read('src/codex.css');
const index = read('src/index.css');
// The bridge is the first :root block of index.css; its names join the dark map so a chain can follow them.
const bridgeBlock = /:root\s*\{([^}]*)\}/.exec(index)[1];
const base = parseThemeTokens(`${core}\n${codex}\n:root {${bridgeBlock}}`).dark;

/** The last value of one property in the last rule whose selector is exactly `selector`. */
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

/** The colour a declared value paints: a var() is followed through the tokens, a literal is parsed. */
function paint(value, tokens) {
  const v = /^var\((--[\w-]+)\)$/.exec(value);
  const raw = v ? resolveTokenValue(tokens, v[1]) : value;
  const colour = parseColor(raw);
  if (colour === undefined) throw new Error(`${value} does not paint a colour`);
  return colour;
}

/** A site's label colour: its own colour declaration, or the danger button's where the rule only sets a background. */
function labelOf(site) {
  try {
    return declared(site, 'color');
  } catch {
    return declared('.btn-danger', 'color');
  }
}
const onAccent = (hue) => ({
  ...base,
  '--cx-accent-fill': accentFill(hue),
  '--cx-accent-dark': accentDark(hue),
});
// The default accent (no inline override) and each of the eight picker hues.
const ACCENT_TOKENS = [['default', base], ...Object.entries(ACCENTS).map(([name, hue]) => [name, onAccent(hue)])];
const luminance = (colour) => relativeLuminance(colour);

// Sites where a label sits on the accent fill (the primary ink, the active and hover states).
const ACCENT_FILL_SITES = [
  '.btn-primary',
  '.pref-toggle-btn.active',
  '.explore-pagination__num--active',
  '.explore-pagination__num--active:hover',
  '.drawio-block__edit-btn:hover:not(:disabled)',
];
// Sites where a white label sits on the accent dark (avatar initials).
const ACCENT_DARK_SITES = [
  '.mention-picker__avatar--placeholder',
  '.notification-item__avatar--placeholder',
  '.activity-item__avatar--placeholder',
];
// Sites where a white label sits on a danger background, at rest and on hover.
const DANGER_REST_SITES = ['.btn-danger', '.notification-bell__badge', '.btn-ghost.btn-danger:hover'];
const DANGER_HOVER_SITES = ['.btn-danger:hover', '.drawio-block__delete-btn:hover'];

describe('a label on the accent fill is measured in the colour the page paints', () => {
  it('reads each site from the real declarations, with the label and the fill both named', () => {
    for (const site of ACCENT_FILL_SITES) {
      expect(declared(site, 'background'), site).toBe('var(--brand-blue-hover)');
      expect(declared(site, 'color'), site).toMatch(/^var\(--cx-on-accent\)$/);
    }
  });

  it('measures at least 4.5:1 for every site on the default accent and all eight picker hues', () => {
    const measured = [];
    for (const site of ACCENT_FILL_SITES) {
      const label = paint(declared(site, 'color'), base);
      for (const [name, tokens] of ACCENT_TOKENS) {
        const fill = paint(declared(site, 'background'), tokens);
        const ratio = contrastRatio(label, fill);
        measured.push(ratio);
        expect(ratio, `${site} on ${name} measures ${round(ratio)}:1`).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(measured.length).toBe(ACCENT_FILL_SITES.length * 9);
  });
});

describe('a white label on the accent dark is measured on the avatar that paints it', () => {
  it('reads each avatar site from the real declarations', () => {
    for (const site of ACCENT_DARK_SITES) {
      expect(declared(site, 'background'), site).toBe('var(--brand-blue-dark)');
      expect(declared(site, 'color'), site).toBe('#fff');
    }
  });

  it('measures at least 4.5:1 for every avatar on the default accent and all eight picker hues', () => {
    const measured = [];
    for (const site of ACCENT_DARK_SITES) {
      for (const [name, tokens] of ACCENT_TOKENS) {
        const ratio = contrastRatio(paint(labelOf(site), tokens), paint(declared(site, 'background'), tokens));
        measured.push(ratio);
        expect(ratio, `${site} on ${name} measures ${round(ratio)}:1`).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(measured.length).toBe(ACCENT_DARK_SITES.length * 9);
  });

  it('moves with the picked accent: the dark step differs from the default and follows the hue', () => {
    const def = paint(declared(ACCENT_DARK_SITES[0], 'background'), base);
    const coral = paint(declared(ACCENT_DARK_SITES[0], 'background'), onAccent(ACCENTS.coral));
    expect(coral).not.toEqual(def);
  });
});

describe('a white label on a danger background', () => {
  it('measures at least 4.5:1 at rest', () => {
    for (const site of DANGER_REST_SITES) {
      const ratio = contrastRatio(paint(labelOf(site), base), paint(declared(site, 'background'), base));
      expect(ratio, `${site} measures ${round(ratio)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('measures at least 4.5:1 on hover, and the hover is darker than the rest it replaces', () => {
    for (const site of DANGER_HOVER_SITES) {
      const ratio = contrastRatio(paint(labelOf(site), base), paint(declared(site, 'background'), base));
      expect(ratio, `${site} measures ${round(ratio)}:1`).toBeGreaterThanOrEqual(4.5);
    }
    const rest = paint(declared('.btn-danger', 'background'), base);
    const hover = paint(declared('.btn-danger:hover', 'background'), base);
    expect(luminance(hover)).toBeLessThan(luminance(rest));
  });
});
