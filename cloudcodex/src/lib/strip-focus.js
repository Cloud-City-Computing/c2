/**
 * Cloud Codex - keeps a focused item of the phone strip wholly visible, with its focus ring (W6-CDX-44 review)
 *
 * The strip (the sidebar's nav on a phone) is a horizontal scroller. Keyboard focus scrolls an item into view only
 * when it is wholly outside, so an item half under the strip's edge stays half hidden. This scrolls the strip just
 * enough that the item's outline box (the item grown by the ring: 2 px wide, 2 px out) sits inside the strip, less
 * `room` at each end. On a strip that does not scroll (the desktop sidebar) it does nothing.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

/**
 * @param {HTMLElement} strip the scrolling element
 * @param {HTMLElement} item the focused item inside it
 * @param {number} [room=18] the margin kept clear at each end (the strip's inline padding)
 * @param {number} [ring=4] the ring's total outward reach (2 px wide plus 2 px offset)
 * @returns {number} the change made to scrollLeft
 */
export function revealInStrip(strip, item, room = 18, ring = 4) {
  if (!strip || !item || strip.scrollWidth <= strip.clientWidth) return 0;
  const visible = strip.getBoundingClientRect();
  const target = item.getBoundingClientRect();
  const left = visible.left + room;
  const right = visible.right - room;
  const outLeft = target.left - ring;
  const outRight = target.right + ring;
  let delta = 0;
  if (outLeft < left) delta = outLeft - left;
  else if (outRight > right) delta = outRight - right;
  strip.scrollLeft += delta;
  return delta;
}
