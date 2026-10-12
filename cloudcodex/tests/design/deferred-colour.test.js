/**
 * The deferred families' colour, measured in use, in both themes (W6-CDX-43, colour only)
 *
 * Every rule of the editor canvas, comments, GitHub and read-only sections that sets a text colour is measured where
 * it paints: over its own background when it sets one (a translucent wash composited over the surface beneath), and
 * over each of the four surfaces otherwise. The minimum is 4.5:1, the AA text line, in dark and in daylight.
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
import { declaredNames } from '../../vendor/cloud-city-design/gates/dangling.mjs';
import { ROOT, THEME_NAMES, THEME_OPTIONS } from './buckets.js';
import { rulesOf, isDeferredRule } from './geometry.js';

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const core = read('vendor/cloud-city-design/core.css');
const codex = read('src/codex.css');
const index = read('src/index.css');
const bridgeBlock = /:root\s*\{([^}]*)\}/.exec(index)[1];
const themed = parseThemeTokens(`${core}\n${codex}\n:root {${bridgeBlock}}`, THEME_OPTIONS);
const SURFACES = ['--cx-surface-0', '--cx-surface-1', '--cx-surface-2', '--cx-select-wash'];
const MIN = 4.5;

/** A colour value (a var() chain, an rgba() literal, or a parsed colour), as the gate's colour; undefined if none. */
function colourOf(value, tokens) {
  // A token may name another token (a light binding that reads --cx-on-accent): follow the chain to a colour.
  let raw = value.trim();
  for (let i = 0; i < 8; i += 1) {
    const v = /^var\((--[\w-]+)\)$/.exec(raw);
    if (!v) break;
    raw = resolveTokenValue(tokens, v[1]);
    if (raw === undefined) return undefined;
  }
  if (raw === undefined) return undefined;
  const rgba = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(raw);
  if (rgba) return { r: rgba[1] / 255, g: rgba[2] / 255, b: rgba[3] / 255, alpha: Number(rgba[4]) };
  return parseColor(raw);
}

/** The declarations of a rule, as a name-to-value map (the last wins, as in CSS). */
function declarationsOf(body) {
  const map = new Map();
  for (const d of body.split(';')) {
    const i = d.indexOf(':');
    if (i < 0) continue;
    map.set(d.slice(0, i).trim().toLowerCase(), d.slice(i + 1).replace(/!important/i, '').trim().replace(/\s+/g, ' '));
  }
  return map;
}

// A comment tag's label comes from its kind modifier, which sets the fill, so it is measured where the fill is set (the
// kind test below). A presence label takes its colour from avatarLabel() inline, measured in presence-label.test.js.
const PAINTED_ELSEWHERE = ['.comment-tag', '.comment-tag-btn--active'];
const RULES = rulesOf(index).filter(isDeferredRule).map((rule) => ({ ...rule, decl: declarationsOf(rule.body) }));
const TEXT_RULES = RULES.filter((rule) => rule.decl.has('color') && /var\(--|rgba?\(|#/.test(rule.decl.get('color')))
  .filter((rule) => !PAINTED_ELSEWHERE.includes(rule.selector));

describe.each(THEME_NAMES)('deferred families, measured in use, %s theme', (theme) => {
  const tokens = themed[theme];

  it('reads the text rules of the deferred families (a real surface, not an empty loop)', () => {
    expect(TEXT_RULES.length).toBeGreaterThan(100);
  });

  it.each(TEXT_RULES.map((rule) => [`${rule.line} ${rule.selector}`, rule]))('%s clears 4.5:1 where it paints', (_, rule) => {
    const text = colourOf(rule.decl.get('color'), tokens);
    expect(text, `${rule.selector} colour ${rule.decl.get('color')}`).toBeDefined();
    const bgValue = rule.decl.get('background-color') ?? rule.decl.get('background');
    // A background that is a token or literal colour paints under the text; a gradient or a url() does not, and the
    // four surfaces stand in for it.
    const own = bgValue !== undefined && /^(var\(--|rgba?\(|#|oklch\()/.test(bgValue.trim())
      ? colourOf(bgValue.trim(), tokens) : undefined;
    // An opaque ground is measured once; a translucent wash, or no background, is measured over each surface beneath it.
    const beneath = own !== undefined && own.alpha >= 1 ? [null] : SURFACES;
    const measured = [];
    for (const surface of beneath) {
      const page = surface === null ? undefined : colourOf(`var(${surface})`, tokens);
      const ground = own === undefined ? page : (own.alpha >= 1 ? own : compositeOver(own, page));
      const ratio = contrastRatio(text, ground);
      measured.push(ratio);
      expect(ratio, `${rule.selector} (${rule.decl.get('color')}) on ${surface ?? 'its own background'} measures ${round(ratio)}:1`)
        .toBeGreaterThanOrEqual(MIN);
    }
    expect(measured.length).toBeGreaterThan(0);
  });
});

describe.each(THEME_NAMES)('a comment tag label on each kind, %s theme', (theme) => {
  const tokens = themed[theme];
  // The kind's own fill, read from its modifier rule, carries its label: the ink, or the note's own white, which
  // measures higher on the note's fill in dark (W6-CDX-43 review, item 5).
  const KINDS = ['comment', 'suggestion', 'question', 'issue', 'note'];
  it.each(KINDS)('%s: its label clears 4.5:1 on the kind fill', (kind) => {
    const fill = RULES.find((rule) => rule.selector === `.comment-tag--${kind}`);
    const bg = fill?.decl.get('background');
    expect(bg, `.comment-tag--${kind} background`).toBeDefined();
    const label = kind === 'note' ? 'var(--cx-deferred-note-label)' : 'var(--cx-deferred-tag-label)';
    const ratio = contrastRatio(colourOf(label, tokens), colourOf(bg, tokens));
    expect(ratio, `${kind} fill ${bg} with ${label} measures ${round(ratio)}:1`).toBeGreaterThanOrEqual(MIN);
  });
});

describe('the deferred bindings are declared once per theme and used', () => {
  const declaredIn = (block) => new Set(declaredNames(block));
  const dark = declaredIn(codex.slice(codex.indexOf("[data-theme='dark'] {"), codex.indexOf("[data-theme='light'] {")));
  const light = declaredIn(codex.slice(codex.indexOf("[data-theme='light'] {"), codex.indexOf('[data-theme=\'light\'][data-accent]')));
  // The radii are shared by both themes (the [data-theme] block), so they are not per-theme bindings.
  const all = declaredNames(codex).filter((n) => n.startsWith('--cx-deferred-') && !n.startsWith('--cx-deferred-radius-'));

  it('declares every --cx-deferred- binding in both themes', () => {
    expect(all.length).toBeGreaterThanOrEqual(60);
    expect(all.filter((n) => !dark.has(n) || !light.has(n))).toEqual([]);
  });

  it('reads every --cx-deferred- binding in the deferred sections, and nothing undeclared', () => {
    const used = new Set([...index.matchAll(/var\((--cx-deferred-[\w-]+)\)/g)].map((m) => m[1])
      .filter((n) => !n.startsWith('--cx-deferred-radius-')));
    expect(all.filter((n) => !used.has(n))).toEqual([]);
    expect([...used].filter((n) => !all.includes(n))).toEqual([]);
  });
});
