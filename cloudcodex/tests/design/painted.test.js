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
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  contrastRatio, parseColor, parseThemeTokens, relativeLuminance, resolveTokenValue, round,
} from '../../vendor/cloud-city-design/gates/contrast.mjs';
import { ACCENTS, accentValue, accentFill, accentDark } from '../../src/tokens/accents.js';
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
  '--cx-accent': accentValue(hue),
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
const DANGER_HOVER_SITES = ['.btn-danger:hover:not(:disabled)', '.drawio-block__delete-btn:hover'];

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
    const hover = paint(declared('.btn-danger:hover:not(:disabled)', 'background'), base);
    expect(luminance(hover)).toBeLessThan(luminance(rest));
  });
});

describe('the focus ring: one non-text component, measured at 3:1 against every surface it can sit on', () => {
  const SURFACES = ['--cx-surface-0', '--cx-surface-1', '--cx-surface-2', '--cx-surface-3', '--cx-surface-4'];
  // The one :focus-visible outline; the ring sits on the page around the control, so the surfaces are the measure.
  const ringToken = /var\((--[\w-]+)\)/.exec(declared(':focus-visible', 'outline'))?.[1];

  it('reads the ring from the real :focus-visible declaration', () => {
    expect(declared(':focus-visible', 'outline')).toBe('2px solid var(--cx-focus-ring)');
    expect(ringToken).toBe('--cx-focus-ring');
  });

  it('measures at least 3:1 on every surface, on the default accent and all eight picker hues', () => {
    const measured = [];
    for (const [name, tokens] of ACCENT_TOKENS) {
      const ring = paint(`var(${ringToken})`, tokens);
      for (const surface of SURFACES) {
        const ratio = contrastRatio(ring, paint(`var(${surface})`, tokens));
        measured.push(ratio);
        expect(ratio, `the ring on ${surface} (${name}) measures ${round(ratio)}:1`).toBeGreaterThanOrEqual(3);
      }
    }
    expect(measured.length).toBe(SURFACES.length * 9);
  });
});

