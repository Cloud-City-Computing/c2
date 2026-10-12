/**
 * src/codex.css must equal the suite pattern's theme table (tests/design/suite-theme.json)
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { maskComments } from '../../vendor/cloud-city-design/gates/token-discipline.mjs';
import { ROOT } from './buckets.js';

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const fixture = JSON.parse(read('tests/design/suite-theme.json'));

/** The declarations of one selector's block, as a name-to-value map, comments masked. */
function declarationsOf(css, selector) {
  const masked = maskComments(css);
  const re = new RegExp(`${selector.replace(/[[\]'()]/g, '\\$&')}\\s*\\{([^{}]*)\\}`);
  const block = re.exec(masked);
  if (!block) return new Map();
  return new Map(block[1].split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const i = d.indexOf(':');
    return [d.slice(0, i).trim(), d.slice(i + 1).trim().replace(/\s+/g, ' ')];
  }));
}

describe.each([
  ['dark', "[data-theme='dark']"],
  ['light', "[data-theme='light']"],
])('the suite theme table, %s column', (column, selector) => {
  const css = read('src/codex.css');
  const block = declarationsOf(css, selector);

  it.each(Object.entries(fixture[column]))('%s equals the fixture', (name, value) => {
    expect(block.get(name), `${name} in codex.css`).toBe(value);
  });

  it('is not a stale copy: the fixture names no retired token', () => {
    expect(Object.keys(fixture[column]).filter((name) => /surface-[34]$/.test(name))).toEqual([]);
  });
});
