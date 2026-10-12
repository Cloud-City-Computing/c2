/**
 * A ghost button's hover must differ from the surface it sits on, both on the page and inside a dialog
 * (review finding: inside .modal-content the hover was the same panel colour, so it vanished).
 *
 * Declaration-level: each colour is resolved through the dark theme's tokens, because jsdom does not
 * apply :hover. The live hover is checked in a browser during the W6-CDX-38 captures.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseThemeTokens, resolveTokenValue } from '../../vendor/cloud-city-design/gates/contrast.mjs';
import { ROOT, THEME_OPTIONS } from './buckets.js';

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const core = read('vendor/cloud-city-design/core.css');
const codex = read('src/codex.css');
const index = read('src/index.css').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
const dark = parseThemeTokens(`${core}\n${codex}`, THEME_OPTIONS).dark;

/** The last value a rule declares for one property, as written. */
function declared(selector, prop) {
  let value;
  for (const m of index.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    // A rule may share its block with others (.dropdown-menu, .modal-content), so match each selector in the list.
    if (!m[1].split(',').map((x) => x.replace(/\s+/g, ' ').trim()).includes(selector)) continue;
    for (const d of m[2].matchAll(/(?:^|;|\s)([a-z-]+)\s*:\s*([^;]+);/g)) if (d[1] === prop) value = d[2].trim();
  }
  if (value === undefined) throw new Error(`${selector} declares no ${prop}`);
  return value;
}

/** A declared colour, followed to its literal through the dark theme. */
function paint(value) {
  const m = /^var\((--[\w-]+)\)$/.exec(value);
  return m ? resolveTokenValue(dark, m[1]) : value;
}

describe('a ghost button hovers in a colour its container does not paint', () => {
  const hover = paint(declared('.btn-ghost:hover:not(:disabled)', 'background'));

  it('reads the hover from the real declaration, and it resolves', () => {
    expect(hover).toBeDefined();
  });

  it('differs from the page background', () => {
    expect(hover).not.toBe(paint(declared(':root', 'background-color')));
  });

  it('differs from a dialog panel (.modal-content), where the hover used to vanish', () => {
    expect(hover).not.toBe(paint(declared('.modal-content', 'background')));
  });
});
