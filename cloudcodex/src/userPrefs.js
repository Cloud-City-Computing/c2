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
  ACCENTS, accentValue, accentHover, accentFill, accentDark, isAccent, successorOf,
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

// A view over ACCENTS (src/tokens/accents.js): the three steps Codex's picker writes.
export const ACCENT_COLORS = Object.fromEntries(Object.entries(ACCENTS).map(([id, hue]) => [id, {
  value: accentValue(hue), hover: accentHover(hue), fill: accentFill(hue), dark: accentDark(hue),
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

  // Codex's own alias tokens, never a shared primitive: the bridge in index.css
  // points --brand-blue* at these, so the focus ring follows the picked accent.
  const color = isAccent(prefs.accentColor) ? ACCENT_COLORS[prefs.accentColor] : undefined;
  if (color) {
    root.style.setProperty('--cx-accent', color.value);
    root.style.setProperty('--cx-accent-hover', color.hover);
    root.style.setProperty('--cx-accent-fill', color.fill);
    root.style.setProperty('--cx-accent-dark', color.dark);
  } else {
    root.style.removeProperty('--cx-accent');
    root.style.removeProperty('--cx-accent-hover');
    root.style.removeProperty('--cx-accent-fill');
    root.style.removeProperty('--cx-accent-dark');
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