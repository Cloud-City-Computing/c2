/**
 * A label on a translucent tint, measured on the tint composited over every surface it can sit on
 *
 * A tint is a background behind a label, so the label is measured on the tint flattened onto each
 * surface the page paints, the strongest hover included, on the default accent and all eight picker
 * hues (the label may be the accent). Each site is read from the real declarations of src/index.css,
 * resolved through the bridge and codex.css, with the picker's values written over the accent names
 * as applyPrefsToDOM does. A revert of a tint to a bare rgba(), or a tint strong enough to sink its
 * label, turns the named test red.
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
import { ACCENTS, accentValue, accentFill, accentDark } from '../../src/tokens/accents.js';
import { ROOT } from './buckets.js';

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const core = read('vendor/cloud-city-design/core.css');
const codex = read('src/codex.css');
const index = read('src/index.css');
const bridgeBlock = /:root\s*\{([^}]*)\}/.exec(index)[1];
const base = parseThemeTokens(`${core}\n${codex}\n:root {${bridgeBlock}}`).dark;

/** The last value of one property in the last rule whose selector is exactly `selector`, as in painted.test.js. */
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

const onAccent = (hue) => ({
  ...base,
  '--cx-accent': accentValue(hue),
  '--cx-accent-fill': accentFill(hue),
  '--cx-accent-dark': accentDark(hue),
});
const ACCENT_TOKENS = [['default', base], ...Object.entries(ACCENTS).map(([name, hue]) => [name, onAccent(hue)])];

// The five surfaces a tint can sit on: the page, its panels, a hover and the strongest hover.
const SURFACES = ['--cx-surface-0', '--cx-surface-1', '--cx-surface-2', '--cx-surface-3', '--cx-surface-4'];

// [the site whose background is the tint, the site whose colour is the label]. Each site was
// a bare rgba() (or a literal label) before this burndown; the label is read from its own rule
// and, where the rule sets none (a hover), from the rule that does.
const TINTED = [
  ['.gh-merge-dialog__warn', '.gh-merge-dialog__warn'],
  ['.gh-code-embed__stale', '.gh-code-embed__stale'],
  ['.ci-badge--success', '.ci-badge--success'],
  ['.ci-badge--failure', '.ci-badge--failure'],
  ['.ci-badge--in_progress, .ci-badge--queued', '.ci-badge--in_progress, .ci-badge--queued'],
  ['.gh-reconnect-banner', '.gh-reconnect-banner'],
  ['.btn-fav-filter--active', '.btn-fav-filter--active'],
  ['.btn-clear-filters', '.btn-clear-filters'],
  ['.btn-clear-filters:hover', '.btn-clear-filters'],
  ['.explore-badge--content', '.explore-badge--content'],
  ['.explore-badge--title', '.explore-badge--title'],
  ['.btn-filter-toggle--active', '.btn-filter-toggle--active'],
  ['.explore-match', '.explore-match'],
  ['.log-tree-add:hover', '.log-tree-add'],
  ['.log-tree-delete:hover', '.log-tree-delete'],
  ['.page-tree-back-btn:hover', '.page-tree-back-btn:hover'],
  ['.page-tree-add-btn:hover', '.page-tree-add-btn'],
  ['.page-tree-row--active', '.page-tree-row--active'],
  ['.page-tree-row--active:hover', '.page-tree-row--active'],
  ['.page-tree-row-add:hover', '.page-tree-row-add'],
];

describe('every translucent tint is a --cx- binding, never a bare rgba()', () => {
  it.each(TINTED)('%s paints its background from a --cx-tint- name', (bgSite) => {
    expect(declared(bgSite, 'background'), bgSite).toMatch(/^var\(--cx-tint-[\w-]+\)$/);
  });

  it('declares each tint in codex.css as a translucent colour the gate can read', () => {
    for (const [bgSite] of TINTED) {
      const name = /var\((--[\w-]+)\)/.exec(declared(bgSite, 'background'))[1];
      expect(parseColor(resolveTokenValue(base, name)), `${name} is not a translucent colour`).toBeDefined();
      expect(parseColor(resolveTokenValue(base, name)).alpha, `${name} is opaque`).toBeLessThan(1);
    }
  });
});

describe('a label on a tint is at 4.5:1 or more on the tint over every surface, on every accent', () => {
  it.each(TINTED)('%s over %s', (bgSite, labelSite) => {
    const measured = [];
    for (const [name, tokens] of ACCENT_TOKENS) {
      const tint = paint(declared(bgSite, 'background'), tokens);
      const label = paint(declared(labelSite, 'color'), tokens);
      for (const surface of SURFACES) {
        const flat = compositeOver(tint, paint(`var(${surface})`, tokens));
        const ratio = contrastRatio(label, flat);
        measured.push(ratio);
        expect(ratio, `${bgSite} label on ${surface} (${name}) measures ${round(ratio)}:1`)
          .toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(measured.length).toBe(ACCENT_TOKENS.length * SURFACES.length);
  });

  it('measures every site, so the list cannot quietly shrink', () => {
    expect(TINTED.length).toBeGreaterThanOrEqual(20);
  });
});
