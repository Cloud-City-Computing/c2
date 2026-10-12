/**
 * Decision 12 (W6-CDX-38): the two hover fills retire. No rule reads --bg-hover or --bg-hover-strong; the
 * deferred editor, comments and GitHub banners bind their hover to --cx-surface-2 (colour only).
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { banners, ROOT } from './buckets.js';

const index = readFileSync(path.join(ROOT, 'src/index.css'), 'utf8');
const lines = index.split('\n');
const marks = banners(index);

// Banners the colour-only pass covers in W6-CDX-43 (editor canvas, comments, GitHub surface).
const DEFERRED = [
  'Comments & Annotations', 'GitHub Integration', 'Editor Log', 'Markdown Editor', 'Version History',
  'Collaborative Editing - Presence UI', 'Remote Cursors - Collaborative Editing',
];

/** Every line that reads one of the retiring names, with the banner it sits in. */
function readers() {
  return lines.map((text, i) => ({ line: i + 1, text, banner: marks.filter((b) => b.line <= i + 1).pop()?.name ?? '(file)' }))
    .filter(({ text }) => /var\(--bg-hover/.test(text));
}

describe('the hover fills retire (Decision 12)', () => {
  it('no rule outside the deferred banners reads --bg-hover or --bg-hover-strong', () => {
    const outside = readers().filter(({ banner }) => !DEFERRED.includes(banner));
    expect(outside.map(({ line, banner, text }) => `${line} [${banner}] ${text.trim()}`)).toEqual([]);
  });

  it('nothing reads them even inside the deferred banners: those bind to --cx-surface-2', () => {
    expect(readers().map(({ line, text }) => `${line} ${text.trim()}`)).toEqual([]);
  });

  it('index.css declares neither name, so the bridge cannot hand one out', () => {
    expect(/--bg-hover(-strong)?\s*:/.test(index)).toBe(false);
  });

  it('a hover on a sunken row or the page binds to the panel surface, not the strong ring', () => {
    // The sidebar link is the sunken-row case: its hover is --cx-surface-2 on --cx-surface-1.
    const rule = /\.sidebar__link:hover\s*\{([^}]*)\}/.exec(index);
    expect(rule?.[1]).toMatch(/background:\s*var\(--cx-surface-2\)/);
  });
});
