/**
 * Cloud Codex - the Appearance control matches the document header's other icon buttons (W6-CDX-44)
 *
 * In the document header the star and the bell are 30 px borderless icon buttons. The Appearance toggle
 * sits beside them, so it takes the same square, the same padding and no border there.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const css = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/index.css'), 'utf8');

function declarationsOf(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)[ \\t]*${escaped}\\s*\\{([^}]*)\\}`, 'g');
  return [...css.matchAll(match)].map((m) => m[1]).join('\n');
}

describe('the document header keeps the Appearance toggle the size of its icon buttons', () => {
  it('gives .document-header .appearance-toggle a 30 px square, no padding and no border', () => {
    const body = declarationsOf('.document-header .appearance-toggle');
    expect(body, 'add the rule beside .document-header .btn-favorite in src/index.css').not.toBe('');
    expect(body).toMatch(/width:\s*30px/);
    expect(body).toMatch(/height:\s*30px/);
    expect(body).toMatch(/padding:\s*0/);
    expect(body).toMatch(/border-color:\s*transparent/);
  });
});

// The Default accent is a compact outlined pill, and its selected state is a ring, as the swatches' is (W6-CDX-44).
describe('the Default accent is a compact pill whose selected state is a ring', () => {
  it('sizes to its label, with a pill radius and an outline, not a full-width fill', () => {
    const body = declarationsOf('.appearance-default');
    expect(body).toMatch(/border-radius:\s*999px/);
    expect(body).toMatch(/border:\s*1px solid/);
    expect(body).toMatch(/width:\s*auto|justify-self:\s*start|align-self:\s*start/);
    expect(body).not.toMatch(/width:\s*100%/);
  });

  it('shows the selected state as a ring, not a fill', () => {
    const body = declarationsOf(".appearance-default[aria-pressed='true']");
    expect(body, 'selected Default needs a ring rule').not.toBe('');
    expect(body).toMatch(/box-shadow:\s*0 0 0 3px/);
    expect(body).not.toMatch(/background(-color)?:\s*var\(--(cx-accent|brand)/);
  });
});

// A segment's focus ring sits inside the segment, above its neighbour's border, so it is whole on every segment.
describe('the segmented focus ring is whole on every segment, in both themes', () => {
  it('draws the focus ring inside the segment and lifts it above the adjacent segment', () => {
    const body = declarationsOf('.pref-toggle-btn:focus-visible');
    expect(body, 'add the focus rule beside .pref-toggle-btn in src/index.css').not.toBe('');
    expect(body).toMatch(/outline-offset:\s*-\d+px/);
    expect(body).toMatch(/position:\s*relative/);
    expect(body).toMatch(/z-index:\s*var\(--z-[a-z]+\)/);
  });
});

// The phone strip: a focused item's ring must sit inside the strip's visible area (W6-CDX-44 review).
describe('the phone strip leaves room for a focused item ring', () => {
  it('gives the strip inline and block padding at least as large as the ring, and a scroll padding to match', () => {
    const body = declarationsOf('.sidebar__nav');
    expect(body).toMatch(/scroll-padding-inline:\s*\d+px/);
    const pad = /padding:\s*(\d+)px\s+(\d+)px/.exec(body);
    expect(pad, 'the strip needs an explicit padding shorthand').not.toBeNull();
    expect(Number(pad[1])).toBeGreaterThanOrEqual(4);
    expect(Number(pad[2])).toBeGreaterThanOrEqual(4);
  });
});

// The strip's row is as wide as its items and ends with room for a ring, so the last item can be scrolled clear.
describe('the phone strip has room after its last item', () => {
  it('makes the scrolling row max-content wide, with trailing padding of at least the ring room', () => {
    const body = declarationsOf('.sidebar__scroll');
    expect(body).toMatch(/width:\s*max-content/);
    const pad = /padding-right:\s*(\d+)px/.exec(body);
    expect(pad, 'the row needs trailing padding').not.toBeNull();
    expect(Number(pad[1])).toBeGreaterThanOrEqual(4);
  });
});

// A pressed segment is filled with the accent, so its focus ring takes the on-accent ink to stay visible on it.
describe('the focus ring on a pressed segment contrasts with its accent fill', () => {
  it('draws a pressed segment ring in the on-accent ink', () => {
    const body = declarationsOf('.pref-toggle-btn.active:focus-visible');
    expect(body, 'add the pressed-segment ring beside .pref-toggle-btn:focus-visible in src/index.css').not.toBe('');
    expect(body).toMatch(/outline-color:\s*var\(--cx-on-accent\)/);
  });
});