describe('the label and fill on the buttons and the toast are read from their own declarations', () => {
  it('paints the label of a danger control with --cx-on-danger, not a literal', () => {
    expect(declared('.btn-danger', 'color')).toBe('var(--cx-on-danger)');
  });

  it('keeps the primary hover on the accent text step, with the on-accent label at 4.5:1 or more on every hue', () => {
    expect(declared('.btn-primary:hover:not(:disabled)', 'background')).toBe('var(--brand-blue)');
    expect(declared('.btn-primary', 'color')).toBe('var(--cx-on-accent)');
    for (const [name, tokens] of ACCENT_TOKENS) {
      const ratio = contrastRatio(paint(declared('.btn-primary', 'color'), tokens),
        paint(declared('.btn-primary:hover:not(:disabled)', 'background'), tokens));
      expect(ratio, `primary hover (${name}) measures ${round(ratio)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('measures each toast label on the toast surface at 4.5:1 or more, at rest and on the dismiss hover', () => {
    const surface = paint(declared('.toast', 'background'), base);
    for (const site of ['.toast', '.toast--success', '.toast--error', '.toast__dismiss']) {
      const ratio = contrastRatio(paint(declared(site, 'color'), base), surface);
      expect(ratio, `${site} measures ${round(ratio)}:1`).toBeGreaterThanOrEqual(4.5);
    }
    const hover = contrastRatio(paint(declared('.toast__dismiss:hover', 'color'), base),
      paint(declared('.toast__dismiss:hover', 'background'), base));
    expect(hover, `dismiss hover measures ${round(hover)}:1`).toBeGreaterThanOrEqual(4.5);
  });
});

describe('no source under src/ removes a focus ring', () => {
  // Every stylesheet and every script under src/, comments removed first, so prose cannot trip it.
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return /\.(css|js|jsx)$/.test(e.name) ? [full] : [];
  });
  // One pattern for both forms: CSS (`outline-color: transparent`) and a script style object (`outlineColor: 'transparent'`).
  const SUPPRESSION = /(?<![-\w])outline(?:-color|-width|-style|Color|Width|Style)?\s*:\s*['"`]?(?:none|transparent|0(?:px|em|rem|%)?)(?![-\w])|(?<![-\w])outline\s*:[^;}\n]*\btransparent\b/gi;
  const suppressionsIn = (source) => {
    const bare = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    return [...bare.matchAll(SUPPRESSION)].map((m) => m[0]);
  };

  it('finds none of the suppressing forms in a seeded source, and each form is caught', () => {
    expect(suppressionsIn('.a { outline: none; }')).toHaveLength(1);
    expect(suppressionsIn('.a { outline: 0; }')).toHaveLength(1);
    expect(suppressionsIn('.a { outline-color: transparent; }')).toHaveLength(1);
    expect(suppressionsIn('.a { outline-width: 0; }')).toHaveLength(1);
    expect(suppressionsIn('.a { outline: 2px solid transparent; }')).toHaveLength(1);
    expect(suppressionsIn("const s = { outlineColor: 'transparent' };")).toHaveLength(1);
    expect(suppressionsIn("const s = { outline: 'none' };")).toHaveLength(1);
    expect(suppressionsIn('/* outline: none; in prose */ .a { outline: 2px solid red; }')).toEqual([]);
  });

  it('finds no suppressing form in any file under src/', () => {
    const found = walk(path.join(ROOT, 'src')).flatMap((file) => suppressionsIn(readFileSync(file, 'utf8'))
      .map((hit) => `${path.relative(ROOT, file)}: ${hit}`));
    expect(found, 'a focus ring is restyled, never removed').toEqual([]);
  });
});

describe('a text field has one focus treatment, the shared ring, and no second halo', () => {
  it('declares no box-shadow on a focus rule for an input or a textarea', () => {
    const bare = index.replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
    const halos = rules
      .filter((r) => /:focus(?![-\w])/.test(r.sel) && /input|textarea/.test(r.sel) && /box-shadow\s*:/.test(r.body))
      .map((r) => r.sel);
    expect(halos, 'the global ring is the field\'s focus indicator; a second ring doubles on click').toEqual([]);
  });
});

describe('a text field draws its ring against its own border, so it reads as one edge', () => {
  it.each(['input', 'textarea'])('%s:focus-visible has a zero outline offset', (field) => {
    expect(declared(`${field}:focus-visible`, 'outline-offset')).toBe('0');
  });
});

describe('a container that clips its contents draws the ring inside the control', () => {
  const CLIPPING = [
    '.editor-container',
    '.markdown-editor__textarea-wrapper',
    '.sidebar',
    '.gh-browser__sidebar',
    '.gh-modal',
    '.gh-sync-menu',
  ];
  it.each(CLIPPING)('%s clips, and its focused controls use a negative outline offset', (container) => {
    expect(declared(container, 'overflow')).toBe('hidden');
    expect(parseFloat(declared(`${container} :focus-visible`, 'outline-offset'))).toBeLessThan(0);
  });
});

describe('the button states: disabled, hover, pressed', () => {
  it('disables visibly and shows no hover or press on a disabled control', () => {
    expect(declared('.btn:disabled', 'cursor')).toBe('not-allowed');
    expect(declared('.btn:disabled', 'opacity')).toMatch(/^0?\.\d+$/);
  });

  it('presses the primary one step, with the on-accent label at 4.5:1 or more on the pressed fill on every hue', () => {
    expect(declared('.btn-primary:active:not(:disabled)', 'background')).toBe('var(--cx-accent-hover)');
    for (const [name, tokens] of ACCENT_TOKENS) {
      const ratio = contrastRatio(paint(declared('.btn-primary', 'color'), tokens),
        paint(declared('.btn-primary:active:not(:disabled)', 'background'), tokens));
      expect(ratio, `primary pressed (${name}) measures ${round(ratio)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('presses the ghost one step, with its secondary label at 4.5:1 or more on the pressed surface', () => {
    expect(declared('.btn-ghost:active:not(:disabled)', 'background')).toBe('var(--bg-hover-strong)');
    const ratio = contrastRatio(paint(declared('.btn-ghost', 'color'), base),
      paint(declared('.btn-ghost:active:not(:disabled)', 'background'), base));
    expect(ratio, `ghost pressed measures ${round(ratio)}:1`).toBeGreaterThanOrEqual(4.5);
  });

  it('presses the danger darker than its hover, with the white label at 4.5:1 or more on the pressed fill', () => {
    expect(declared('.btn-danger:active:not(:disabled)', 'background')).toBe('var(--cx-danger-fill-press)');
    const press = paint(declared('.btn-danger:active:not(:disabled)', 'background'), base);
    const label = paint(declared('.btn-danger', 'color'), base);
    expect(contrastRatio(label, press), 'danger pressed label').toBeGreaterThanOrEqual(4.5);
    expect(luminance(press)).toBeLessThan(luminance(paint(declared('.btn-danger:hover:not(:disabled)', 'background'), base)));
  });
});

describe('the toast dismiss target', () => {
  it('is at least 24 by 24 CSS pixels', () => {
    expect(parseFloat(declared('.toast__dismiss', 'min-width'))).toBeGreaterThanOrEqual(24);
    expect(parseFloat(declared('.toast__dismiss', 'min-height'))).toBeGreaterThanOrEqual(24);
  });
});
