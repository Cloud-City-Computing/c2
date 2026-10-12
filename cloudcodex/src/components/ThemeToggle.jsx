/**
 * Cloud Codex - the header's theme toggle (W6-CDX-44)
 *
 * A native button in every page header that switches the page between light and dark. Its name says
 * the theme it switches to. The choice goes through the suite preference contract (suite-prefs.js), so
 * it follows the person to the sibling products. Match system lives in Appearance, not here.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useEffect, useState } from 'react';
import { setTheme, subscribe } from '../lib/suite-prefs.js';

// The theme in effect, read from the page: the attribute is what the pre-paint script and the module set.
const pageTheme = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

export default function ThemeToggle() {
  const [theme, setCurrent] = useState(pageTheme);

  useEffect(() => subscribe(() => setCurrent(pageTheme())), []);

  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className="btn btn-ghost btn-icon theme-toggle"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={() => { void setTheme(next); }}
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
