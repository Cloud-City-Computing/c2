/**
 * The accent picker's hues: the one data file for the eight choices
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

// Eight hues at L 0.78, C 0.12, each at least 15 degrees from the danger (25),
// warning (78), success (150) and violet (300) arcs, so no accent can be read as
// a status. Four keep their names; the four that sat on an arc (rose, amber,
// emerald, violet) moved and were renamed to Nova, Solar, Aurora and Nebula
// (Kyle, 2026-10-11). Nothing is removed. A saved key from before a rename maps
// to its successor (LEGACY_ACCENT): the shipped rose, amber, emerald and violet,
// and the placeholder coral, apricot, jade and iris that a build of this stack
// could have saved in a browser before the names were confirmed.
export const ACCENTS = {
  blue: 232, cyan: 200, pink: 325, lime: 131,
  nova: 355, solar: 50, aurora: 175, nebula: 275,
};

export const LEGACY_ACCENT = {
  rose: 'nova', amber: 'solar', emerald: 'aurora', violet: 'nebula',
  coral: 'nova', apricot: 'solar', jade: 'aurora', iris: 'nebula',
};

// The picker stores a hue (K7, W6-CDX-43). codex.css derives each theme's steps from --cx-accent-h, so the steps
// live in CSS, and this table is the one copy of them that tests read (tests/design/accents.test.js and the
// gates that measure a picked accent). H is the hue. Each theme's text step, hover and selection wash are the
// contract's values (tests/design/suite-theme.json, the table the colour gates read). `fillHover` is the primary
// button's hover on a filled accent: the light theme's hover step is the deep text step, which cannot be a fill
// under the dark ink, so the fill's hover is a lighter step in both themes (contract v2, 2026-10-12).
// `dark` is the step behind a white avatar label, which tests/design/painted.test.js measures.
export const STEP_HUE_PLACEHOLDER = 'H';
export const STEPS = Object.freeze({
  dark: Object.freeze({
    // invariant-exempt: a contract step, measured in tests/design/accents.test.js
    text: 'oklch(0.68 0.13 H)',
    // invariant-exempt: a contract step, measured in tests/design/accents.test.js
    hover: 'oklch(0.78 0.1 H)',
    // invariant-exempt: a contract step, measured in tests/design/accents.test.js
    fill: 'oklch(0.68 0.13 H)',
    // invariant-exempt: a contract step, measured in tests/design/accents.test.js
    fillHover: 'oklch(0.78 0.1 H)',
    // invariant-exempt: a contract step, measured in tests/design/accents.test.js
    wash: 'oklch(0.21 0.055 H)',
    // invariant-exempt: a contract step, measured in tests/design/accents.test.js
    dark: 'oklch(0.45 0.13 H)',
  }),
  daylight: Object.freeze({
    // invariant-exempt: a contract step, measured in tests/design/accents.test.js
    text: 'oklch(0.47 0.12 H)',
    // invariant-exempt: a contract step, measured in tests/design/accents.test.js
    hover: 'oklch(0.41 0.1 H)',
    // invariant-exempt: a contract step, measured in tests/design/accents.test.js
    fill: 'oklch(0.68 0.13 H)',
    // invariant-exempt: a contract step, measured in tests/design/accents.test.js
    fillHover: 'oklch(0.78 0.1 H)',
    // invariant-exempt: a contract step, measured in tests/design/accents.test.js
    wash: 'oklch(0.97 0.025 H)',
    // invariant-exempt: a contract step, measured in tests/design/accents.test.js
    dark: 'oklch(0.45 0.13 H)',
  }),
});

/** One theme's steps for a hue, as the CSS strings codex.css derives. */
export const stepsFor = (theme, hue) => Object.fromEntries(
  Object.entries(STEPS[theme]).map(([step, value]) => [step, value.replaceAll(STEP_HUE_PLACEHOLDER, String(hue))]),
);

// The fill swatch of a hue in the picker: the fill step, the same in both themes.
// invariant-exempt: a swatch is the picker's preview of the fill step, not a token
// invariant-exempt: a picker swatch preview, not a token
export const swatchValue = (hue) => `oklch(0.68 0.13 ${hue})`;

// Keys are looked up as OWN properties only: a name such as "constructor" or
// "__proto__" is a property of every object, and must never read as a hue.
export const isAccent = (key) => Object.hasOwn(ACCENTS, key);
export const successorOf = (key) => (Object.hasOwn(LEGACY_ACCENT, key) ? LEGACY_ACCENT[key] : key);
