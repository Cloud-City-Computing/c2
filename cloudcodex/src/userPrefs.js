/**
 * Cloud Codex - User Preferences
 *
 * Manages user UI preferences (accent color, font size, density,
 * sidebar default, editor mode) in localStorage and applies
 * them as CSS custom properties on the document root.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

const PREFS_KEY = 'c2-user-prefs';

/** Load user preferences from localStorage. Returns an empty object if none are stored. */
export function loadUserPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}

/** Persist user preferences to localStorage. */
export function saveUserPrefs(prefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

// --- Preference option constants (single source of truth) ---

export const ACCENT_COLORS = {
  blue:    { value: '#2ca7db', light: '#5ac0e8', dark: '#1e7a9c', hover: '#21779c' },
  violet:  { value: '#8b5cf6', light: '#a78bfa', dark: '#6d3ad4', hover: '#7c3aed' },
  emerald: { value: '#10b981', light: '#34d399', dark: '#059669', hover: '#047857' },
  rose:    { value: '#f43f5e', light: '#fb7185', dark: '#e11d48', hover: '#be123c' },
  amber:   { value: '#f59e0b', light: '#fbbf24', dark: '#d97706', hover: '#b45309' },
  cyan:    { value: '#06b6d4', light: '#22d3ee', dark: '#0891b2', hover: '#0e7490' },
  pink:    { value: '#d946ef', light: '#e879f9', dark: '#c026d3', hover: '#a21caf' },
  lime:    { value: '#84cc16', light: '#a3e635', dark: '#65a30d', hover: '#4d7c0f' },
};

export const FONT_SIZES = {
  sm: '13px',
  md: '15px',
  lg: '17px',
};

export const DENSITIES = {
  compact: 0.7,
  comfortable: 1.0,
  spacious: 1.3,
};

/**
 * Apply user preferences to the DOM by setting CSS custom properties
 * (accent color, font size, density) and data attributes (sidebar default).
 * @param {Object} prefs
 */
export function applyPrefsToDOM(prefs) {
  const root = document.documentElement;

  const color = ACCENT_COLORS[prefs.accentColor];
  if (color) {
    root.style.setProperty('--brand-blue', color.value);
    root.style.setProperty('--brand-blue-light', color.light);
    root.style.setProperty('--brand-blue-dark', color.dark);
    root.style.setProperty('--brand-blue-hover', color.hover);
  } else {
    root.style.removeProperty('--brand-blue');
    root.style.removeProperty('--brand-blue-light');
    root.style.removeProperty('--brand-blue-dark');
    root.style.removeProperty('--brand-blue-hover');
  }

  const fontSize = FONT_SIZES[prefs.fontSize];
  if (fontSize) {
    root.style.setProperty('--editor-font-size', fontSize);
  } else {
    root.style.removeProperty('--editor-font-size');
  }

  const density = DENSITIES[prefs.density];
  if (density) {
    root.style.setProperty('--density-scale', String(density));
  } else {
    root.style.removeProperty('--density-scale');
  }

  if (prefs.sidebarDefault === 'collapsed') {
    document.body.setAttribute('data-sidebar-default', 'collapsed');
  } else {
    document.body.removeAttribute('data-sidebar-default');
  }
}

/** Return the user's preferred editor mode ('markdown' or 'richtext'). Defaults to 'richtext'. */
export function getPreferredEditorMode() {
  return loadUserPrefs().preferredEditor === 'markdown' ? 'markdown' : 'richtext';
}