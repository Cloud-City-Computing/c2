// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cloud City Computing, LLC

// node --test suite for contrast.mjs. Zero dependencies: run it from the
// package root with `node --test`, no install.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_THEMES,
  compositeOver,
  contrastRatio,
  isRootSelector,
  loadThemeTokens,
  oklchToRgb,
  parseColor,
  parseOklch,
  parseThemeTokens,
  relativeLuminance,
  resolveToken,
  resolveTokenValue,
  round,
} from './contrast.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const THEME_FIXTURE = join(HERE, 'fixtures', 'fx-theme.css');

/** @param {string} value */
function color(value) {
  const parsed = parseColor(value);
  assert.ok(parsed !== undefined, value);
  return parsed;
}

test('black on white is 21:1, a colour on itself is 1:1, and known pairs give known ratios', () => {
  assert.equal(contrastRatio(color('#000'), color('#fff')), 21);
  assert.equal(contrastRatio(color('#fff'), color('#000')), 21);
  assert.equal(contrastRatio(color('#fff'), color('#fff')), 1);
  assert.equal(round(contrastRatio(color('#767676'), color('#ffffff'))), 4.54);
  assert.equal(round(contrastRatio(color('#777777'), color('#ffffff'))), 4.48);
  assert.equal(round(relativeLuminance(color('#ffffff')), 4), 1);
  assert.equal(round(1.23456, 3), 1.235);
});

test('OKLCH parses with numbers, percentages and an alpha', () => {
  assert.deepEqual(parseOklch('oklch(0.62 0.1 240)'), { l: 0.62, c: 0.1, h: 240, alpha: 1 });
  const percent = parseOklch('oklch(62% 25% 240 / 50%)');
  assert.ok(percent !== undefined);
  assert.equal(round(percent.l, 6), 0.62);
  assert.equal(round(percent.c, 6), 0.1);
  assert.equal(percent.alpha, 0.5);
  assert.equal(parseOklch('OKLCH(0.5 0.1 240)')?.l, 0.5);
  assert.equal(parseOklch('oklch(0.5, 0.1, 240)'), undefined);
  assert.deepEqual(parseColor('oklch(1 0 0)'), oklchToRgb({ l: 1, c: 0, h: 0, alpha: 1 }));
});

test('an out-of-gamut OKLCH value is clamped per channel', () => {
  const vivid = color('oklch(0.62 0.4 150)');
  for (const channel of [vivid.r, vivid.g, vivid.b]) assert.ok(channel >= 0 && channel <= 1);
});

test('3- and 6-digit hex parse; 4- and 8-digit hex and other notations are undefined, as documented', () => {
  assert.deepEqual(parseColor('#fff'), { r: 1, g: 1, b: 1, alpha: 1 });
  assert.deepEqual(parseColor(' #FFFFFF '), { r: 1, g: 1, b: 1, alpha: 1 });
  for (const value of ['#fff8', '#ffffff80', 'rgb(0 0 0)', 'white', 'var(--fx-a)', '']) {
    assert.equal(parseColor(value), undefined, value);
  }
});

test('compositing flattens a translucent foreground, and an opaque one is returned as is', () => {
  const half = { r: 1, g: 1, b: 1, alpha: 0.5 };
  assert.deepEqual(compositeOver(half, { r: 0, g: 0, b: 0, alpha: 1 }), { r: 0.5, g: 0.5, b: 0.5, alpha: 1 });
  const opaque = { r: 0.2, g: 0.3, b: 0.4, alpha: 1 };
  assert.equal(compositeOver(opaque, half), opaque);
  assert.ok(contrastRatio(half, color('#000')) < 21);
});

