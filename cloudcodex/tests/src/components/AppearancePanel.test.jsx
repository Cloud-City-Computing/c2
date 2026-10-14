/**
 * Cloud Codex - Appearance: Theme (Match system, Light, Dark) and the accent picker, through appearance-prefs (W6-CDX-44)
 *
 * Every case sets data-theme and the matchMedia mock together. The pressed option must match the page:
 * a choice is pressed when it is stored, Match system when nothing is stored, and the swatch of the
 * accent in effect (none pressed, Default pressed, when the package ramp shows).
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup, within } from '@testing-library/react';


import { UserPreferencesPanel } from '../../../src/components/AccountMenu.jsx';
import * as prefs from '../../../src/lib/appearance-prefs.js';
import { ACCENTS } from '../../../src/tokens/accents.js';

function page(theme, system = 'dark') {
  document.documentElement.setAttribute('data-theme', theme);
  window.matchMedia = vi.fn(() => ({ matches: system === 'light', addEventListener() {}, removeEventListener() {} }));
}

const themeGroup = () => screen.getByRole('group', { name: 'Theme' });
const pressedIn = (scope) => within(scope).getAllByRole('button')
  .filter((b) => b.getAttribute('aria-pressed') === 'true')
  .map((b) => b.getAttribute('aria-label') || b.textContent);

async function click(el) {
  await act(async () => {
    fireEvent.click(el);
  });
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-accent');
  document.documentElement.style.removeProperty('--cx-accent-h');
  page('dark');
});

afterEach(async () => {
  cleanup();
  await prefs.clearTheme();
  await prefs.clearAccent();
  Reflect.deleteProperty(window, 'matchMedia');
  localStorage.clear();
});

describe('Appearance: Theme', () => {
  it('offers Match system, Light and Dark, with Match system pressed when nothing is stored', () => {
    render(<UserPreferencesPanel />);
    expect(pressedIn(themeGroup())).toEqual(['Match system']);
    expect(within(themeGroup()).getAllByRole('button').map((b) => b.textContent)).toEqual(['System', 'Light', 'Dark']);
    expect(within(themeGroup()).getByRole('button', { name: 'Match system' }).textContent).toBe('System');
  });

  it('presses the stored choice, and it matches the page', () => {
    page('light', 'dark');
    localStorage.setItem('cc_suite_theme', 'light');
    render(<UserPreferencesPanel />);
    expect(pressedIn(themeGroup())).toEqual(['Light']);
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('choosing Light applies it and stores it; Match system then clears the store and follows the system', async () => {
    page('dark', 'light');
    render(<UserPreferencesPanel />);
    await click(within(themeGroup()).getByRole('button', { name: 'Light' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('cc_suite_theme')).toBe('light');
    expect(pressedIn(themeGroup())).toEqual(['Light']);

    await click(within(themeGroup()).getByRole('button', { name: 'Match system' }));
    expect(localStorage.getItem('cc_suite_theme')).toBeNull();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(pressedIn(themeGroup())).toEqual(['Match system']);
  });
});

describe('Appearance: accent', () => {
  it('presses Default when no accent is set, and the page has no hue', () => {
    render(<UserPreferencesPanel />);
    expect(pressedIn(screen.getByText('Accent Color').closest('.pref-section'))).toEqual(['Default']);
    expect(document.documentElement.hasAttribute('data-accent')).toBe(false);
  });

  it('a picked swatch sets its hue on the page and is pressed; Default clears it', async () => {
    render(<UserPreferencesPanel />);
    await click(screen.getByRole('button', { name: 'Nova' }));
    expect(document.documentElement.style.getPropertyValue('--cx-accent-h')).toBe(String(ACCENTS.nova));
    expect(document.documentElement.hasAttribute('data-accent')).toBe(true);
    expect(localStorage.getItem('cc_suite_accent')).toBe(String(ACCENTS.nova));
    const section = screen.getByText('Accent Color').closest('.pref-section');
    expect(screen.getByRole('button', { name: 'Nova' }).getAttribute('aria-pressed')).toBe('true');
    expect(pressedIn(section)).toEqual(['Nova']);

    await click(within(section).getByRole('button', { name: 'Default' }));
    expect(document.documentElement.hasAttribute('data-accent')).toBe(false);
    expect(localStorage.getItem('cc_suite_accent')).toBeNull();
    expect(screen.getByRole('button', { name: 'Nova' }).getAttribute('aria-pressed')).toBe('false');
    expect(pressedIn(section)).toEqual(['Default']);
  });

  it('presses the swatch of the accent in effect', () => {
    localStorage.setItem('cc_suite_accent', String(ACCENTS.lime));
    render(<UserPreferencesPanel />);
    expect(screen.getByRole('button', { name: 'Ocean Blue' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Lime' }).getAttribute('aria-pressed')).toBe('true');
  });
});
