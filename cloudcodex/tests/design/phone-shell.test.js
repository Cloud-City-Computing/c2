/**
 * Cloud Codex - the phone shell stacks its rows from the top, with no stretched gap (W6-CDX-42 review, visual)
 *
 * At under 600 px the shell stacks the sidebar strip over the main column. The shell is at least 100vh tall, and
 * with the default `align-content: normal` the two stacked rows stretch to fill it, so the main column started
 * 89 px below a 90 px strip (measured on the Admin and Notification preferences pages at 390 px). The phone rule
 * must start the rows at the top.
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

/** The body of the first `@media (max-width: 599px)` block that stacks the shell. */
function phoneShellRule() {
  const start = css.indexOf('@media (max-width: 599px) {\n  .app-shell,');
  if (start < 0) throw new Error('no phone shell media block');
  const open = css.indexOf('{', start);
  const close = css.indexOf('\n  }\n', open);
  return css.slice(open, close);
}

describe('the phone shell (390 px)', () => {
  it('stacks the rows from the top, not stretched to the viewport height', () => {
    expect(phoneShellRule()).toMatch(/align-content:\s*start/);
  });
});