test('the default parse lays the dark theme over the base, in either quote style', () => {
  const tokens = parseThemeTokens(readFileSync(THEME_FIXTURE, 'utf8'));
  assert.deepEqual(Object.keys(tokens), ['light', 'dark']);
  assert.equal(tokens.light?.['--fx-bg'], '#fff');
  assert.equal(tokens.dark?.['--fx-bg'], '#121212');
  assert.equal(tokens.light?.['--fx-ink'], '#1a1a1a');
  assert.equal(tokens.dark?.['--fx-ink'], '#f0f0f0');
  assert.equal(tokens.dark?.['--fx-rgb'], 'rgb(0 0 0)', 'a name absent from the dark block is shared');
  assert.deepEqual(loadThemeTokens(THEME_FIXTURE), tokens);
});

test('var() chains resolve, spaced ones too; a cycle is undefined and a fallback is returned as text', () => {
  const { light = {}, dark = {} } = parseThemeTokens(readFileSync(THEME_FIXTURE, 'utf8'));
  assert.equal(resolveTokenValue(light, '--fx-link'), 'oklch(62% 0.1 240)');
  assert.equal(resolveTokenValue(light, '--fx-chain'), 'oklch(62% 0.1 240)');
  assert.equal(resolveTokenValue(dark, '--fx-chain'), 'oklch(72% 0.1 240)');
  assert.equal(resolveTokenValue(light, '--fx-loop-a'), undefined);
  assert.equal(resolveTokenValue(light, '--fx-fallback'), 'var(--fx-absent, #000)');
  assert.equal(resolveTokenValue(light, '--fx-absent'), undefined);
  assert.deepEqual(resolveToken(light, '--fx-chain'), parseColor('oklch(62% 0.1 240)'));
  assert.equal(resolveToken(light, '--fx-fallback'), undefined);
});

test('comments are stripped before parsing', () => {
  const tokens = parseThemeTokens(':root { /* --fx-a: #000; */ --fx-b: #fff; }');
  assert.deepEqual(tokens.light, { '--fx-b': '#fff' });
});

test('a :root[data-theme] block lands in the base, and a :root inside an at-rule merges into it (documented)', () => {
  const tokens = parseThemeTokens(':root { --fx-a: #fff; }\n:root[data-theme="dark"] { --fx-a: #000; }');
  assert.equal(tokens.light?.['--fx-a'], '#000');
  assert.equal(tokens.dark?.['--fx-a'], '#000');
  const media = parseThemeTokens(':root { --fx-a: #fff; }\n@media (min-width: 1px) { :root { --fx-a: #000; } }');
  assert.equal(media.light?.['--fx-a'], '#000');
});

test('explicit default options reproduce the default parse', () => {
  const css = readFileSync(THEME_FIXTURE, 'utf8');
  assert.deepEqual(
    parseThemeTokens(css, { isBase: isRootSelector, themes: { dark: /\[data-theme=['"]dark['"]\]/ } }),
    parseThemeTokens(css),
  );
  assert.deepEqual(Object.keys(DEFAULT_THEMES), ['dark']);
});

test('custom base and theme options parse a class-based stylesheet, first matching theme wins', () => {
  const css = [
    '.fx-base { --fx-a: #fff; --fx-b: #eee; }',
    '.fx-theme-dark { --fx-a: #000; }',
    '.fx-theme-contrast { --fx-b: #000; }',
    '.fx-theme-dark.fx-theme-contrast { --fx-c: #111; }',
    ':root { --fx-ignored: #123; }',
  ].join('\n');
  const tokens = parseThemeTokens(css, {
    isBase: (selector) => selector === '.fx-base',
    themes: { dark: /\.fx-theme-dark/g, contrast: /\.fx-theme-contrast/ },
  });
  assert.deepEqual(Object.keys(tokens), ['light', 'dark', 'contrast']);
  assert.deepEqual(tokens.light, { '--fx-a': '#fff', '--fx-b': '#eee' });
  assert.deepEqual(tokens.dark, { '--fx-a': '#000', '--fx-b': '#eee', '--fx-c': '#111' });
  assert.deepEqual(tokens.contrast, { '--fx-a': '#fff', '--fx-b': '#000' });
});

test('a theme named light is refused', () => {
  assert.throws(() => parseThemeTokens('', { themes: { light: /x/ } }), /light/);
});
