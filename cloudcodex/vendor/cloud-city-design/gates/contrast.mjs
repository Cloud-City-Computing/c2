// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cloud City Computing, LLC

// Colour maths for a token-contrast gate.
//
// A design system written in OKLCH is reviewed by eye, and nothing short of a
// browser can say whether a pair of its colours clears 4.5:1. This module is
// that answer as pure functions: parse a stylesheet of custom properties,
// resolve each theme's variables (var() chains included), convert OKLCH to
// sRGB, and apply the WCAG relative-luminance formula.
//
// Gamut: an OKLCH value outside sRGB is CLAMPED per channel rather than
// gamut-mapped the way a browser does. For a contrast gate clamping is the
// conservative direction: it can only move a channel toward an extreme, so a
// pair that passes here passes in the browser too.
//
// Zero dependencies: node: built-ins only, and nothing newer than Node 20.
import { readFileSync } from 'node:fs';

/**
 * @typedef {object} Rgb
 * @property {number} r Gamma-encoded sRGB, 0..1.
 * @property {number} g Gamma-encoded sRGB, 0..1.
 * @property {number} b Gamma-encoded sRGB, 0..1.
 * @property {number} alpha 0..1, and 1 for every opaque colour.
 */

/**
 * @typedef {object} Oklch
 * @property {number} l
 * @property {number} c
 * @property {number} h
 * @property {number} alpha
 */

/** @typedef {Record<string, string>} TokenMap */

/** @param {number} value */
const clamp01 = (value) => Math.min(1, Math.max(0, value));

