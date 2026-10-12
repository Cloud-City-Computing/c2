/**
 * W6-CDX-38: a var() fallback never carries a colour, and the thirteen undeclared names are declared or replaced.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { declaredNames } from '../../vendor/cloud-city-design/gates/dangling.mjs';
import { ROOT, EXTENSIONS } from './buckets.js';

const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = path.join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const sources = walk(path.join(ROOT, 'src')).filter((f) => EXTENSIONS.some((e) => f.endsWith(e)));
const declared = new Set([
  ...sources.filter((f) => f.endsWith('.css')).flatMap((f) => declaredNames(readFileSync(f, 'utf8'))),
  ...declaredNames(readFileSync(path.join(ROOT, 'vendor/cloud-city-design/core.css'), 'utf8')),
]);

// var(--name, fallback) reads, with the file and line of each.
const reads = sources.flatMap((file) => readFileSync(file, 'utf8').split('\n').flatMap((line, i) => [
  ...line.matchAll(/var\((--[\w-]+)\s*,\s*([^)]*)\)/g),
].map((m) => ({ name: m[1], fallback: m[2].trim(), at: `${path.relative(ROOT, file)}:${i + 1}` }))));

const COLOUR = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(|\b(?:red|blue|white|black|grey|gray)\b/i;

describe('var() fallbacks', () => {
  it('no fallback literal is a colour', () => {
    expect(reads.filter(({ fallback }) => COLOUR.test(fallback)).map(({ at, name, fallback }) => `${at} ${name} ${fallback}`))
      .toEqual([]);
  });

  it('names no undeclared custom property with a fallback, except the two set by script', () => {
    const SET_BY_SCRIPT = ['--density-scale', '--editor-font-size'];
    const undeclared = [...new Set(reads.filter(({ name }) => !declared.has(name)).map(({ name }) => name))]
      .filter((name) => !SET_BY_SCRIPT.includes(name));
    expect(undeclared).toEqual([]);
  });
});
