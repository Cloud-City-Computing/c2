/**
 * Cloud Codex - the phone strip keeps a focused item's ring inside its visible area (W6-CDX-44 review)
 *
 * Chrome scrolls a keyboard-focused item into view only when it is wholly outside the scroller, so an item
 * half under the strip's right edge stays half hidden. revealInStrip scrolls just enough that the item's
 * outline box (the item grown by the 2 px ring and its 2 px offset) sits inside the strip, less a room margin.
 * jsdom has no layout, so the rectangles are stubbed; the browser check is docs/research/.../strip-focus-check.mjs.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { revealInStrip } from '../../../src/lib/strip-focus.js';

function strip({ left = 0, right = 300, scrollWidth = 600, clientWidth = 300, scrollLeft = 0 } = {}) {
  const el = {
    scrollLeft,
    scrollWidth,
    clientWidth,
    getBoundingClientRect: () => ({ left, right, top: 0, bottom: 40, width: right - left, height: 40 }),
  };
  return el;
}

function item(left, right) {
  return { getBoundingClientRect: () => ({ left, right, top: 0, bottom: 30, width: right - left, height: 30 }) };
}

describe('revealInStrip', () => {
  it('scrolls an item that is half under the right edge until its ring clears the room margin', () => {
    const s = strip();
    const delta = revealInStrip(s, item(250, 380), 18, 4);
    // outline right = 384; the visible right less the room = 282; so scroll by 102.
    expect(delta).toBe(102);
    expect(s.scrollLeft).toBe(102);
  });

  it('scrolls an item that is half under the left edge back until its ring clears the room margin', () => {
    const s = strip({ scrollLeft: 200 });
    const delta = revealInStrip(s, item(-10, 60), 18, 4);
    // outline left = -14; the visible left plus the room = 18; so the scroll moves by -32.
    expect(delta).toBe(-32);
    expect(s.scrollLeft).toBe(168);
  });

  it('leaves an item that is already clear of both edges alone', () => {
    const s = strip();
    expect(revealInStrip(s, item(60, 180), 18, 4)).toBe(0);
    expect(s.scrollLeft).toBe(0);
  });

  it('does nothing when the strip does not scroll (the desktop sidebar)', () => {
    const s = strip({ scrollWidth: 300, clientWidth: 300 });
    expect(revealInStrip(s, item(250, 380), 18, 4)).toBe(0);
    expect(s.scrollLeft).toBe(0);
  });
});
