/**
 * The label on a presence avatar: the first of white, the dark ink or black that clears 4.5:1 on the cursor colour
 *
 * A presence avatar is painted in its owner's cursor colour (services/cursor-colors.js), and the initial on
 * it is a label. The palette is light enough that white reads poorly on most of it (the orange measures
 * about 2:1), so the label is chosen per colour. The candidates are CSS variables, so the paint follows the
 * tokens. Each candidate is held as its WCAG relative luminance, and tests/design/presence-palette.test.js
 * pins the ink's value to --cx-on-accent and measures every palette colour through the real tokens.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

// The WCAG relative luminance of --cx-on-accent (oklch(0.16 0.03 240)), as the vendored gate measures it.
export const INK_LUMINANCE = 0.004175134234249585;

const CANDIDATES = [
  { color: 'var(--cx-white)', luminance: 1 },
  { color: 'var(--cx-on-accent)', luminance: INK_LUMINANCE },
  { color: 'var(--cx-ink-deep)', luminance: 0 },
];

function channel(v) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a six-digit hex colour. */
export function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG contrast ratio of two relative luminances. */
export function contrastOf(a, b) {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The label for an avatar painted `bg`, as `{ color, ratio }`: the first candidate at 4.5:1 or more, in the
 * order white, ink, black. If none clears (no palette colour does), the best of the three is returned.
 * A value that is not a six-digit hex gets white, with no ratio.
 */
export function avatarLabel(bg) {
  if (!/^#[0-9a-f]{6}$/i.test(bg ?? '')) return { color: 'var(--cx-white)', ratio: null };
  const bgLum = luminance(bg);
  const measured = CANDIDATES.map((c) => ({ color: c.color, ratio: contrastOf(c.luminance, bgLum) }));
  return measured.find((m) => m.ratio >= 4.5) ?? [...measured].sort((x, y) => y.ratio - x.ratio)[0];
}
