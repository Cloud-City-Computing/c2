/**
 * The accent picker's eight hues: contrast, reserved arcs, spacing and the legacy successors
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  contrastRatio, parseColor, parseThemeTokens, resolveToken, round,
} from '../../vendor/cloud-city-design/gates/contrast.mjs';
import {
  ACCENTS, LEGACY_ACCENT, STEPS,
} from '../../src/tokens/accents.js';
import { ROOT, THEME_NAMES, THEME_OPTIONS } from './buckets.js';

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const core = read('vendor/cloud-city-design/core.css');
const codex = read('src/codex.css');
const themed = parseThemeTokens(`${core}\n${codex}`, THEME_OPTIONS);
const WHITE = parseColor('#fff');
// The surfaces of a theme that a label can sit on: the three surface steps, and the picked wash, which is per hue.
const SURFACES = ['--cx-surface-0', '--cx-surface-1', '--cx-surface-2'];
// codex.css's picked-accent block for a theme, its declarations with var(--cx-accent-h) written as H.
const CSS_THEME = { dark: 'dark', daylight: 'light' };
const accentBlock = (theme) => {
  const m = new RegExp(`\\[data-theme='${CSS_THEME[theme]}'\\]\\[data-accent\\]\\s*\\{([^}]*)\\}`).exec(codex);
  if (!m) throw new Error(`no picked-accent block for ${theme} in codex.css`);
  return new Map(m[1].split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const i = d.indexOf(':');
    return [d.slice(0, i).trim(), d.slice(i + 1).trim().replace(/var\(--cx-accent-h\)/g, 'H')];
  }));
};
// The CSS name each contract step is declared under in the picked-accent block.
const CSS_NAME = {
  text: '--cx-accent', hover: '--cx-accent-hover', fill: '--cx-accent-fill', fillHover: '--cx-accent-fill-hover',
  wash: '--cx-select-wash', dark: '--cx-accent-dark',
};
// The picked steps of a theme and hue as codex.css declares them (W6-CDX-43 review, item 6): the gates below measure
// these, so an edit to the stylesheet is what they test, and the JS table is checked against it, not used in its place.
const cssSteps = (theme, hue) => {
  const block = accentBlock(theme);
  return Object.fromEntries(Object.entries(CSS_NAME).map(([step, name]) => [
    step, block.get(name).replaceAll('H', String(hue)),
  ]));
};

// The hue of a `--name: oklch(L C H)` declaration in the vendored core.css.
const hueOf = (name) => {
  const m = new RegExp(`${name}:\\s*oklch\\([^)]*?\\s([\\d.]+)\\)`).exec(core);
  if (!m) throw new Error(`no hue for ${name} in core.css`);
  return Number(m[1]);
};
// The reserved arcs, read from the package rather than typed here.
const RESERVED = {
  danger: hueOf('--danger-deep'),
  warning: hueOf('--warning-deep'),
  success: hueOf('--success-deep'),
  violet: hueOf('--violet-deep'),
};
const circular = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

describe('the accent picker', () => {
  const entries = Object.entries(ACCENTS);

  it('offers eight hues, and the four kept names keep their hues', () => {
    expect(Object.keys(ACCENTS).length).toBe(8);
    expect(ACCENTS).toMatchObject({ blue: 232, cyan: 200, pink: 325, lime: 131 });
  });

  it('maps the four shipped renamed keys to the four new names, one to one', () => {
    expect(LEGACY_ACCENT).toMatchObject({ rose: 'nova', amber: 'solar', emerald: 'aurora', violet: 'nebula' });
    const shipped = ['rose', 'amber', 'emerald', 'violet'].map((k) => LEGACY_ACCENT[k]);
    expect(new Set(shipped).size).toBe(4);
  });

  it('maps every legacy key to an offered hue, and each placeholder to its shipped key\'s successor', () => {
    for (const target of Object.values(LEGACY_ACCENT)) expect(Object.keys(ACCENTS)).toContain(target);
    expect(LEGACY_ACCENT).toEqual({
      rose: 'nova', amber: 'solar', emerald: 'aurora', violet: 'nebula',
      coral: 'nova', apricot: 'solar', jade: 'aurora', iris: 'nebula',
    });
  });

  it('keeps each hue at least 15 degrees from every reserved arc', () => {
    for (const [name, hue] of entries) {
      for (const [arc, reserved] of Object.entries(RESERVED)) {
        expect(circular(hue, reserved), `${name} ${hue} is ${circular(hue, reserved)} degrees from ${arc} ${reserved}`)
          .toBeGreaterThanOrEqual(15);
      }
    }
  });

  it('keeps no two hues closer than 25 degrees', () => {
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const [a, ha] = entries[i];
        const [b, hb] = entries[j];
        expect(circular(ha, hb), `${a} and ${b}`).toBeGreaterThanOrEqual(25);
      }
    }
  });

  it('declares, in codex.css, the contract steps of each theme with H substituted (K7)', () => {
    for (const theme of THEME_NAMES) {
      const block = accentBlock(theme);
      for (const [step, css] of Object.entries(CSS_NAME)) {
        expect(block.get(css), `${theme} ${css}`).toBe(STEPS[theme][step]);
      }
    }
  });

  it('measures the text step and the hover step of every hue on every surface of each theme at 4.5:1: 8 by 2 by 4 by 2', () => {
    const measured = [];
    for (const theme of THEME_NAMES) {
      for (const [name, hue] of entries) {
        const steps = cssSteps(theme, hue);
        for (const step of ['text', 'hover']) {
          const text = parseColor(steps[step]);
          for (const surface of [...SURFACES, 'picked wash']) {
            const bg = surface === 'picked wash' ? parseColor(steps.wash) : resolveToken(themed[theme], surface);
            const ratio = contrastRatio(text, bg);
            measured.push({ theme, name, step, surface, ratio });
            expect(ratio, `${theme} ${name} ${step} on ${surface} measures ${round(ratio)}:1`).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    }
    expect(measured.length).toBe(128);
  });

  it('keeps the on-accent label at 4.5:1 or more on every hue fill and fill hover, in both themes', () => {
    let checked = 0;
    for (const theme of THEME_NAMES) {
      const label = resolveToken(themed[theme], '--cx-on-accent');
      for (const [name, hue] of entries) {
        const steps = cssSteps(theme, hue);
        for (const fill of [steps.fill, steps.fillHover]) {
          const ratio = contrastRatio(label, parseColor(fill));
          checked += 1;
          expect(ratio, `${theme} on-accent on ${name} ${fill} measures ${round(ratio)}:1`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
    expect(checked).toBe(32);
  });

  it('keeps the focus ring at 3:1 or more on every surface, in both themes, for every hue', () => {
    for (const theme of THEME_NAMES) {
      for (const [name, hue] of entries) {
        const ring = parseColor(cssSteps(theme, hue).text);
        for (const surface of [...SURFACES, cssSteps(theme, hue).wash]) {
          const bg = surface.startsWith('oklch') ? parseColor(surface) : resolveToken(themed[theme], surface);
          expect(contrastRatio(ring, bg), `${theme} ring ${name} on ${surface}`).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it('keeps a white label at 4.5:1 or more on every hue dark step (the avatar initials), in both themes', () => {
    for (const theme of THEME_NAMES) {
      for (const [name, hue] of entries) {
        const ratio = contrastRatio(WHITE, parseColor(cssSteps(theme, hue).dark));
        expect(ratio, `white on ${theme} ${name} dark measures ${round(ratio)}:1`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('gives the fill hover a step that differs from the fill it sits on', () => {
    for (const theme of THEME_NAMES) {
      for (const [, hue] of entries) {
        const steps = cssSteps(theme, hue);
        expect(steps.fillHover).not.toBe(steps.fill);
        expect(contrastRatio(parseColor(steps.fillHover), parseColor(steps.fill))).toBeGreaterThan(1.05);
      }
    }
  });
});
