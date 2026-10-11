/**
 * The accent picker's hues: the one data file for the eight choices
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

// Eight hues at L 0.78, C 0.12, each at least 15 degrees from the danger (25),
// warning (78), success (150) and violet (300) arcs, so no accent can be read as
// a status. Four keep their names; the four that sat on an arc (rose, amber,
// emerald, violet) moved and were renamed. Nothing is removed, and every old key
// has exactly one successor (LEGACY_ACCENT). The names are placeholders until
// Kyle confirms them: a rename is one line here, one line in the labels in
// src/components/AccountMenu.jsx, and nothing else.
export const ACCENTS = {
  blue: 232, cyan: 200, pink: 325, lime: 131,
  coral: 355, apricot: 50, jade: 175, iris: 275,
};

export const LEGACY_ACCENT = { rose: 'coral', amber: 'apricot', emerald: 'jade', violet: 'iris' };

// invariant-exempt: the accent ramp is token data, measured pair by pair in tests/design/accents.test.js
export const accentValue = (hue) => `oklch(0.78 0.12 ${hue})`;
// invariant-exempt: the hover step, lighter than the text step (the package's accent-200 shape)
export const accentHover = (hue) => `oklch(0.88 0.06 ${hue})`;
// invariant-exempt: the fill step, a background only (the package's accent-400 shape)
export const accentFill = (hue) => `oklch(0.68 0.13 ${hue})`;
// invariant-exempt: the dark step, behind a white avatar label (white on it measures >= 4.5:1, tests/design/painted.test.js)
export const accentDark = (hue) => `oklch(0.45 0.13 ${hue})`;

// Keys are looked up as OWN properties only: a name such as "constructor" or
// "__proto__" is a property of every object, and must never read as a hue.
export const isAccent = (key) => Object.hasOwn(ACCENTS, key);
export const successorOf = (key) => (Object.hasOwn(LEGACY_ACCENT, key) ? LEGACY_ACCENT[key] : key);
