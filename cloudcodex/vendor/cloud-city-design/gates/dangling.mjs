// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cloud City Computing, LLC

// The dangling-var gate.
//
// An undeclared custom property is invalid at computed-value time: the
// property falls back to inherit or initial, silently, and no other check
// notices, because the reference is well-formed CSS. A consumer that binds its
// own names over this package's primitives makes this cheap to get wrong: a
// primitive renamed here would leave `font-family: var(--font-ui)` in the
// consumer pointing at nothing.
//
// Two halves, kept apart so the scanner can be tested with no disk:
//   scanDanglingVars(source, file, declared)   pure: one file, a declared set
//   inspectDangling({ base, declarationRoots, referrerRoots, extensions })
//                                              the gate over a tree, plus what
//                                              it read (files, reference
//                                              sites, names), so a test can
//                                              prove it was not looking at
//                                              nothing
//   runDangling(options)                       the same run, findings only
//
// A finding is `{ rule: 'dangling-var', file, line, name }`, and a consumer
// comparing two runs compares `(rule, file, line)`.
//
// Out of scope, by design: `var(--x, fallback)`. A fallback is the author
// saying "this may be absent", so it is not a dangling reference. Also out of
// scope: whether a name is declared on a selector that matches the element;
// this gate sees names, not the cascade.
//
// Zero dependencies: node: built-ins only, and nothing newer than Node 20.
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { DEFAULT_EXTENSIONS, collectScanTargets, maskComments } from './token-discipline.mjs';

/**
 * @typedef {object} DanglingFinding
 * @property {'dangling-var'} rule
 * @property {string} file Relative to the run's `base`, with `/` separators.
 * @property {number} line 1-based.
 * @property {string} name
 */

/**
 * @typedef {object} DanglingOptions
 * @property {string} base The directory every root is relative to.
 * @property {readonly string[]} declarationRoots Where declarations come
 *   from. Only `.css` files are read; files are taken as is, directories
 *   walked. A name declared in any of them resolves a reference anywhere.
 * @property {readonly string[]} referrerRoots The files and directories whose
 *   `var()` references are checked.
 * @property {readonly string[]} [extensions] Which referrer files a walked
 *   directory contributes. Defaults to `DEFAULT_EXTENSIONS`; a code base in
 *   plain JavaScript passes its own list, for example with `.js` and `.jsx`.
 */

/**
 * @typedef {object} DanglingInspection
 * @property {DanglingFinding[]} findings
 * @property {string[]} referrerFiles Every referrer scanned, relative to `base`.
 * @property {number} referenceSites Every `var(--name)` without a fallback checked.
 * @property {Set<string>} referencedNames
 * @property {Set<string>} declared
 */

// A declaration starts a block or follows a `;`. Anchoring on that keeps a BEM
// modifier followed by a pseudo-class (`.card--primary:hover`) from counting
// as a declaration of `--primary`, which would hide a dangling
// `var(--primary)`.
const DECLARATION_RE = /[{;]\s*(--[a-zA-Z0-9_-]+)\s*:/g;
// Only a reference with NO fallback: the name is followed by `)`, not `,`.
const REFERENCE_RE = /var\(\s*(--[a-zA-Z0-9_-]+)\s*\)/g;

/**
 * Every custom-property name declared in a stylesheet, comments masked.
 * @param {string} source
 * @returns {string[]}
 */
export function declaredNames(source) {
  return [...maskComments(source).matchAll(DECLARATION_RE)].map((match) => match[1] ?? '');
}

/**
 * @param {string} source
 * @param {number} offset
 */
function lineAt(source, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

/**
 * Every `var(--name)` in `source` whose name is not in `declared`. Comments
 * are masked (offsets and newlines preserved, so line numbers hold); string
 * contents are NOT, so a var() inside a template string is scanned.
 *
 * @param {string} source
 * @param {string} file
 * @param {ReadonlySet<string>} declared
 * @returns {DanglingFinding[]}
 */
export function scanDanglingVars(source, file, declared) {
  const masked = maskComments(source);
  /** @type {DanglingFinding[]} */
  const findings = [];
  for (const match of masked.matchAll(REFERENCE_RE)) {
    const name = match[1] ?? '';
    if (declared.has(name)) continue;
    findings.push({ rule: 'dangling-var', file, line: lineAt(masked, match.index ?? 0), name });
  }
  return findings;
}

/**
 * The declared set: every name declared in a `.css` file under
 * `declarationRoots`.
 *
 * @param {string} base
 * @param {readonly string[]} declarationRoots
 * @returns {Set<string>}
 */
export function collectDeclaredNames(base, declarationRoots) {
  /** @type {Set<string>} */
  const declared = new Set();
  for (const file of collectScanTargets(base, declarationRoots, ['.css'])) {
    if (!file.endsWith('.css')) continue;
    for (const name of declaredNames(readFileSync(file, 'utf8'))) declared.add(name);
  }
  return declared;
}

/** @param {unknown} options */
function checkOptions(options) {
  const record = /** @type {Record<string, unknown> | null | undefined} */ (options);
  if (record === null || typeof record !== 'object') throw new TypeError('dangling: an options object is required');
  if (typeof record.base !== 'string') throw new TypeError('dangling: options.base must be a directory path');
  for (const key of ['declarationRoots', 'referrerRoots']) {
    if (!Array.isArray(record[key])) throw new TypeError(`dangling: options.${key} must be an array of paths`);
  }
}

/**
 * The gate, with its evidence.
 * @param {DanglingOptions} options
 * @returns {DanglingInspection}
 */
export function inspectDangling(options) {
  checkOptions(options);
  const { base, declarationRoots, referrerRoots } = options;
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS;

  const declared = collectDeclaredNames(base, declarationRoots);
  /** @type {DanglingInspection} */
  const inspection = {
    findings: [],
    referrerFiles: [],
    referenceSites: 0,
    referencedNames: new Set(),
    declared,
  };
  for (const file of collectScanTargets(base, referrerRoots, extensions)) {
    const relativePath = relative(base, file).split('\\').join('/');
    const source = readFileSync(file, 'utf8');
    inspection.referrerFiles.push(relativePath);
    for (const match of maskComments(source).matchAll(REFERENCE_RE)) {
      inspection.referenceSites += 1;
      inspection.referencedNames.add(match[1] ?? '');
    }
    inspection.findings.push(...scanDanglingVars(source, relativePath, declared));
  }
  return inspection;
}

/**
 * The gate, findings only.
 * @param {DanglingOptions} options
 * @returns {DanglingFinding[]}
 */
export function runDangling(options) {
  return inspectDangling(options).findings;
}
