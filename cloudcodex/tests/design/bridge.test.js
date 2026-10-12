/**
 * The legacy-alias bridge: every name index.css declares on :root resolves to a shared token, and none is a literal
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  parseColor, parseThemeTokens, resolveTokenValue,
} from '../../vendor/cloud-city-design/gates/contrast.mjs';
import { declaredNames } from '../../vendor/cloud-city-design/gates/dangling.mjs';
import { ROOT, THEME_OPTIONS } from './buckets.js';

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const core = read('vendor/cloud-city-design/core.css');
const codex = read('src/codex.css');
const index = read('src/index.css');
const dark = parseThemeTokens(`${core}\n${codex}`, THEME_OPTIONS).dark;

// The bridge block is the first :root block of index.css.
const rootBlock = /:root\s*\{([^}]*)\}/.exec(index)[1];
const bridge = new Map(
  [...rootBlock.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
);

// The 27 names the page declared before the bridge, colour and layout alike.
// W6-CDX-38 retires the two hover fills and the three radius names: index.css no longer redeclares
// them, so core.css's values apply and the bridge is 22 names.
const LEGACY_27 = [
  '--bg-main', '--bg-elevated', '--bg-panel',
  '--border-color', '--text-primary', '--text-secondary', '--text-muted',
  '--brand-blue', '--brand-blue-light', '--brand-blue-dark', '--brand-blue-hover',
  '--color-danger', '--color-danger-hover', '--color-success',
  '--shadow-sm', '--shadow-md', '--shadow-lg',
  '--topbar-height', '--sidebar-width', '--sidebar-collapsed', '--footer-height',
  '--transition',
];
// The undeclared names that carry the heaviest fallbacks, bridged so the fallback can go (PR 8).
const FALLBACK_NAMES = ['--bg-secondary', '--color-accent', '--border', '--bg-tertiary', '--accent-color'];
// The names whose target is a length, a shadow or a transition, not a colour.
const NON_COLOUR = ['--shadow-sm', '--shadow-md', '--shadow-lg',
  '--topbar-height', '--sidebar-width', '--sidebar-collapsed', '--footer-height', '--transition'];
const COLOUR_NAMES = LEGACY_27.filter((name) => !NON_COLOUR.includes(name));

describe('the bridge in index.css :root', () => {
  it('retires the two hover names: no --bg-hover or --bg-hover-strong in the bridge', () => {
    expect([...bridge.keys()].filter((name) => /^--bg-hover/.test(name))).toEqual([]);
  });

  it('declares all legacy names and the five fallback names', () => {
    for (const name of [...LEGACY_27, ...FALLBACK_NAMES]) {
      expect(bridge.has(name), `${name} is not declared in the bridge`).toBe(true);
    }
  });

  it('points each name at exactly one var(), never a literal', () => {
    for (const name of [...LEGACY_27, ...FALLBACK_NAMES]) {
      expect(bridge.get(name), `${name} is not a single var() reference`)
        .toMatch(/^var\(--[\w-]+\)$/);
    }
  });

  it('resolves each target through the vendored resolver to a token in codex.css or core.css', () => {
    const declared = new Set([...declaredNames(codex), ...declaredNames(core)]);
    for (const name of [...LEGACY_27, ...FALLBACK_NAMES]) {
      const target = /var\((--[\w-]+)\)/.exec(bridge.get(name))[1];
      expect(declared.has(target), `${name} points at ${target}, which codex.css and core.css do not declare`).toBe(true);
      expect(resolveTokenValue(dark, target), `${name} -> ${target} does not resolve`).toBeDefined();
    }
  });

  it('resolves every colour name to a colour, not a length or a keyword', () => {
    for (const name of [...COLOUR_NAMES, ...FALLBACK_NAMES]) {
      const target = /var\((--[\w-]+)\)/.exec(bridge.get(name))[1];
      expect(parseColor(resolveTokenValue(dark, target)), `${name} -> ${target} is not a colour`).toBeDefined();
    }
  });

  it('does not redeclare the core radius names, so core\'s 6, 10 and 14px apply', () => {
    expect([...bridge.keys()].filter((name) => name.startsWith('--radius-'))).toEqual([]);
    expect(rootBlock).not.toMatch(/--radius-/);
  });

  it('keeps the layout sizes and transition it had before the bridge', () => {
    expect(resolveTokenValue(dark, bridge.get('--topbar-height').slice(4, -1))).toBe('56px');
    expect(resolveTokenValue(dark, bridge.get('--sidebar-width').slice(4, -1))).toBe('220px');
    expect(resolveTokenValue(dark, bridge.get('--sidebar-collapsed').slice(4, -1))).toBe('56px');
    expect(resolveTokenValue(dark, bridge.get('--footer-height').slice(4, -1))).toBe('44px');
    expect(resolveTokenValue(dark, bridge.get('--transition').slice(4, -1))).toBe('all 0.2s ease');
  });

  it('points the brand names at the accent tokens the picker writes', () => {
    expect(bridge.get('--brand-blue')).toBe('var(--cx-accent)');
    expect(bridge.get('--brand-blue-hover')).toBe('var(--cx-accent-fill)');
    expect(bridge.get('--brand-blue-dark')).toBe('var(--cx-accent-dark)');
  });
});
