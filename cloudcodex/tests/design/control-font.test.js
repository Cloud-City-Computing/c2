/**
 * X4 (W6-CDX-38): buttons and native fields inherit the page's typeface, not the browser's default.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './buckets.js';

const css = readFileSync(path.join(ROOT, 'src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
// Declaration-level, because jsdom does not substitute var(): each rule that names a control and sets font-family: inherit.
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selectors: m[1].split(',').map((s) => s.trim()),
  body: m[2],
}));

describe('controls inherit the typeface (X4)', () => {
  it.each(['.btn', 'button', 'input', 'select', 'textarea'])('%s declares font-family: inherit', (selector) => {
    const hit = rules.some((r) => r.selectors.includes(selector) && /font-family:\s*inherit\s*;/.test(r.body));
    expect(hit, `${selector} has no rule with font-family: inherit`).toBe(true);
  });
});
