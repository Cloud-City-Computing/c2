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
import {
  ACCENTS, accentValue, accentHover, accentFill, accentDark,
} from '../../src/tokens/accents.js';
import { ROOT, THEME_OPTIONS } from './buckets.js';

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const core = read('vendor/cloud-city-design/core.css');
const codex = read('src/codex.css');
const index = read('src/index.css');
const bridgeBlock = /:root\s*\{([^}]*)\}/.exec(index)[1];
const base = parseThemeTokens(`${core}\n${codex}\n:root {${bridgeBlock}}`, THEME_OPTIONS).dark;

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
  '--cx-accent-hover': accentHover(hue),
  '--cx-accent-fill': accentFill(hue),
  '--cx-accent-dark': accentDark(hue),
});
const ACCENT_TOKENS = [['default', base], ...Object.entries(ACCENTS).map(([name, hue]) => [name, onAccent(hue)])];

// The five surfaces a tint can sit on: the page, its panels, a hover and the strongest hover.
const SURFACES = ['--cx-surface-0', '--cx-surface-1', '--cx-surface-2', '--cx-select-wash'];

/** Every rule of src/index.css as { selector, body }: comments blanked, at-rule headers skipped. */
const RULES = (() => {
  const css = index.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((m) => ({ selector: m[1].replace(/\s+/g, ' ').trim(), body: m[2] }))
    .filter((r) => !r.selector.startsWith('@'));
})();

/** The last value a rule declares for one property, or undefined. */
function ruleValue(selector, prop) {
  let value;
  for (const r of RULES) {
    if (r.selector !== selector) continue;
    for (const d of r.body.matchAll(/(?:^|;|\s)([a-z-]+)\s*:\s*([^;]+);/g)) if (d[1] === prop) value = d[2].trim();
  }
  return value;
}

/** A selector with its pseudo-classes stripped, so a hover names the element whose colour it inherits. */
const bareSelector = (sel) => sel.split(',').map((s) => s.replace(/:[a-z-]+(\([^)]*\))?/g, '').trim()).join(', ');

// The label where neither the rule nor its bare element sets a colour: the text colour the element
// inherits from its body. Each entry is measured like any other label, so the inheritance is checked.
const INHERITED_LABELS = {
  '.user-search__item:hover': 'var(--cx-text-primary)',
  '.tfa-method-option.active': 'var(--cx-text-primary)',
  // The unread modifier sets the wash on the row, and its text is the row's own colour.
  '.notification-item--unread': '.notification-item',
  '.notification-item--unread:hover': '.notification-item',
  // The picked commit option: its label is the body text colour the element inherits (the GitHub surface, colour only).
  '.gh-commit-option.active': 'var(--cx-text-primary)',
  // A selected table cell in the editor: its text is the editor's body colour, measured as an inherited label.
  '.editor-container .tiptap table .selectedCell': 'var(--cx-text-primary)',
};

// The translucent backgrounds the deferred families still paint bare: the GitHub surface (GitHubPage,
// the .gh-* block), the editor canvas (.tiptap chips, toolbar, the editor status and code language badge),
// the comments (the selection and quote), the read-only document and the Version History badge. Each waits
// for the roadmap's UI-later row, and each must be converted with its family. A new bare wash outside this
// list fails the test above.
const DEFERRED_BARE = [
  '.mention', '.gh-export-banner', '.gh-import-source__path', '.gh-btn-danger-ghost:hover',
  '.gh-history__commit-sha code', '.gh-history__full-msg', '.gh-history__file-status--added',
  '.gh-history__file-status--modified', '.gh-history__file-status--removed', '.gh-history__file-status--renamed',
  '.gh-file-actions .btn.active', '.gh-pr-badge--open', '.gh-pr-badge--closed', '.gh-pr-badge--merged',
  '.gh-diff__hunk-header', '.gh-history__detail-actions .btn.active', '.editor-status.success',
  '.editor-status.error', '.tiptap-toolbar__btn:hover', '.tiptap-toolbar__btn--active', '.resize-badge',
  '.markdown-editor__rendered blockquote', '.version-list__badge', '.comment-thread__selection',
  '.comment-manager__item-quote', '.document-readonly blockquote', '.code-lang-badge', '.document-readonly code',
];

