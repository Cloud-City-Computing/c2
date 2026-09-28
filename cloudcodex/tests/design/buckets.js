/**
 * Groups token-discipline findings into ledger buckets: per file, and per section banner inside index.css
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectScanTargets, scanRawColorLiterals, scanAccentRampPositions, scanSuppressedOutlines,
} from '../../vendor/cloud-city-design/gates/token-discipline.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Codex is plain JavaScript: the package's default walk (.ts, .tsx, .css,
// .html) would read none of its .js or .jsx files and pass while seeing little.
export const EXTENSIONS = ['.css', '.js', '.jsx', '.html'];
export const SCAN_ROOTS = ['index.html', 'src'];

// Codex's own accent fill alias (declared in src/codex.css), banned from text
// and edge positions exactly like the package's fill shades.
export const ACCENT_FILL_ALIASES = ['--cx-accent-fill'];

const INDEX_CSS = 'src/index.css';

// The stylesheet that defines Codex's tokens. Its literal colours are the
// definitions (the package has no neutrals, so Codex's surfaces and text are
// literals here), and the contrast gate measures them; the literal-colour
// rule skips this one file, and the other two rules still read it.
export const TOKEN_DEFINITIONS = ['src/codex.css'];

/** Repo-relative path with forward slashes, so ledger keys match on every OS. */
export function relativePath(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

// A banner title as a ledger key: an em dash in a title (index.css has two)
// becomes a hyphen, so the ledger's keys are plain ASCII punctuation.
const keyOf = (title) => title.trim().replace(/\s*\u2014\s*/g, ' - ');

// index.css uses two banner shapes: a title on the line under a `/* ====`
// rule, and the one-line `/* ─── GitHub Integration ─── */`.
export function banners(source) {
  const lines = source.split('\n');
  const found = [];
  lines.forEach((line, i) => {
    if (/^\/\* ={5,}/.test(line) && lines[i + 1]) found.push({ line: i + 1, name: keyOf(lines[i + 1]) });
    const inline = /^\/\* ─── (.+?) ─+ \*\/$/.exec(line);
    if (inline) found.push({ line: i + 1, name: keyOf(inline[1]) });
  });
  return found;
}

/** Every token-discipline finding in one file's source. */
export function scanSource(source, rel) {
  return [
    ...(TOKEN_DEFINITIONS.includes(rel) ? [] : scanRawColorLiterals(source, rel)),
    ...scanAccentRampPositions(source, rel, { extraNames: ACCENT_FILL_ALIASES }),
    ...scanSuppressedOutlines(source, rel),
  ];
}

/** The files the gate reads, absolute. */
export function scanTargets() {
  return collectScanTargets(ROOT, SCAN_ROOTS, EXTENSIONS);
}

/**
 * The live findings grouped as { file: { section: count } }. A finding in
 * index.css falls in the bucket of the last banner at or above its line, or
 * in "(file)" above the first banner; every other file is one "(file)" bucket.
 */
export function liveBuckets() {
  const buckets = {};
  for (const file of scanTargets()) {
    const source = readFileSync(file, 'utf8');
    const rel = relativePath(file);
    const marks = rel === INDEX_CSS ? banners(source) : [];
    for (const finding of scanSource(source, rel)) {
      const mark = marks.filter((b) => b.line <= finding.line).pop();
      const key = mark ? mark.name : '(file)';
      buckets[rel] ??= {};
      buckets[rel][key] = (buckets[rel][key] ?? 0) + 1;
    }
  }
  return buckets;
}

/** The sum of every bucket in a { file: { section: count } } map; keys starting with `_` are notes. */
export function total(buckets) {
  return Object.entries(buckets)
    .filter(([file]) => !file.startsWith('_'))
    .reduce((sum, [, sections]) => sum + Object.values(sections).reduce((a, b) => a + b, 0), 0);
}
