/**
 * The four leftover banners W6-CDX-29 burns: each declaration is pinned to the token that replaces its literal
 *
 * The modal and login-tab rules, the signup validation hints, and the presence avatars and tooltip
 * (the Welcome block and the presence block share the "Toast Notifications" banner). Each site is
 * read from the real declarations of src/index.css, so a revert to a literal or a fallback turns the
 * named test red. The presence avatars render on the archive and explore pages, not in the editor
 * canvas, which is why they are burned here and not deferred.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './buckets.js';

const index = readFileSync(path.join(ROOT, 'src/index.css'), 'utf8');

/** The last value of one property in the last rule whose selector is exactly `selector`. */
function declared(selector, prop) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let value;
  for (const m of index.matchAll(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`, 'g'))) {
    for (const d of m[1].matchAll(/(?:^|;|\s)([a-z-]+)\s*:\s*([^;]+);/g)) {
      if (d[1] === prop) value = d[2].trim();
    }
  }
  if (value === undefined) throw new Error(`${selector} declares no ${prop} in src/index.css`);
  return value;
}

const SITES = [
  ['.close-button:hover', 'color', 'var(--cx-accent)'],
  ['.modal-form input:focus', 'border-color', 'var(--cx-accent)'],
  ['.modal-form__textarea:focus', 'border-color', 'var(--cx-accent)'],
  ['.form-success', 'color', 'var(--cx-success)'],
  ['.login-tab.active', 'color', 'var(--cx-accent)'],
  ['.input-hint--available', 'color', 'var(--cx-success)'],
  ['.modal-form input.input--available', 'border-color', 'var(--cx-success)'],
  ['.rule--pass', 'color', 'var(--cx-success)'],
  ['.welcome-subtitle', 'color', 'var(--text-secondary)'],
  ['.setup-checkbox input[type="checkbox"]', 'accent-color', 'var(--cx-accent)'],
  ['.presence-dot', 'background', 'var(--cx-presence)'],
  ['.presence-dot', 'box-shadow', '0 0 5px var(--cx-presence-glow)'],
  ['.presence-avatar', 'color', 'var(--cx-white)'],
  ['.presence-avatar', 'border', '2px solid var(--cx-surface-0)'],
  ['.presence-overflow', 'color', 'var(--text-secondary)'],
  ['.presence-tooltip', 'background', 'var(--bg-panel)'],
  ['.presence-tooltip', 'border', '1px solid var(--border-color)'],
  ['.presence-tooltip', 'box-shadow', 'var(--cx-shadow-popover)'],
  ['.presence-tooltip__user', 'color', 'var(--text-primary)'],
];

describe('the four leftover banners read the tokens, pinned declaration by declaration', () => {
  it.each(SITES)('%s %s is %s', (selector, prop, value) => {
    expect(declared(selector, prop), `${selector} ${prop}`).toBe(value);
  });

  it('names every burned site, so the list cannot quietly shrink', () => {
    expect(SITES.length).toBe(19);
  });
});
