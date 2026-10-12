/**
 * Dark is unchanged in the deferred families, except where the original dark value fails its contrast gate
 * (W6-CDX-43 review, item 5). tests/design/deferred-dark.json is the resolved dark value of every colour declaration
 * there, taken from the original tree before this track.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseColor, parseThemeTokens, resolveTokenValue } from '../../vendor/cloud-city-design/gates/contrast.mjs';
import { ROOT, THEME_OPTIONS } from './buckets.js';
import { rulesOf, isDeferredRule } from './geometry.js';

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const fixture = JSON.parse(read('tests/design/deferred-dark.json'));
const index = read('src/index.css');
const bridge = /:root\s*\{([^}]*)\}/.exec(index)[1];
const tokens = parseThemeTokens(`${read('vendor/cloud-city-design/core.css')}\n${read('src/codex.css')}\n:root {${bridge}}`, THEME_OPTIONS).dark;

const COLOUR = /(^|-)color$|^(fill|stroke|background|background-color|background-image|border(-[a-z]+)*|outline|box-shadow|text-shadow|text-decoration|column-rule)$/;
/** A colour term as its computed rgba, so the same colour written two ways compares equal. */
function canonTerm(term) {
  const rgba = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/i.exec(term);
  const colour = rgba ? { r: rgba[1] / 255, g: rgba[2] / 255, b: rgba[3] / 255, alpha: Number(rgba[4]) } : parseColor(term);
  if (!colour) return term;
  const to = (v) => Math.round(v * 255);
  return `rgba(${to(colour.r)},${to(colour.g)},${to(colour.b)},${Math.round(colour.alpha * 1000) / 1000})`;
}

/** A value with every colour term canonical and no spacing, for comparison. */
export function canon(value) {
  return value
    .replace(/rgba?\([^)]*\)|oklch\([^)]*\)|#[0-9a-fA-F]{3,8}(?![\w-])/g, canonTerm)
    .replace(/\s+/g, '');
}

function resolve(value) {
  let out = value;
  for (let i = 0; i < 12 && /var\(/.test(out); i += 1) {
    out = out.replace(/var\((--[\w-]+)\)/g, (m, name) => resolveTokenValue(tokens, name) ?? m);
  }
  return out;
}

/** Every colour declaration of the deferred families, resolved to its dark value: key `selector | property`. */
export function darkValues() {
  const map = {};
  for (const rule of rulesOf(index).filter(isDeferredRule)) {
    for (const declaration of rule.body.split(';')) {
      const i = declaration.indexOf(':');
      if (i < 0) continue;
      const property = declaration.slice(0, i).trim().toLowerCase();
      if (!COLOUR.test(property)) continue;
      const value = resolve(declaration.slice(i + 1).replace(/!important/i, '').trim().replace(/\s+/g, ' '));
      (map[`${rule.selector} | ${property}`] ??= []).push(value);
    }
  }
  return map;
}

describe('dark is unchanged in the deferred families, except where the original dark value fails its gate', () => {
  const now = darkValues();

  it('every colour declaration resolves to its original dark value, or is a listed exception with its measured after value', () => {
    const differs = [];
    for (const [key, original] of Object.entries(fixture.dark)) {
      const exception = fixture.exceptions[key];
      const expected = exception ? exception.after : original;
      const current = now[key] ?? null;
      const want = expected ?? null;
      if (JSON.stringify(current?.map(canon) ?? null) !== JSON.stringify(want?.map(canon) ?? null)) {
        differs.push(`${key}: now ${JSON.stringify(current)}, expected ${JSON.stringify(want)}`);
      }
    }
    expect(differs, 'a dark value changed without an exception').toEqual([]);
  });

  it('adds no colour declaration the original did not have, unless it is listed as an addition', () => {
    const added = Object.keys(now).filter((key) => !(key in fixture.dark));
    expect(added.filter((key) => !fixture.additions?.[key])).toEqual([]);
  });

  it('lists every exception with the value it had in the original tree and the reason it may change', () => {
    for (const [key, exception] of Object.entries(fixture.exceptions)) {
      expect(fixture.dark[key], `${key} has no original value`).toBeDefined();
      expect(exception.reason.length, `${key} needs a reason`).toBeGreaterThan(20);
      expect(exception.before, `${key} before`).toEqual(fixture.dark[key]);
      expect('after' in exception, `${key} after`).toBe(true);
    }
    for (const [key, addition] of Object.entries(fixture.additions ?? {})) {
      expect(addition.reason.length, `${key} needs a reason`).toBeGreaterThan(20);
    }
  });
});
