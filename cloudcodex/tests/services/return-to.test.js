/**
 * Tests for services/return-to.js, the one validator for where a sign-in returns to
 *
 * tests/fixtures/return-to-corpus.json is this repository's own hostile-input set for the validator,
 * first imported 2026-10-11. Every case in it is the contract: the validator must answer each `expected`
 * value exactly. A change to an answer is a behaviour change, and the corpus changes in the same PR.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { safeReturnTo, RETURN_TO_MAX_LENGTH } from '../../services/return-to.js';

const CORPUS_PATH = fileURLToPath(new URL('../fixtures/return-to-corpus.json', import.meta.url));
const RAW_CORPUS = readFileSync(CORPUS_PATH, 'utf8');
const corpus = JSON.parse(RAW_CORPUS);

describe('return-to corpus file (the copy-paste contract)', () => {
  it('has exactly _source and cases, in UTF-8 with LF and no BOM', () => {
    expect(Object.keys(corpus).sort()).toEqual(['_source', 'cases']);
    expect(typeof corpus._source).toBe('string');
    expect(RAW_CORPUS.startsWith('﻿')).toBe(false);
    expect(RAW_CORPUS.includes('\r')).toBe(false);
    expect(RAW_CORPUS.endsWith('\n')).toBe(true);
  });

  it('has 127 cases, each exactly {input, expected}, with expected the input or "/"', () => {
    expect(corpus.cases).toHaveLength(127);
    for (const entry of corpus.cases) {
      expect(Object.keys(entry).sort()).toEqual(['expected', 'input']);
      expect([entry.input, '/']).toContain(entry.expected);
    }
  });
});

describe('safeReturnTo against every corpus case', () => {
  it.each(corpus.cases.map((entry, index) => [index, entry.input, entry.expected]))(
    'case %i yields the corpus answer',
    (index, input, expected) => {
      expect(safeReturnTo(input), `case ${index}: ${JSON.stringify(input).slice(0, 160)}`).toBe(expected);
    }
  );
});

describe('safeReturnTo, beyond the corpus', () => {
  it('refuses non-string values (absent, null, numbers, repeated keys, objects)', () => {
    for (const value of [undefined, null, 123, ['/a', '/b'], {}, true]) {
      expect(safeReturnTo(value)).toBe('/');
    }
  });

  it('refuses the empty string', () => {
    expect(safeReturnTo('')).toBe('/');
  });

  it('bounds the raw length at 2048 characters', () => {
    expect(RETURN_TO_MAX_LENGTH).toBe(2048);
    expect(safeReturnTo(`/${'a'.repeat(2047)}`)).toBe(`/${'a'.repeat(2047)}`);
    expect(safeReturnTo(`/${'a'.repeat(2048)}`)).toBe('/');
  });

  it('refuses a value that needs more decode layers than the bound', () => {
    const encodeTimes = (text, k) => {
      let out = text;
      for (let i = 0; i < k; i += 1) out = encodeURIComponent(out);
      return out;
    };
    const deep = `/w/ws1/board?q=${encodeTimes(' ', 9)}`;
    const shallow = `/w/ws1/board?q=${encodeTimes(' ', 2)}`;
    expect(safeReturnTo(deep)).toBe('/');
    expect(safeReturnTo(shallow)).toBe(shallow);
  });

  it('refuses the raw browser-encoded characters in the path, query and fragment', () => {
    for (const ch of ['"', '<', '>', '`', '{', '}', '|', '^']) {
      expect(safeReturnTo(`/w/ws1${ch}`), ch).toBe('/');
      expect(safeReturnTo(`/w/ws1?q=${ch}`), ch).toBe('/');
      expect(safeReturnTo(`/w/ws1#${ch}`), ch).toBe('/');
    }
  });

  it('refuses a control character, even one written as a decoded escape', () => {
    expect(safeReturnTo('/a\u0007b')).toBe('/');
    expect(safeReturnTo('/a?q=%0Ab')).toBe('/');
  });

  it('refuses a path that is not a same-origin path, whatever its encoding', () => {
    for (const hostile of [
      '//evil.example',
      '/\\evil.example',
      'https://evil.example',
      '/%2F%2Fevil.example',
      '/%5Cevil.example',
      'javascript:alert(1)',
      '/\u0000x',
      'evil',
    ]) {
      expect(safeReturnTo(hostile), hostile).toBe('/');
    }
  });

  it('never rewrites an accepted value', () => {
    expect(safeReturnTo('/w/ws1/board?q=a%20b#top')).toBe('/w/ws1/board?q=a%20b#top');
  });
});
