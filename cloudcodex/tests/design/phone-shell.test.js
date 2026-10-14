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

/** The body of the phone rule that stacks the shell rows (the `.app-shell.no-sidebar` selector inside the 599 px block). */
function phoneShellRule() {
  const start = css.indexOf('  .app-shell,\n  .app-shell.no-sidebar {');
  if (start < 0) throw new Error('no phone shell rule');
  const open = css.indexOf('{', start);
  return css.slice(open + 1, css.indexOf('}', open));
}

describe('the phone shell (390 px)', () => {
  it('stacks the rows from the top, not stretched to the viewport height', () => {
    expect(phoneShellRule()).toMatch(/align-content:\s*start/);
  });
});

/*
 * The phone strip's navigation spans the first two grid columns ("nav nav foot"), so a negative right margin
 * reaches into the account column and the avatar is drawn over the end of the last item (seen at 390 px).
 */
describe('the phone strip keeps the account column clear', () => {
  it('the navigation strip has no right margin, so its last item is not drawn under the account avatar', () => {
    const start = css.indexOf('  .sidebar__nav {\n    grid-area: nav;');
    expect(start, 'no phone navigation rule').toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf('}', start));
    expect(block).toContain('margin: 0 0 0 -18px;');
    expect(block).not.toMatch(/margin:\s*0\s+-18px/);
  });
});
