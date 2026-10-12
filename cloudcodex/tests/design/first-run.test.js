/**
 * Cloud Codex - the first-run dialog is left aligned, with its links in the accent (W6-CDX-42, X5)
 *
 * The welcome dialog centred its list and painted its links in the user agent's default link colour. The rules
 * here pin the fix in the stylesheet: text is left aligned, the hierarchy list is a left-aligned list, and the
 * links in the copy take --cx-accent. The primary action's own colour is left to the button.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const css = readFileSync(path.join(ROOT, 'src/index.css'), 'utf8');

/** The declarations of the first rule whose selector list is exactly `selector`. */
function declarations(selector) {
  const start = css.indexOf(`\n${selector} {`);
  if (start < 0) throw new Error(`no rule for ${selector}`);
  const open = css.indexOf('{', start);
  return css.slice(open + 1, css.indexOf('}', open)).trim();
}

describe('the first-run dialog (X5)', () => {
  it('is left aligned, not centred', () => {
    expect(declarations('.welcome-setup')).toMatch(/text-align:\s*left/);
    expect(declarations('.welcome-setup')).not.toMatch(/text-align:\s*center/);
  });

  it('lays its hierarchy list out from the left edge', () => {
    expect(declarations('.welcome-hierarchy')).toMatch(/padding-left:\s*\d+px/);
    expect(declarations('.welcome-hierarchy')).not.toMatch(/text-align:\s*center/);
  });

  it('paints the links in the copy with the accent, not the user agent default', () => {
    expect(declarations('.welcome-hierarchy a')).toMatch(/color:\s*var\(--cx-accent\)/);
    expect(declarations('.welcome-subtitle a')).toMatch(/color:\s*var\(--cx-accent\)/);
  });
});
