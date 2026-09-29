// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cloud City Computing, LLC

// node --test suite for brand.mjs and brand.json. Zero dependencies: run it
// from the package root with `node --test`, no install.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BRAND_NAMES,
  COPYRIGHT,
  LICENSE,
  TOLERANCE,
  buildBrand,
  deltaEOK,
  hexToOklab,
  literalToOklab,
  oklabToLinearSrgb,
  serializeBrand,
} from './brand.mjs';
import { parseThemeTokens } from './contrast.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const coreCss = readFileSync(join(ROOT, 'core.css'), 'utf8');
const brandText = readFileSync(join(ROOT, 'brand.json'), 'utf8');
/** @type {{ license: string, copyright: string, source: { file: string, sha256: string }, colors: Record<string, string>, clamped: string[], tolerance: { inGamut: number, clamped: number } }} */
const brand = JSON.parse(brandText);
const literals = parseThemeTokens(coreCss).light ?? {};

// Written out by hand, not derived: the colour families this file must carry.
const EXPECTED_NAMES = [
  'brand-blue',
  'accent-100',
  'accent-200',
  'accent-300',
  'accent-400',
  'accent-500',
  'accent-600',
  'accent-700',
  'success-deep',
  'success-bright',
  'success-pale',
  'warning-deep',
  'warning-bright',
  'warning-pale',
  'danger-deep',
  'danger-bright',
  'danger-pale',
  'violet-deep',
  'violet-bright',
  'violet-pale',
];

// Computed independently of this package (a separate OKLab implementation),
// then written down: a regression here is a real change, not a refactor.
const INDEPENDENT_HEX = {
  'brand-blue': '#2ca7db',
  'accent-400': '#1ca6d9',
  'accent-600': '#00679d',
  'warning-deep': '#b37900',
  'danger-deep': '#c92f33',
};
const INDEPENDENT_CLAMPED = ['accent-100', 'accent-500', 'accent-600', 'accent-700', 'warning-deep'];

test('brand.json is fresh: it equals a regeneration from core.css, byte for byte', () => {
  assert.equal(brandText, serializeBrand(buildBrand(coreCss)));
  assert.deepEqual(brand, buildBrand(coreCss));
  assert.equal(brand.source.file, 'core.css');
  assert.equal(brand.source.sha256, createHash('sha256').update(readFileSync(join(ROOT, 'core.css'))).digest('hex'));
});

test('it states its licence in its own keys, since JSON cannot carry a header comment', () => {
  assert.equal(LICENSE, 'Apache-2.0');
  assert.equal(COPYRIGHT, 'Copyright 2026 Cloud City Computing, LLC');
  assert.equal(brand.license, LICENSE);
  assert.equal(brand.copyright, COPYRIGHT);
  assert.deepEqual(Object.keys(brand).slice(0, 2), ['license', 'copyright']);
});

test('it carries exactly the brand, accent and semantic colours, and no neutral or identity tint', () => {
  assert.deepEqual([...BRAND_NAMES], EXPECTED_NAMES);
  assert.deepEqual(Object.keys(brand.colors), EXPECTED_NAMES);
  assert.ok(!Object.keys(brand.colors).some((name) => name.startsWith('avatar')));
});

test('every value is #rrggbb', () => {
  for (const [name, value] of Object.entries(brand.colors)) assert.match(value, /^#[0-9a-f]{6}$/, name);
});

test('the values match independently computed literals', () => {
  for (const [name, hex] of Object.entries(INDEPENDENT_HEX)) assert.equal(brand.colors[name], hex, name);
});

test('the clamped list is the five out-of-sRGB colours, and the unclamped path agrees', () => {
  assert.deepEqual(brand.clamped, INDEPENDENT_CLAMPED);
  const outOfGamut = EXPECTED_NAMES.filter((name) =>
    oklabToLinearSrgb(literalToOklab(literals[`--${name}`] ?? '')).some((channel) => channel < 0 || channel > 1),
  );
  assert.deepEqual(outOfGamut, INDEPENDENT_CLAMPED);
});

test('every value round-trips to its source within the stated tolerance', () => {
  assert.deepEqual({ inGamut: brand.tolerance.inGamut, clamped: brand.tolerance.clamped }, { ...TOLERANCE });
  assert.equal(TOLERANCE.inGamut, 0.002);
  assert.equal(TOLERANCE.clamped, 0.02);
  for (const name of EXPECTED_NAMES) {
    const literal = literals[`--${name}`];
    assert.ok(literal !== undefined, name);
    const distance = deltaEOK(literalToOklab(literal), hexToOklab(brand.colors[name] ?? ''));
    const limit = brand.clamped.includes(name) ? TOLERANCE.clamped : TOLERANCE.inGamut;
    assert.ok(distance <= limit, `${name}: ${String(distance)} > ${String(limit)}`);
  }
});

test('the OKLab helpers invert each other on sRGB colours', () => {
  for (const hex of ['#000000', '#ffffff', '#2ca7db', '#c92f33']) {
    const back = hexToOklab(hex);
    const channels = oklabToLinearSrgb(back);
    for (const channel of channels) assert.ok(channel > -1e-6 && channel < 1 + 1e-6, hex);
  }
  assert.ok(deltaEOK(hexToOklab('#ffffff'), { L: 1, a: 0, b: 0 }) < 1e-4);
});
