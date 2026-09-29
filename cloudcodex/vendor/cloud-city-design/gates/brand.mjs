// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cloud City Computing, LLC

// brand.json: the package's brand, accent and semantic colours as #rrggbb,
// generated from core.css, for a consumer that can only take hex (an identity
// provider's label policy, an email template, a native shell).
//
//   node gates/brand.mjs            writes brand.json at the package root
//   node gates/brand.mjs --check    exits 1 when brand.json is stale
//
// The conversion is the contrast gate's own: OKLCH to sRGB with each channel
// CLAMPED to 0..1, then rounded to 8 bits. So a hex here is the same colour
// every contrast figure the gate reports was measured on. A colour outside
// sRGB cannot be written as hex exactly, so it is listed under `clamped` and
// held to a looser round-trip tolerance than an in-gamut one.
//
// Neutrals are not here: core.css declares none. Surfaces, text and borders
// are a consumer's bindings.
//
// JSON has no comments, so brand.json carries its licence as data: top-level
// `license` and `copyright` keys, the same two facts this file's header states.
//
// Zero dependencies: node: built-ins only, and nothing newer than Node 20.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseColor, parseOklch, parseThemeTokens } from './contrast.mjs';

/** The colours brand.json carries, in order: brand, accent ramp, semantic ramp. */
export const BRAND_NAMES = Object.freeze([
  'brand-blue',
  'accent-100',
  'accent-200',
  'accent-300',
  'accent-400',
  'accent-500',
  'accent-600',
  'accent-700',
  ...['success', 'warning', 'danger', 'violet'].flatMap((meaning) =>
    ['deep', 'bright', 'pale'].map((step) => `${meaning}-${step}`),
  ),
]);

/** The licence brand.json states in its own keys, since JSON cannot carry a header comment. */
export const LICENSE = 'Apache-2.0';
export const COPYRIGHT = 'Copyright 2026 Cloud City Computing, LLC';

/** Round-trip tolerances in deltaE OK (Euclidean distance in OKLab). */
export const TOLERANCE = Object.freeze({ inGamut: 0.002, clamped: 0.02 });

/** @param {number} channel 0..1 */
function toHexByte(channel) {
  return Math.round(Math.min(1, Math.max(0, channel)) * 255)
    .toString(16)
    .padStart(2, '0');
}

// ---------------------------------------------------------------------------
// An independent, UNCLAMPED path: OKLCH or hex to OKLab and linear sRGB. It
// shares no code with the contrast gate's conversion, so a test can hold the
// two against each other instead of against themselves.
// ---------------------------------------------------------------------------

/**
 * @typedef {object} Oklab
 * @property {number} L
 * @property {number} a
 * @property {number} b
 */

/**
 * @param {number} l
 * @param {number} c
 * @param {number} hDegrees
 * @returns {Oklab}
 */
export function oklchToOklab(l, c, hDegrees) {
  const h = (hDegrees / 180) * Math.PI;
  return { L: l, a: c * Math.cos(h), b: c * Math.sin(h) };
}

/**
 * OKLab to linear sRGB, NOT clamped: a channel below 0 or above 1 is outside
 * the sRGB gamut.
 * @param {Oklab} lab
 * @returns {[number, number, number]}
 */
export function oklabToLinearSrgb({ L, a, b }) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/**
 * Linear sRGB to OKLab (the inverse direction).
 * @param {readonly [number, number, number]} rgb
 * @returns {Oklab}
 */
export function linearSrgbToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** @param {number} encoded gamma-encoded sRGB, 0..1 */
function decodeSrgb(encoded) {
  return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
}

/**
 * `#rrggbb` to OKLab.
 * @param {string} hex
 * @returns {Oklab}
 */
export function hexToOklab(hex) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (match === null) throw new Error(`not a #rrggbb colour: ${hex}`);
  const channels = /** @type {[number, number, number]} */ (
    [match[1], match[2], match[3]].map((pair) => decodeSrgb(Number.parseInt(pair ?? '0', 16) / 255))
  );
  return linearSrgbToOklab(channels);
}

/**
 * A core.css literal (OKLCH or hex) to OKLab, with no clamping anywhere.
 * @param {string} value
 * @returns {Oklab}
 */
export function literalToOklab(value) {
  const oklch = parseOklch(value);
  if (oklch !== undefined) return oklchToOklab(oklch.l, oklch.c, oklch.h);
  const long = /^#[0-9a-f]{3}$/i.test(value.trim())
    ? `#${value.trim().slice(1).split('').map((d) => d + d).join('')}`
    : value.trim();
  return hexToOklab(long);
}

/**
 * Whether a literal falls outside sRGB, measured on the unclamped path.
 * @param {string} value
 */
export function isOutOfGamut(value) {
  const epsilon = 1e-7;
  return oklabToLinearSrgb(literalToOklab(value)).some((channel) => channel < -epsilon || channel > 1 + epsilon);
}

/**
 * Euclidean distance in OKLab.
 * @param {Oklab} x
 * @param {Oklab} y
 */
export function deltaEOK(x, y) {
  return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b);
}

// ---------------------------------------------------------------------------
// brand.json
// ---------------------------------------------------------------------------

/**
 * @typedef {object} Brand
 * @property {string} license
 * @property {string} copyright
 * @property {{ file: string, sha256: string }} source
 * @property {string} conversion
 * @property {{ inGamut: number, clamped: number, unit: string }} tolerance
 * @property {Record<string, string>} colors
 * @property {string[]} clamped
 */

/**
 * brand.json's content, from core.css's text.
 * @param {string} coreCss
 * @returns {Brand}
 */
export function buildBrand(coreCss) {
  const tokens = parseThemeTokens(coreCss).light ?? {};
  /** @type {Record<string, string>} */
  const colors = {};
  /** @type {string[]} */
  const clamped = [];
  for (const name of BRAND_NAMES) {
    const literal = tokens[`--${name}`];
    if (literal === undefined) throw new Error(`core.css does not declare --${name}`);
    const rgb = parseColor(literal);
    if (rgb === undefined) throw new Error(`--${name} is not a colour the gate can parse: ${literal}`);
    colors[name] = `#${toHexByte(rgb.r)}${toHexByte(rgb.g)}${toHexByte(rgb.b)}`;
    if (isOutOfGamut(literal)) clamped.push(name);
  }
  return {
    license: LICENSE,
    copyright: COPYRIGHT,
    source: { file: 'core.css', sha256: createHash('sha256').update(coreCss, 'utf8').digest('hex') },
    conversion: 'OKLCH to sRGB, each channel clamped to 0..1, rounded to 8 bits',
    tolerance: { ...TOLERANCE, unit: 'deltaE OK' },
    colors,
    clamped,
  };
}

/** @param {Brand} brand */
export function serializeBrand(brand) {
  return `${JSON.stringify(brand, null, 2)}\n`;
}

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function runCli() {
  const coreCss = readFileSync(join(PACKAGE_ROOT, 'core.css'), 'utf8');
  const text = serializeBrand(buildBrand(coreCss));
  const target = join(PACKAGE_ROOT, 'brand.json');
  if (process.argv.includes('--check')) {
    let current = '';
    try {
      current = readFileSync(target, 'utf8');
    } catch {
      current = '';
    }
    if (current !== text) {
      console.error('brand.json is stale: run node gates/brand.mjs');
      process.exit(1);
    }
    console.info('brand.json is current');
    return;
  }
  writeFileSync(target, text);
  console.info(`wrote brand.json (${String(BRAND_NAMES.length)} colours)`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) runCli();
