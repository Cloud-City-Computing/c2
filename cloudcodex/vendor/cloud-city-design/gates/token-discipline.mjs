// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cloud City Computing, LLC

// Token discipline: three source-level rules a stylesheet linter cannot
// express, each returning findings as plain data.
//
//   token-literal-color       a literal colour (hex or a colour function)
//                             outside the stylesheet that defines the tokens
//   token-accent-position     an accent FILL shade used as text, an icon, a
//                             stroke, an outline or a shadow
//   token-outline-suppressed  a focus outline turned off
//
// The second rule is why the first is not enough on its own: banning raw hex
// still permits `color: var(--brand-blue)`, which resolves to a blue that is
// too light for small text on a light surface.
//
// A finding is `{ rule, file, line, message }`. The message is for people; a
// consumer comparing two runs compares `(rule, file, line)`.
//
// Zero dependencies: node: built-ins only, and nothing newer than Node 20.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @typedef {object} TokenFinding
 * @property {'token-literal-color' | 'token-accent-position' | 'token-outline-suppressed'} rule
 * @property {string} file
 * @property {number} line 1-based.
 * @property {string} message
 */

/** The extensions `collectScanTargets` walks for when none are given. */
export const DEFAULT_EXTENSIONS = Object.freeze(['.ts', '.tsx', '.css', '.html']);

/**
 * The accent shades too light for a text position: the brand blue and the
 * four lightest accent steps. A consumer adds its own fill aliases through
 * `scanAccentRampPositions`'s `extraNames` option.
 */
export const DEFAULT_ACCENT_FILL_NAMES = Object.freeze([
  '--brand-blue',
  '--accent-100',
  '--accent-200',
  '--accent-300',
  '--accent-400',
]);

// Both comment syntaxes: script files use `//`, stylesheets only have `/* */`.
const EXEMPT_RE = /(?:\/\/|\/\*)\s*invariant-exempt:\s*\S/;

/**
 * Blanks out comment CONTENT while preserving every offset and newline, so a
 * hex code discussed in a comment is not a finding but line numbers still
 * line up. String literals are tracked so a `//` inside a quoted URL does not
 * swallow the rest of the line.
 *
 * Offsets are UTF-16 code units, the unit every string index in JavaScript
 * counts in, so an astral character before a comment does not shift the mask.
 *
 * Documented behaviours, kept for equality with the implementation this
 * module is held to: quotes are tracked in every file type, so an apostrophe
 * in HTML text opens a "string" that runs to the next apostrophe (and a
 * comment inside it is not masked); and an unquoted `url(//host/x)` in a
 * stylesheet reads as a `//` comment.
 *
 * @param {string} source
 * @returns {string}
 */
