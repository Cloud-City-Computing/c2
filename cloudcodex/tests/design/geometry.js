/**
 * The geometry of the deferred families: every non-colour declaration of the editor canvas, comments and GitHub
 * surface, and the definitions of every token those declarations read, reduced to a stable list that
 * tests/design/geometry-fingerprint.json pins (K3, W6-CDX-43)
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { createHash } from 'node:crypto';
import { maskComments } from '../../vendor/cloud-city-design/gates/token-discipline.mjs';
import { banners } from './buckets.js';

// The index.css sections that hold the deferred families (docs/specs/roadmap.md, UI-later). Each banner runs to the
// next one. tests/design/ledger.json's _later keys name the same sections.
export const DEFERRED_SECTIONS = [
  'Mentions (inline @user chips)', 'GitHub Integration', 'Editor Log', 'Markdown Editor', 'Version History',
  'Collaborative Editing - Presence UI', 'Remote Cursors - Collaborative Editing', 'Comments & Annotations',
  'Read-only Document View', 'Code Block with Language Selector', 'Syntax Highlighting (highlight.js compatible - dark theme)',
  'Draw.io Diagram Block',
];

// A rule outside those sections that still styles a deferred family, by the class names it carries.
const DEFERRED_SELECTOR = /\.(tiptap|editor-|comment|gh-|drawio|version-history|markdown-editor|document-readonly|remote-cursor)|\[class\*=["']gh-["']\]/;

// A declaration whose value is a colour and nothing else. `color`, every `-color` longhand and fill/stroke are colour
// properties: their value is not fingerprinted at all. A colour-only change moves nothing else.
const COLOUR_PROPERTY = /(^|-)color$|^(fill|stroke)$/;

// A property whose value can carry a colour alongside geometry (a border's width, a gradient's stops, a shadow's
// offsets). Its colour terms are normalised to a placeholder; every other word, and every token it reads, still counts.
const MIXED_PROPERTY = /^(background|background-image|border|border-(top|right|bottom|left|block|inline)(-(start|end))?|outline|text-decoration|column-rule|filter|text-shadow|box-shadow)$/;

const COLOUR_FN_RE = /\b(?:rgba?|hsla?|oklch|oklab|lch|lab|hwb|color)\((?:[^()]|\([^()]*\))*\)/gi;
const HEX_RE = /#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z_-])/g;
const VAR_RE = /var\((?:[^()]|\([^()]*\))*\)/g;
const VAR_NAME_RE = /var\(\s*(--[\w-]+)/g;

/** The colour terms of a value, each replaced by one placeholder. Tokens are left as they are. */
export function stripColour(value) {
  return value.replace(COLOUR_FN_RE, '<c>').replace(HEX_RE, '<c>').replace(/\s+/g, ' ').trim();
}

/** A mixed value: its colour terms and its token reads both become placeholders (the tokens are followed separately). */
export function normaliseMixed(value) {
  return stripColour(value.replace(VAR_RE, '<c>'));
}

/** Every innermost rule of a stylesheet, with its line and section (the last banner at or above it, as buckets.js). */
export function rulesOf(css) {
  const masked = maskComments(css);
  const marks = banners(css);
  const lineOf = (index) => masked.slice(0, index).split('\n').length;
  const rules = [];
  for (const match of masked.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const start = match.index + match[1].length;
    const line = lineOf(start);
    const section = marks.filter((b) => b.line <= line).pop()?.name ?? '(file)';
    rules.push({ selector: match[1].trim().replace(/\s+/g, ' '), body: match[2], line, section });
  }
  return rules;
}

/** Whether a rule belongs to the deferred families: in a deferred section, or styling a deferred class. */
export function isDeferredRule(rule) {
  return DEFERRED_SECTIONS.includes(rule.section) || DEFERRED_SELECTOR.test(rule.selector);
}

/** Every declaration of a body as [property, value], the value without !important. */
function declarationsOf(body) {
  const out = [];
  for (const declaration of body.split(';')) {
    const i = declaration.indexOf(':');
    if (i < 0) continue;
    const property = declaration.slice(0, i).trim().toLowerCase();
    const value = declaration.slice(i + 1).replace(/!important/i, '').trim().replace(/\s+/g, ' ');
    if (property && value) out.push([property, value]);
  }
  return out;
}

/** Every custom-property definition in the given stylesheets: name to [{ selector, value }]. */
export function definitionsOf(sources) {
  const defs = new Map();
  for (const css of sources) {
    for (const rule of rulesOf(css)) {
      for (const [property, value] of declarationsOf(rule.body)) {
        if (!property.startsWith('--')) continue;
        if (!defs.has(property)) defs.set(property, []);
        defs.get(property).push({ selector: rule.selector, value });
      }
    }
  }
  return defs;
}

const namesIn = (value) => [...value.matchAll(VAR_NAME_RE)].map((m) => m[1]);

/**
 * The non-colour lines of the deferred families, plus the definitions of every token they read, followed through
 * the tokens' own reads. A definition's colour terms are placeholders, so a colour-only change to a token moves
 * nothing, while a radius, space, font, line height or shadow offset does.
 */
export function geometryLines(css, sources = [css]) {
  const defs = definitionsOf(sources);
  const lines = [];
  const read = new Set();
  const tokenLines = new Set();
  for (const rule of rulesOf(css).filter(isDeferredRule)) {
    for (const [property, value] of declarationsOf(rule.body)) {
      if (COLOUR_PROPERTY.test(property)) continue;
      let normalised = value;
      if (MIXED_PROPERTY.test(property)) normalised = normaliseMixed(value);
      // A token read in a colour position (a background, a border's colour) is colour-only, so it is not followed.
      // A shadow's tokens are followed: their offsets and blur are geometry, and only their colour is stripped.
      if (!MIXED_PROPERTY.test(property) || property === 'box-shadow') {
        for (const name of namesIn(stripColour(value))) read.add(name);
      }
      lines.push(`${rule.selector} {${property}: ${normalised}}`);
    }
  }
  // Follow every token read, and every token that a read token reads, to its definitions.
  const queue = [...read];
  const seen = new Set();
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const found = defs.get(name);
    if (!found) {
      lines.push(`token ${name} <undeclared>`);
      continue;
    }
    for (const { value } of found) {
      // A definition is geometry when a number is left once its colour and its token names are stripped. A colour
      // alias or a colour definition has none, so the colour pass adds no line for it; the tokens it reads are still followed.
      const stripped = stripColour(value);
      // Per theme a token may be defined twice; the line is the value, so a second theme with the same geometry adds nothing.
      if (/\d/.test(stripped.replace(/var\([^)]*\)/g, ''))) tokenLines.add(`token ${name} = ${stripped}`);
      for (const inner of namesIn(stripColour(value))) queue.push(inner);
    }
  }
  return [...lines, ...tokenLines].sort();
}

/** The fingerprint a test pins: the count of lines and their SHA-256. */
export function geometryFingerprint(css, sources = [css]) {
  const lines = geometryLines(css, sources);
  return {
    declarations: lines.length,
    sha256: createHash('sha256').update(lines.join('\n')).digest('hex'),
  };
}
