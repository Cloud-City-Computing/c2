/**
 * W6-CDX-39 (A2), the buttons on the suite pattern's anatomy: 30 px high, --radius-md, 13 px at weight 500,
 * no letter-spacing, the primary on --cx-accent-fill with the dark ink and a hover step that differs from
 * rest, the secondary on a 1 px --cx-border-strong. The anatomy is one rule scoped away from the deferred
 * families (comments, the editor and its toolbars, Markdown, Draw.io, Version History, GitHub), whose
 * buttons keep their metrics until W6-CDX-43 (K3: no geometry change there).
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  contrastRatio, parseColor, parseThemeTokens, resolveTokenValue, round,
} from '../../vendor/cloud-city-design/gates/contrast.mjs';
import { ROOT, THEME_OPTIONS, THEME_NAMES } from './buckets.js';

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const core = read('vendor/cloud-city-design/core.css');
const codex = read('src/codex.css');
const index = read('src/index.css').replace(/\/\*[\s\S]*?\*\//g, '');
const bridgeBlock = /:root\s*\{([^}]*)\}/.exec(index)[1];
const themed = parseThemeTokens(`${core}\n${codex}\n:root {${bridgeBlock}}`, THEME_OPTIONS);
describe.each(THEME_NAMES)('%s theme', (theme) => {
  const tokens = themed[theme];


  const rules = [...index.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1].split(',').map((s) => s.trim()),
    body: m[2],
  }));

  /** The last declared value of one property in the last rule whose selector list contains `selector` exactly. */
  function declared(selector, prop) {
    let value;
    for (const r of rules) {
      if (!r.selectors.includes(selector)) continue;
      for (const d of r.body.matchAll(/(?:^|;|\s)([a-z-]+)\s*:\s*([^;]+);/g)) {
        if (d[1] === prop) value = d[2].trim();
      }
    }
    if (value === undefined) throw new Error(`${selector} declares no ${prop}`);
    return value;
  }

  /** The anatomy rule: the one whose selector starts with `.btn:not(` and carries the height. */
  const anatomy = rules.find((r) => r.selectors.some((s) => s.startsWith('.btn:not(')) && /min-height:\s*30px/.test(r.body));

  function paint(value) {
    const v = /^var\((--[\w-]+)\)$/.exec(value);
    const raw = v ? resolveTokenValue(tokens, v[1]) : value;
    const colour = parseColor(raw);
    if (colour === undefined) throw new Error(`${value} does not paint a colour`);
    return colour;
  }

  describe('the button anatomy (A2, Task 2.2)', () => {
    it('has one rule for the anatomy, scoped away from the deferred families', () => {
      expect(anatomy, 'the .btn:not(...) anatomy rule').toBeDefined();
      const selector = anatomy.selectors.join(' ');
      for (const scope of ['.comment-manager *', '.editor-container *', '.tiptap-toolbar *', '.version-history *',
        '.drawio-block *', '.document-readonly *', '[class*="gh-"] *']) {
        expect(selector, `scope ${scope}`).toContain(scope);
      }
    });

    it('sets a 30 px minimum height (a label that grows must not be clipped), --radius-md, 13 px text at weight 500, and no letter-spacing', () => {
      expect(anatomy.body).toMatch(/min-height:\s*30px/);
      expect(anatomy.body).not.toMatch(/(^|[;\s])height:\s*30px/);
      expect(anatomy.body).toMatch(/border-radius:\s*var\(--radius-md\)/);
      expect(anatomy.body).toMatch(/font-size:\s*var\(--text-sm\)/);
      expect(anatomy.body).toMatch(/font-weight:\s*500/);
      expect(anatomy.body).toMatch(/letter-spacing:\s*normal/);
    });

    it('keeps the 12 px horizontal padding of the pattern', () => {
      expect(anatomy.body).toMatch(/padding:\s*0\s+var\(--space-3\)/);
    });
  });

  describe('the small button keeps its smaller size under the anatomy (A2)', () => {
    // .btn-sm sits on about a hundred controls; the (0,2,0) anatomy would otherwise override its 12 px text.
    const small = rules.find((r) => r.selectors.some((s) => s.startsWith('.btn.btn-sm:not(')));
    it('has a rule of higher specificity than the anatomy, at 26 px and 12 px text', () => {
      expect(small, 'the .btn.btn-sm:not(...) rule').toBeDefined();
      expect(small.body).toMatch(/min-height:\s*26px/);
      expect(small.body).toMatch(/font-size:\s*12px/);
    });
  });

  describe('the primary button (A2, Task 2.2)', () => {
    it('rests on the accent fill (--brand-blue-hover resolves to --cx-accent-fill) with the dark ink', () => {
      expect(paint(declared('.btn-primary', 'background'))).toEqual(paint('var(--cx-accent-fill)'));
      expect(declared('.btn-primary', 'color')).toBe('var(--cx-on-accent)');
    });

    it('hovers on the lighter fill step, which differs from rest (the deep text step cannot be a fill in light)', () => {
      const hover = declared('.btn-primary:hover:not(:disabled)', 'background');
      expect(hover).toBe('var(--cx-accent-fill-hover)');
      expect(round(contrastRatio(paint(hover), paint(declared('.btn-primary', 'background'))))).toBeGreaterThan(1.05);
    });

    it('keeps the dark ink at 4.5:1 or more on the hover step', () => {
      const ratio = contrastRatio(paint(declared('.btn-primary', 'color')),
        paint(declared('.btn-primary:hover:not(:disabled)', 'background')));
      expect(ratio, `primary hover measures ${round(ratio)}:1`).toBeGreaterThanOrEqual(4.5);
    });
  });

  describe('the secondary button (A2, Task 2.2)', () => {
    it('is a 1 px --cx-border-strong outline on a transparent fill', () => {
      expect(declared('.btn-ghost', 'border-color')).toBe('var(--cx-border-strong)');
      expect(declared('.btn-ghost', 'background')).toBe('transparent');
    });

    it('hovers on the sunken step, which differs from the page and from a dialog panel', () => {
      expect(declared('.btn-ghost:hover:not(:disabled)', 'background')).toBe('var(--cx-surface-1)');
    });
  });

  describe('the danger button keeps its one look (A2, Task 2.2)', () => {
    it('rests on --cx-danger-fill with the dark ink and an inset ring on hover', () => {
      expect(declared('.btn-danger', 'background')).toBe('var(--cx-danger-fill)');
      expect(declared('.btn-danger', 'color')).toBe('var(--cx-on-danger)');
      expect(declared('.btn-danger:hover:not(:disabled)', 'box-shadow')).toBe('inset 0 0 0 1px var(--cx-text-primary)');
    });
  });

  describe('the menu primitive and the menus that adopt its look (A2, Task 2.3)', () => {
    it('hovers an item on the sunken step, which differs from the raised panel it sits on', () => {
      expect(declared('.menu', 'background')).toBe('var(--cx-surface-2)');
      expect(declared('.menu__item:hover:not(:disabled)', 'background')).toBe('var(--cx-surface-1)');
    });

    it('hovers the trigger by its border, never its fill, so the hover reads in a dialog too', () => {
      expect(declared('.menu-trigger:hover:not(:disabled)', 'border-color')).toBe('var(--cx-text-faint)');
      expect(() => declared('.menu-trigger:hover:not(:disabled)', 'background')).toThrow();
    });

    it('marks the current item with the selection wash and an accent ring', () => {
      expect(declared('.menu__item[aria-checked=\'true\']', 'background')).toBe('var(--cx-select-wash)');
      expect(declared('.menu__item[aria-checked=\'true\']', 'border-color')).toBe('var(--cx-accent)');
    });

    it('gives the export menu and the GitHub sync menu the raised panel and the sunken item hover', () => {
      expect(declared('.export-dropdown__menu', 'background')).toBe('var(--cx-surface-2)');
      expect(declared('.gh-sync-menu', 'background')).toBe('var(--cx-surface-2)');
      expect(declared('.gh-sync-menu__item:hover:not(:disabled)', 'background')).toBe('var(--cx-surface-1)');
    });

    it('gives a field its uppercase faint label', () => {
      expect(declared('.field__label', 'text-transform')).toBe('uppercase');
      expect(declared('.field__label', 'color')).toBe('var(--cx-text-faint)');
    });
  });

  describe('the tab row (A2, Task 2.4)', () => {
    it('spaces the tabs 24 px apart, with the active tab in the primary text and a 2 px accent underline', () => {
      expect(declared('.notifications-page__filters', 'gap')).toBe('24px');
      expect(declared('.activity-page__filters', 'gap')).toBe('24px');
      expect(declared('.notifications-page__filter.active', 'color')).toBe('var(--cx-text-primary)');
      expect(declared('.notifications-page__filter.active', 'border-bottom-color')).toBe('var(--cx-accent)');
      expect(declared('.activity-page__filter.active', 'border-bottom-color')).toBe('var(--cx-accent)');
    });
  });

  describe('the avatar (A2, Task 2.4)', () => {
    it('paints the initial in the dark ink, at 4.5:1 or more on each of the eight tints', () => {
      expect(declared('.avatar', 'color')).toBe('var(--cx-on-accent)');
      for (let n = 1; n <= 8; n += 1) {
        const ratio = contrastRatio(paint(declared('.avatar', 'color')), paint(`var(--avatar-${n})`));
        expect(ratio, `--avatar-${n} measures ${round(ratio)}:1 under the ink`).toBeGreaterThanOrEqual(4.5);
      }
    });
  });

  describe('chips and badges sit on the 12 px floor, and the role chip is a pill (A2, Task 2.4)', () => {
    it('sets .badge and .role-badge at 12 px or more', () => {
      expect(parseFloat(declared('.badge', 'font-size'))).toBeGreaterThanOrEqual(12);
      expect(parseFloat(declared('.role-badge', 'font-size'))).toBeGreaterThanOrEqual(12);
    });

    it('draws the role chip as a pill', () => {
      expect(declared('.role-badge', 'border-radius')).toBe('999px');
    });
  });

  describe('dialog panels sit on the panel tokens (A2, Task 2.5)', () => {
    it('draws the modal panel on the raised surface, a strong hairline and --radius-lg', () => {
      expect(declared('.modal-content', 'background')).toBe('var(--bg-panel)');
      expect(declared('.modal-content', 'border')).toBe('1px solid var(--cx-border-strong)');
      expect(declared('.modal-content', 'border-radius')).toBe('var(--radius-lg)');
    });
  });

  describe('the icon button (momus 4, PR 2 Task 2.2)', () => {
    it('is a 30 px square, positioned, with a 44 px hit area drawn by ::before', () => {
      expect(declared('.btn-icon', 'min-width')).toBe('30px');
      expect(declared('.btn-icon', 'min-height')).toBe('30px');
      expect(declared('.btn-icon:not(.close-button)', 'position')).toBe('relative');
      expect(() => declared('.btn-icon', 'position')).toThrow();
      expect(declared('.btn-icon::before', 'inset')).toBe('-7px');
      expect(declared('.btn-icon::before', 'position')).toBe('absolute');
    });
  });

  describe('the tab row and the chip are real classes (momus 4)', () => {
    it('.tabs spaces its tabs 24 px apart on the border; .tabs__tab is the tab; .tabs__tab.active is the primary text and the accent underline', () => {
      expect(declared('.tabs', 'gap')).toBe('24px');
      expect(declared('.tabs', 'border-bottom')).toBe('1px solid var(--cx-border)');
      expect(declared('.tabs__tab', 'border-bottom')).toBe('2px solid transparent');
      expect(declared('.tabs__tab.active', 'color')).toBe('var(--cx-text-primary)');
      expect(declared('.tabs__tab.active', 'border-bottom-color')).toBe('var(--cx-accent)');
    });

    it('.chip is a pill at 12 px or more', () => {
      expect(declared('.chip', 'border-radius')).toBe('999px');
      expect(parseFloat(declared('.chip', 'font-size'))).toBeGreaterThanOrEqual(12);
    });
  });
});
