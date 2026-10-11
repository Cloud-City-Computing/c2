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
  ACCENTS, LEGACY_ACCENT, accentValue, accentHover, accentFill, accentDark,
} from '../../src/tokens/accents.js';
import { ROOT } from './buckets.js';

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const core = read('vendor/cloud-city-design/core.css');
const codex = read('src/codex.css');
const dark = parseThemeTokens(`${core}\n${codex}`).dark;
const WHITE = parseColor('#fff');
const SURFACES = ['--cx-surface-0', '--cx-surface-1', '--cx-surface-2', '--cx-surface-3', '--cx-surface-4'];

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

  it('keeps the four renamed hues on their new names', () => {
    expect(LEGACY_ACCENT).toEqual({ rose: 'coral', amber: 'apricot', emerald: 'jade', violet: 'iris' });
  });

  it('maps every legacy key to one successor, and no two legacy keys share one', () => {
    const targets = Object.values(LEGACY_ACCENT);
    for (const target of targets) expect(Object.keys(ACCENTS)).toContain(target);
    expect(new Set(targets).size).toBe(targets.length);
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

  it('measures every hue on every surface at 4.5:1 or more, and measured all 40 pairs', () => {
    const measured = [];
    for (const [name, hue] of entries) {
      const text = parseColor(accentValue(hue));
      for (const surface of SURFACES) {
        const ratio = contrastRatio(text, resolveToken(dark, surface));
        measured.push({ name, surface, ratio });
        expect(ratio, `${name} on ${surface} measures ${round(ratio)}:1`).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(measured.length).toBe(40);
  });

  it('keeps a white label at 4.5:1 or more on every hue dark step (the avatar initials)', () => {
    for (const [name, hue] of entries) {
      const ratio = contrastRatio(WHITE, parseColor(accentDark(hue)));
      expect(ratio, `white on ${name} dark measures ${round(ratio)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the on-accent label at 4.5:1 or more on every hue fill', () => {
    const label = resolveToken(dark, '--cx-on-accent');
    for (const [name, hue] of entries) {
      const ratio = contrastRatio(label, parseColor(accentFill(hue)));
      expect(ratio, `on-accent on ${name} fill measures ${round(ratio)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('builds the hover and fill steps from the same hue, lighter and stronger than the text step', () => {
    for (const [, hue] of entries) {
      expect(accentHover(hue)).toBe(`oklch(0.88 0.06 ${hue})`);
      expect(accentFill(hue)).toBe(`oklch(0.68 0.13 ${hue})`);
      expect(accentValue(hue)).toBe(`oklch(0.78 0.12 ${hue})`);
      expect(accentDark(hue)).toBe(`oklch(0.45 0.13 ${hue})`);
    }
  });
});
