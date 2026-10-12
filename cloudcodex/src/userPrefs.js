/**
 * Cloud Codex - User Preferences
 *
 * Manages user UI preferences (accent color, editor font size, preferred
 * editor) in localStorage and applies them as CSS custom properties on the
 * document root. Density and the sidebar default are gone (W6-CDX-42, K8).
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import {
  ACCENTS, isAccent, successorOf, swatchValue,
} from './tokens/accents.js';

const PREFS_KEY = 'c2-user-prefs';

/**
 * Load user preferences from localStorage. Returns an empty object if none are stored.
 * A renamed accent key maps to its one successor; an accent key this build does not
 * offer is dropped, so the default palette applies.
 */
export function loadUserPrefs() {
  let prefs;
  try {
    prefs = JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
  if (prefs.accentColor !== undefined) {
    const accent = successorOf(prefs.accentColor);
    if (isAccent(accent)) prefs.accentColor = accent;
    else delete prefs.accentColor;
  }
  // Retired preferences (W6-CDX-42, K8): a value an earlier build stored is dropped, never applied.
  delete prefs.density;
  delete prefs.sidebarDefault;
  return prefs;
}

/** Persist user preferences to localStorage. */
export function saveUserPrefs(prefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

// --- Preference option constants (single source of truth) ---

// A view over ACCENTS (src/tokens/accents.js): the hue each choice stores, and the fill swatch the picker paints.
// The steps for a theme are derived in CSS from the hue (K7), so no finished colour is stored or written here.
export const ACCENT_COLORS = Object.fromEntries(Object.entries(ACCENTS).map(([id, hue]) => [id, {
  hue, swatch: swatchValue(hue),
}]));

export const FONT_SIZES = {
  sm: '13px',
  md: '15px',
  lg: '17px',
};

/**
 * Apply user preferences to the DOM by setting CSS custom properties
 * (accent color, editor font size). There is no density scale and no sidebar attribute.
 * @param {Object} prefs
 */
export function applyPrefsToDOM(prefs) {
  const root = document.documentElement;

  // The picked accent is a hue (K7). codex.css derives each theme's steps from --cx-accent-h under
  // [data-accent], so the page follows the theme and never a finished colour written here.
  if (isAccent(prefs.accentColor)) {
    root.style.setProperty('--cx-accent-h', String(ACCENTS[prefs.accentColor]));
    root.dataset.accent = prefs.accentColor;
  } else {
    root.style.removeProperty('--cx-accent-h');
    delete root.dataset.accent;
  }

  const fontSize = FONT_SIZES[prefs.fontSize];
  if (fontSize) {
    root.style.setProperty('--editor-font-size', fontSize);
  } else {
    root.style.removeProperty('--editor-font-size');
  }
}

/** Return the user's preferred editor mode ('markdown' or 'richtext'). Defaults to 'richtext'. */
export function getPreferredEditorMode() {
  return loadUserPrefs().preferredEditor === 'markdown' ? 'markdown' : 'richtext';
}