/** @param {number} channel */
function linearToSrgb(channel) {
  const c = clamp01(channel);
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** @param {number} channel */
function srgbToLinear(channel) {
  return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

const NUMBER = String.raw`[-+]?(?:\d*\.\d+|\d+)%?`;
const OKLCH_RE = new RegExp(
  String.raw`^oklch\(\s*(${NUMBER})\s+(${NUMBER})\s+(${NUMBER})\s*(?:/\s*(${NUMBER})\s*)?\)$`,
  'i',
);

/**
 * @param {string} raw
 * @param {number} percentBase
 */
function num(raw, percentBase) {
  return raw.endsWith('%') ? (Number.parseFloat(raw.slice(0, -1)) / 100) * percentBase : Number.parseFloat(raw);
}

/**
 * `oklch(L C H)` or `oklch(L C H / A)`, each part a number or a percentage.
 * @param {string} value
 * @returns {Oklch | undefined}
 */
export function parseOklch(value) {
  const match = OKLCH_RE.exec(value.trim());
  if (match === null) return undefined;
  return {
    l: num(match[1] ?? '0', 1),
    c: num(match[2] ?? '0', 0.4),
    h: num(match[3] ?? '0', 360),
    alpha: match[4] === undefined ? 1 : num(match[4], 1),
  };
}

/**
 * OKLCH to gamma-encoded sRGB, each channel clamped to 0..1.
 * @param {Oklch} color
 * @returns {Rgb}
 */
export function oklchToRgb({ l, c, h, alpha }) {
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);

  const lp = l + 0.3963377774 * a + 0.2158037573 * b;
  const mp = l - 0.1055613458 * a - 0.0638541728 * b;
  const sp = l - 0.0894841775 * a - 1.291485548 * b;

  const lCubed = lp * lp * lp;
  const mCubed = mp * mp * mp;
  const sCubed = sp * sp * sp;

  return {
    r: linearToSrgb(4.0767416621 * lCubed - 3.3077115913 * mCubed + 0.2309699292 * sCubed),
    g: linearToSrgb(-1.2684380046 * lCubed + 2.6097574011 * mCubed - 0.3413193965 * sCubed),
    b: linearToSrgb(-0.0041960863 * lCubed - 0.7034186147 * mCubed + 1.707614701 * sCubed),
    alpha,
  };
}

const HEX_RE = /^#(?:([0-9a-f]{3})|([0-9a-f]{6}))$/i;

/**
 * An OKLCH value or a 3- or 6-digit hex colour. Anything else, including 4-
 * and 8-digit hex and every other notation, is undefined: the gate answers
 * for the notations a token is written in and refuses to guess at the rest.
 * @param {string} value
 * @returns {Rgb | undefined}
 */
export function parseColor(value) {
  const trimmed = value.trim();

  const oklch = parseOklch(trimmed);
  if (oklch !== undefined) return oklchToRgb(oklch);

  const hex = HEX_RE.exec(trimmed);
  if (hex !== null) {
    const short = hex[1];
    const long =
      hex[2] ??
      (short === undefined
        ? undefined
        : short
            .split('')
            .map((d) => d + d)
            .join(''));
    if (long === undefined) return undefined;
    return {
      r: Number.parseInt(long.slice(0, 2), 16) / 255,
      g: Number.parseInt(long.slice(2, 4), 16) / 255,
      b: Number.parseInt(long.slice(4, 6), 16) / 255,
      alpha: 1,
    };
  }

  return undefined;
}

/**
 * Flattens a translucent colour onto an opaque one. Alpha is not contrast.
 * @param {Rgb} foreground
 * @param {Rgb} background
 * @returns {Rgb}
 */
export function compositeOver(foreground, background) {
  const a = foreground.alpha;
  if (a >= 1) return foreground;
  return {
    r: foreground.r * a + background.r * (1 - a),
    g: foreground.g * a + background.g * (1 - a),
    b: foreground.b * a + background.b * (1 - a),
    alpha: 1,
  };
}

/**
 * WCAG 2.x relative luminance.
 * @param {Rgb} color
 */
export function relativeLuminance({ r, g, b }) {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/**
 * WCAG 2.x contrast ratio, 1..21. A translucent foreground is flattened first.
 * @param {Rgb} foreground
 * @param {Rgb} background
 */
export function contrastRatio(foreground, background) {
  const flat = compositeOver(foreground, background);
  const a = relativeLuminance(flat);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * @param {number} value
 * @param {number} [places]
 */
export function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------

const DARK_SELECTOR = /\[data-theme=['"]dark['"]\]/;

/** The default themes: one, `dark`, selected by `[data-theme="dark"]` in either quote style. */
export const DEFAULT_THEMES = Object.freeze({ dark: DARK_SELECTOR });

/**
 * The default base test: a selector that mentions `:root` anywhere.
 * @param {string} selector
 */
export function isRootSelector(selector) {
  return selector.includes(':root');
}

/** @param {string} css */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * @param {string} body
 * @returns {TokenMap}
 */
function readDeclarations(body) {
  /** @type {TokenMap} */
  const out = {};
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const name = match[1];
    const value = match[2];
    if (name !== undefined && value !== undefined) out[name] = value.trim();
  }
  return out;
}

/**
 * @typedef {object} ThemeTokensOptions
 * @property {(selector: string) => boolean} [isBase] Which blocks form the
 *   base (light) map. Defaults to `isRootSelector`. Checked FIRST: a block the
 *   base test accepts is never also a theme block.
 * @property {Record<string, RegExp>} [themes] Each theme's selector test,
 *   tried in key order; a block joins the first theme whose pattern matches.
 *   Defaults to `DEFAULT_THEMES`. A theme may not be named `light`.
 */

/**
 * Parses a stylesheet into a base map, `light`, and one map per theme.
 *
 * `light` is every base block merged in source order. Each theme is that map
 * with its own blocks laid over it, which is how the cascade resolves it in a
 * browser, and why a name absent from a theme block is shared by both.
 *
 * Two behaviours are deliberate copies of the implementation this module is
 * held equal to, and are documented rather than fixed:
 *   - a `:root[data-theme="dark"]` block mentions `:root`, so under the
 *     default base test it lands in `light`, not in `dark`;
 *   - a block nested in an at-rule (`@media ... { :root { ... } }`) is read as
 *     an ordinary block, so its declarations merge into the base.
 * A consumer that needs otherwise passes its own `isBase` and `themes`.
 *
 * @param {string} css
 * @param {ThemeTokensOptions} [options]
 * @returns {Record<string, TokenMap>} `{ light, ...themes }`; with the defaults, `{ light, dark }`.
 */
export function parseThemeTokens(css, options = {}) {
  const isBase = options.isBase ?? isRootSelector;
  const themes = options.themes ?? DEFAULT_THEMES;
  const themeNames = Object.keys(themes);
  if (themeNames.includes('light')) throw new Error('parseThemeTokens: a theme may not be named "light"');

  const clean = stripComments(css);
  /** @type {TokenMap} */
  const light = {};
  /** @type {Record<string, TokenMap>} */
  const overlays = {};
  for (const name of themeNames) overlays[name] = {};

  for (const match of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (match[1] ?? '').trim();
    const declarations = readDeclarations(match[2] ?? '');
    if (isBase(selector)) {
      Object.assign(light, declarations);
      continue;
    }
    for (const name of themeNames) {
      const pattern = themes[name];
      if (pattern === undefined) continue;
      pattern.lastIndex = 0;
      if (pattern.test(selector)) {
        Object.assign(overlays[name] ?? {}, declarations);
        break;
      }
    }
  }

  /** @type {Record<string, TokenMap>} */
  const result = { light };
  for (const name of themeNames) result[name] = { ...light, ...overlays[name] };
  return result;
}

/**
 * `parseThemeTokens` over a file.
 * @param {string} path
 * @param {ThemeTokensOptions} [options]
 */
export function loadThemeTokens(path, options = {}) {
  return parseThemeTokens(readFileSync(path, 'utf8'), options);
}

const VAR_RE = /^var\(\s*(--[\w-]+)\s*\)$/;

/**
 * Follows `var()` chains inside one theme and returns the LITERAL the chain
 * lands on, still as CSS text, so a mismatch reads as two CSS values rather
 * than two rounded RGB triples. A chain deeper than 10 (a cycle) is
 * undefined. A `var()` with a fallback is not followed: it is returned as is.
 * @param {TokenMap} tokens
 * @param {string} name
 * @param {number} [depth]
 * @returns {string | undefined}
 */
export function resolveTokenValue(tokens, name, depth = 0) {
  if (depth > 10) return undefined;
  const raw = tokens[name];
  if (raw === undefined) return undefined;

  const indirect = VAR_RE.exec(raw.trim());
  if (indirect !== null) return resolveTokenValue(tokens, indirect[1] ?? '', depth + 1);

  return raw.trim();
}

/**
 * Follows `var()` chains inside one theme, then parses the literal it lands on.
 * @param {TokenMap} tokens
 * @param {string} name
 * @param {number} [depth]
 * @returns {Rgb | undefined}
 */
export function resolveToken(tokens, name, depth = 0) {
  const raw = resolveTokenValue(tokens, name, depth);
  if (raw === undefined) return undefined;
  return parseColor(raw);
}
