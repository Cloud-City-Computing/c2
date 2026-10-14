/**
 * Cloud Codex - the Appearance choices, shared by the header popover and the Account page (W6-CDX-44)
 *
 * The Theme options (System, Light, Dark) and the eight accent swatches with Default. Each group reads and
 * writes the suite preference contract (src/lib/suite-prefs.js) and keeps itself in step with other tabs,
 * so the popover and the Account page can never disagree. Match system is named that for assistive tech and
 * shown as "System" so the word never wraps.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useEffect, useState } from 'react';
import {
  clearAccent, clearTheme, resolveAccent, setAccent, setTheme, storedThemeChoice, subscribe,
} from '../lib/suite-prefs.js';
import { ACCENT_COLORS } from '../userPrefs.js';

const THEME_OPTIONS = [
  { id: 'system', label: 'System', name: 'Match system' },
  { id: 'light', label: 'Light', name: 'Light' },
  { id: 'dark', label: 'Dark', name: 'Dark' },
];

// Codex's own names for the eight hues. Only the hue value crosses the boundary to the accent contract.
const ACCENT_LABELS = {
  blue: 'Ocean Blue', cyan: 'Cyan', pink: 'Fuchsia', lime: 'Lime',
  nova: 'Nova', solar: 'Solar', aurora: 'Aurora', nebula: 'Nebula',
};
const ACCENT_LIST = Object.entries(ACCENT_COLORS).map(([id, c]) => ({
  id, label: ACCENT_LABELS[id], hue: c.hue, swatch: c.swatch,
}));

/** The Theme choice group: the stored choice pressed, or System when nothing is stored. */
export function ThemeOptions() {
  const [choice, setChoice] = useState(() => storedThemeChoice() ?? 'system');
  useEffect(() => subscribe(() => setChoice(storedThemeChoice() ?? 'system')), []);

  const choose = (id) => {
    setChoice(id);
    void (id === 'system' ? clearTheme() : setTheme(id));
  };

  return (
    <div className="pref-toggle-group">
      {THEME_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          className={`pref-toggle-btn${choice === option.id ? ' active' : ''}`}
          aria-label={option.name}
          title={option.name}
          aria-pressed={choice === option.id}
          onClick={() => choose(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** The accent group: the eight swatches, and Default (the package's own ramp). */
export function AccentOptions() {
  const [hue, setHue] = useState(() => resolveAccent());
  useEffect(() => subscribe(() => setHue(resolveAccent())), []);

  const choose = (accentHue) => {
    setHue(accentHue);
    void (accentHue === null ? clearAccent() : setAccent(accentHue));
  };

  return (
    <>
      <div className="color-swatch-row">
        {ACCENT_LIST.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`color-swatch${hue === c.hue ? ' active' : ''}`}
            style={{ '--swatch-color': c.swatch }}
            onClick={() => choose(c.hue)}
            title={c.label}
            aria-label={c.label}
            aria-pressed={hue === c.hue}
          >
            {hue === c.hue && (
              <svg viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--cx-white)' }} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            )}
          </button>
        ))}
      </div>
      <div className="appearance-default-row">
        <button
          type="button"
          className="appearance-default"
          aria-pressed={hue === null}
          onClick={() => choose(null)}
        >
          Default
        </button>
      </div>
    </>
  );
}
