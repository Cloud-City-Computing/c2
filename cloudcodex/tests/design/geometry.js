/**
 * The geometry of the deferred families: every non-colour declaration of the editor canvas, comments and GitHub
 * surface, reduced to a stable list that tests/design/geometry-fingerprint.json pins (K3, W6-CDX-43)
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

// A declaration whose value is a colour and nothing else: the plan's list, read as a rule. `color`, every `-color`
// longhand, fill, stroke and box-shadow are colour properties, so they are not fingerprinted at all.
const COLOUR_PROPERTY = /(^|-)color$|^(fill|stroke|box-shadow)$/;

// A property whose value can carry a colour alongside geometry (a border's width, a gradient's stops, a shadow's
// offsets). The colour part of its value is normalised to a placeholder, so moving a colour into a token is not a
// geometry change, while every other word in the value still counts.
const MIXED_PROPERTY = /^(background|background-image|border|border-(top|right|bottom|left|block|inline)(-(start|end))?|outline|text-decoration|column-rule|filter|text-shadow)$/;

const COLOUR_FN_RE = /\b(?:rgba?|hsla?|oklch|oklab|lch|lab|hwb|color)\((?:[^()]|\([^()]*\))*\)/gi;
const HEX_RE = /#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z_-])/g;
const VAR_RE = /var\((?:[^()]|\([^()]*\))*\)/g;

/** The colour part of a mixed value, replaced by one placeholder per token. */
export function normaliseMixed(value) {
  return value
    .replace(COLOUR_FN_RE, '<c>')
    .replace(HEX_RE, '<c>')
    .replace(VAR_RE, '<c>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Every innermost rule of a stylesheet with its line and section name. A rule's section is the last banner at or
 * above its opening brace, as buckets.js assigns findings.
 */
export function rulesOf(css) {
  const masked = maskComments(css);
  const marks = banners(css);
  const lineOf = (index) => masked.slice(0, index).split('\n').length;
  const rules = [];
  for (const match of masked.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const start = match.index + match[1].length;
    const line = lineOf(start);
    const section = marks.filter((b) => b.line <= line).pop()?.name ?? '(file)';
    rules.push({
      selector: match[1].trim().replace(/\s+/g, ' '),
      body: match[2],
      line,
      section,
    });
  }
  return rules;
}

/** Whether a rule belongs to the deferred families: in a deferred section, or styling a deferred class. */
export function isDeferredRule(rule) {
  return DEFERRED_SECTIONS.includes(rule.section) || DEFERRED_SELECTOR.test(rule.selector);
}

/** The non-colour declarations of the deferred families, one sorted string each: `selector {property: value}`. */
export function geometryLines(css) {
  const lines = [];
  for (const rule of rulesOf(css).filter(isDeferredRule)) {
    for (const declaration of rule.body.split(';')) {
      const i = declaration.indexOf(':');
      if (i < 0) continue;
      const property = declaration.slice(0, i).trim().toLowerCase();
      const value = declaration.slice(i + 1).trim().replace(/\s+/g, ' ');
      if (!property || !value || COLOUR_PROPERTY.test(property)) continue;
      const normalised = MIXED_PROPERTY.test(property) ? normaliseMixed(value) : value;
      lines.push(`${rule.selector} {${property}: ${normalised}}`);
    }
  }
  return lines.sort();
}

/** The fingerprint a test pins: the count of lines and their SHA-256. */
export function geometryFingerprint(css) {
  const lines = geometryLines(css);
  return {
    declarations: lines.length,
    sha256: createHash('sha256').update(lines.join('\n')).digest('hex'),
  };
}