// Every rule that paints a --cx-tint- wash behind its element, with the label that sits on it. Derived
// from the stylesheet, so a new wash with a label is measured without being listed here.
const TINT_SITES = RULES
  .filter((r) => /(?:^|[;\s])background(?:-color)?\s*:\s*var\(--cx-tint-[\w-]+\)/.test(r.body))
  .map((r) => {
    const inherited = INHERITED_LABELS[r.selector];
    const label = ruleValue(r.selector, 'color') ?? ruleValue(bareSelector(r.selector), 'color')
      ?? (inherited?.startsWith('.') ? ruleValue(inherited, 'color') : inherited);
    if (label === undefined) throw new Error(`${r.selector}: no label rule and no inherited-label entry`);
    const bgProp = /(?:^|[;\s])background-color\s*:/.test(r.body) ? 'background-color' : 'background';
    return { site: r.selector, label, bgProp };
  });

describe('every wash behind a label is a --cx- tint, derived from the stylesheet', () => {
  it('finds every wash-bearing rule, so the derived list cannot quietly shrink', () => {
    expect(TINT_SITES.length).toBeGreaterThanOrEqual(45);
  });

  it('names no bare translucent background on an element that sets a colour, outside the deferred families', () => {
    const bare = RULES
      .filter((r) => /(?:^|[;\s])background(?:-color)?\s*:\s*(rgba?\(|oklch\([^)]*\/)/.test(r.body))
      .filter((r) => ruleValue(r.selector, 'color') !== undefined)
      .map((r) => r.selector);
    expect(bare.filter((sel) => !DEFERRED_BARE.includes(sel)),
      'a translucent background must be a --cx-tint- name (or join DEFERRED_BARE with a reason)').toEqual([]);
    expect(DEFERRED_BARE.filter((sel) => !bare.includes(sel)), 'a DEFERRED_BARE entry no longer paints bare').toEqual([]);
  });

  it('declares each wash in codex.css as a translucent colour the gate can read', () => {
    for (const { site, bgProp } of TINT_SITES) {
      const name = /var\((--[\w-]+)\)/.exec(ruleValue(site, bgProp))[1];
      const colour = parseColor(resolveTokenValue(base, name));
      expect(colour, `${name} is not a translucent colour`).toBeDefined();
      expect(colour.alpha, `${name} is opaque`).toBeLessThan(1);
    }
  });
});

describe('a label on a wash is at 4.5:1 or more on the wash over every surface, on every accent', () => {
  it.each(TINT_SITES.map((t) => [t.site, t.label, t.bgProp]))('%s', (site, label, bgProp) => {
    const measured = [];
    for (const [name, tokens] of ACCENT_TOKENS) {
      const tint = paint(ruleValue(site, bgProp), tokens);
      const text = paint(label, tokens);
      for (const surface of SURFACES) {
        const flat = compositeOver(tint, paint(`var(${surface})`, tokens));
        const ratio = contrastRatio(text, flat);
        measured.push(ratio);
        expect(ratio, `${site} label on ${surface} (${name}) measures ${round(ratio)}:1`).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(measured.length).toBe(ACCENT_TOKENS.length * SURFACES.length);
  });
});

describe('a label on a solid accent fill is at 4.5:1 or more on every accent', () => {
  it('the owner role badge is the accent fill with the on-accent label, not a white label on the pale accent', () => {
    for (const [name, tokens] of ACCENT_TOKENS) {
      const fill = paint(declared('.role-badge--owner', 'background'), tokens);
      const label = paint(declared('.role-badge--owner', 'color'), tokens);
      const ratio = contrastRatio(label, fill);
      expect(ratio, `.role-badge--owner (${name}) measures ${round(ratio)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('the info badge is the fixed info step, so it does not change hue with the accent', () => {
  it('.badge-info labels in --cx-info-bright, which reads the package accent step and not the picker', () => {
    expect(declared('.badge-info', 'color')).toBe('var(--cx-info-bright)');
  });
});