export function maskComments(source) {
  const out = source.split('');
  let index = 0;
  /** @type {string | null} */
  let quote = null;

  while (index < source.length) {
    const char = source.charAt(index);

    if (quote !== null) {
      if (char === '\\') {
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      index += 1;
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      index += 1;
      continue;
    }

    if (char === '/' && source.charAt(index + 1) === '/') {
      while (index < source.length && source.charAt(index) !== '\n') {
        out[index] = ' ';
        index += 1;
      }
      continue;
    }

    if (char === '/' && source.charAt(index + 1) === '*') {
      const end = source.indexOf('*/', index + 2);
      const stop = end === -1 ? source.length : end + 2;
      while (index < stop) {
        if (source.charAt(index) !== '\n') out[index] = ' ';
        index += 1;
      }
      continue;
    }

    if (char === '<' && source.startsWith('<!--', index)) {
      const end = source.indexOf('-->', index + 4);
      const stop = end === -1 ? source.length : end + 3;
      while (index < stop) {
        if (source.charAt(index) !== '\n') out[index] = ' ';
        index += 1;
      }
      continue;
    }

    index += 1;
  }

  return out.join('');
}

// An `invariant-exempt: <reason>` marker, in either comment syntax, exempts
// its own line and the line below it. A `//` marker with nothing after the
// colon exempts nothing. In the block-comment form the closing `*/` counts as
// the reason, so a block marker with no reason still exempts (a documented
// behaviour, kept for equality).
/**
 * @param {readonly string[]} lines
 * @param {number} lineIndex
 */
function isExemptAt(lines, lineIndex) {
  const current = lines[lineIndex];
  const above = lineIndex > 0 ? lines[lineIndex - 1] : undefined;
  return (current !== undefined && EXEMPT_RE.test(current)) || (above !== undefined && EXEMPT_RE.test(above));
}

const HEX_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g;
// Every colour function, OKLCH and its relatives included: a rule that only
// catches the notations nobody writes in is decoration.
const FUNCTIONAL_COLOR_RE = /\b(?:rgba?|hsla?|oklch|oklab|lch|lab|hwb|color)\s*\(/gi;
const HREF_BEFORE_RE = /href\s*=\s*["'{]?\s*$/i;

/**
 * Every literal colour in `source`: a 3-, 4-, 6- or 8-digit hex, or any colour
 * function. A hex directly after `href=` is a fragment, and `#root` is not
 * hex, so neither is reported. Comments are masked; strings are not.
 *
 * @param {string} source
 * @param {string} file
 * @returns {TokenFinding[]}
 */
export function scanRawColorLiterals(source, file) {
  const originalLines = source.split('\n');
  const lines = maskComments(source).split('\n');
  /** @type {TokenFinding[]} */
  const findings = [];

  lines.forEach((line, lineIndex) => {
    if (isExemptAt(originalLines, lineIndex)) return;

    HEX_RE.lastIndex = 0;
    let match = HEX_RE.exec(line);
    while (match !== null) {
      if (!HREF_BEFORE_RE.test(line.slice(0, match.index))) {
        findings.push({
          rule: 'token-literal-color',
          file,
          line: lineIndex + 1,
          message: `literal colour ${match[0]}; reference a design token instead`,
        });
      }
      match = HEX_RE.exec(line);
    }

    FUNCTIONAL_COLOR_RE.lastIndex = 0;
    let functional = FUNCTIONAL_COLOR_RE.exec(line);
    while (functional !== null) {
      findings.push({
        rule: 'token-literal-color',
        file,
        line: lineIndex + 1,
        message: `literal colour ${functional[0].trim()}); reference a design token instead`,
      });
      functional = FUNCTIONAL_COLOR_RE.exec(line);
    }
  });

  return findings;
}

// A fill shade in a text, icon or edge position. The lookbehind is what keeps
// `background-color:` out of it: a fill shade as a background IS the correct
// use. `outline`, `outline-color`, `box-shadow` and `border-color` are here
// because that is where a focus ring lives.
const ACCENT_POSITIONS = 'color|fill|stroke|outline|outline-color|box-shadow|border-color';
const NAME_RE = /^--[\w-]+$/;

/** @param {string} text */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** @type {Map<string, RegExp>} */
const accentPatterns = new Map();

/** @param {readonly string[]} names */
function accentPositionPattern(names) {
  const key = names.join('|');
  let pattern = accentPatterns.get(key);
  if (pattern === undefined) {
    const alternation = names.map(escapeRegExp).join('|');
    pattern = new RegExp(
      String.raw`(?<![-\w])(${ACCENT_POSITIONS})\s*:\s*[^;{}]*?var\(\s*(${alternation})\s*\)`,
      'g',
    );
    accentPatterns.set(key, pattern);
  }
  return pattern;
}

/**
 * Every accent fill shade used in a text, icon or edge position.
 *
 * The banned names are `DEFAULT_ACCENT_FILL_NAMES` plus `options.extraNames`,
 * where a consumer lists its own fill aliases. Each extra name must be a
 * custom-property name (`--` then word characters and hyphens), or the call
 * throws.
 *
 * @param {string} source
 * @param {string} file
 * @param {{ extraNames?: readonly string[] }} [options]
 * @returns {TokenFinding[]}
 */
export function scanAccentRampPositions(source, file, options = {}) {
  const extraNames = options.extraNames ?? [];
  for (const name of extraNames) {
    if (typeof name !== 'string' || !NAME_RE.test(name)) {
      throw new TypeError(`scanAccentRampPositions: extraNames entry ${JSON.stringify(name)} is not a custom-property name`);
    }
  }
  const pattern = accentPositionPattern([...DEFAULT_ACCENT_FILL_NAMES, ...extraNames]);

  const originalLines = source.split('\n');
  const masked = maskComments(source);
  /** @type {TokenFinding[]} */
  const findings = [];

  pattern.lastIndex = 0;
  let match = pattern.exec(masked);
  while (match !== null) {
    const lineIndex = masked.slice(0, match.index).split('\n').length - 1;
    if (!isExemptAt(originalLines, lineIndex)) {
      findings.push({
        rule: 'token-accent-position',
        file,
        line: lineIndex + 1,
        message:
          `${match[2] ?? ''} in a ${match[1] ?? ''}: position is a fill shade; ` +
          'use a text-safe accent step such as --accent-600 for text and icons',
      });
    }
    pattern.lastIndex = match.index + 1;
    match = pattern.exec(masked);
  }

  return findings;
}

// Broader than `outline: none` on purpose: `outline: 0`, `outline-width: 0`
// and `outline-style: none` all do the same thing. The optional quote is for
// an inline style object, `{ outline: 'none' }`. An outline that names a
// value, such as `outline: 2px solid <colour>`, is the rule being obeyed.
const OUTLINE_SUPPRESSION_RE =
  /(?<![-\w])(outline|outline-style|outline-width)\s*:\s*(['"\`]?)\s*(none|0(?:px|em|rem|%)?)\s*\2\s*(?=[;,}\n]|$)/gi;

/**
 * Every focus outline turned off. The focus ring is the one signal a keyboard
 * user cannot do without, so it is restyled, never removed.
 *
 * @param {string} source
 * @param {string} file
 * @returns {TokenFinding[]}
 */
export function scanSuppressedOutlines(source, file) {
  const originalLines = source.split('\n');
  const masked = maskComments(source);
  /** @type {TokenFinding[]} */
  const findings = [];

  OUTLINE_SUPPRESSION_RE.lastIndex = 0;
  let match = OUTLINE_SUPPRESSION_RE.exec(masked);
  while (match !== null) {
    const lineIndex = masked.slice(0, match.index).split('\n').length - 1;
    if (!isExemptAt(originalLines, lineIndex)) {
      findings.push({
        rule: 'token-outline-suppressed',
        file,
        line: lineIndex + 1,
        message:
          `${match[1] ?? 'outline'}: ${match[3] ?? ''} suppresses the focus ring; ` +
          'restyle the ring, do not remove it',
      });
    }
    OUTLINE_SUPPRESSION_RE.lastIndex = match.index + 1;
    match = OUTLINE_SUPPRESSION_RE.exec(masked);
  }

  return findings;
}

/**
 * Every file under `roots` (relative to `base`) whose name ends in one of
 * `extensions`, as absolute paths. A root that is a file is taken as is,
 * whatever its extension; a missing root is skipped.
 *
 * @param {string} base
 * @param {readonly string[]} roots
 * @param {readonly string[]} [extensions]
 * @returns {string[]}
 */
export function collectScanTargets(base, roots, extensions = DEFAULT_EXTENSIONS) {
  /** @type {string[]} */
  const files = [];

  for (const root of roots) {
    const full = join(base, root);
    if (!existsSync(full)) continue;

    if (statSync(full).isFile()) {
      files.push(full);
      continue;
    }

    for (const entry of readdirSync(full, { recursive: true, encoding: 'utf8' })) {
      const candidate = join(full, entry);
      if (!extensions.some((extension) => candidate.endsWith(extension))) continue;
      if (!statSync(candidate).isFile()) continue;
      files.push(candidate);
    }
  }

  return files;
}
