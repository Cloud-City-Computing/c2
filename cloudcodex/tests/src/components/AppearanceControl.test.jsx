/**
 * Cloud Codex - the header's Appearance popover (W6-CDX-44, aligned with Cloud Command's)
 *
 * A non-modal disclosure in every page header: Theme (System, Light, Dark) and the eight accents with
 * Default. Keyboard: opening focuses the checked option, Tab stays inside, Escape and an outside press
 * close it and return focus to the toggle. Each capture-style case sets data-theme and the matchMedia
 * mock together, and asserts that the pressed option matches the page.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup, within } from '@testing-library/react';

vi.mock('../../../src/hooks/useSuite.js', () => ({ suitePreferenceDomain: vi.fn(() => Promise.resolve(null)) }));

import AppearanceControl from '../../../src/components/AppearanceControl.jsx';
import * as prefs from '../../../src/lib/suite-prefs.js';
import { ACCENTS } from '../../../src/tokens/accents.js';

function page(theme, system = 'dark') {
  document.documentElement.setAttribute('data-theme', theme);
  window.matchMedia = vi.fn(() => ({ matches: system === 'light', addEventListener() {}, removeEventListener() {} }));
}

const toggle = () => screen.getByRole('button', { name: 'Appearance' });
const panel = () => document.querySelector('.appearance-panel');
const pressedNames = (scope) => within(scope).getAllByRole('button')
  .filter((b) => b.getAttribute('aria-pressed') === 'true')
  .map((b) => b.getAttribute('aria-label') || b.textContent);

async function click(el) {
  await act(async () => {
    fireEvent.click(el);
  });
}

async function open() {
  await click(toggle());
  return panel();
}

beforeEach(() => {
  localStorage.clear();
  prefs.__resetSuitePrefs();
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
  document.querySelectorAll('.appearance-panel').forEach((n) => n.remove());
});

describe('AppearanceControl: the toggle', () => {
  it('is a native button named Appearance, collapsed at first', () => {
    render(<AppearanceControl />);
    const button = toggle();
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(panel()).toBeNull();
  });

  it('opens a panel in the body, and names it by the controls it holds', async () => {
    render(<AppearanceControl />);
    const p = await open();
    expect(p).not.toBeNull();
    expect(p.parentElement).toBe(document.body);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(toggle().getAttribute('aria-controls')).toBe(p.id);
  });
});

describe('AppearanceControl: placement', () => {
  // The header wraps on a phone, so the toggle can sit at the left edge: a panel aligned to its right edge
  // would run off the screen. The panel must stay inside the viewport at every width.
  it.each([
    [390, { left: 16, right: 58 }],
    [320, { left: 16, right: 58 }],
    [1280, { left: 1200, right: 1240 }],
  ])('keeps the panel inside a %ipx viewport, whatever the toggle position (toggle at %o)', async (width, rect) => {
    window.innerWidth = width;
    render(<AppearanceControl />);
    const button = toggle();
    button.getBoundingClientRect = () => ({ ...rect, top: 16, bottom: 48, width: rect.right - rect.left, height: 32 });
    const p = await open();
    const panelWidth = Math.min(288, width - 16);
    const left = parseFloat(p.style.left);
    expect(left).toBeGreaterThanOrEqual(8);
    expect(left + panelWidth).toBeLessThanOrEqual(width - 8);
    window.innerWidth = 1024;
  });
});

describe('AppearanceControl: the Theme options', () => {
  it('offers System (named Match system), Light and Dark, with the visible word System', async () => {
    render(<AppearanceControl />);
    const p = await open();
    const group = within(p).getByRole('group', { name: 'Theme' });
    const options = within(group).getAllByRole('button');
    expect(options.map((b) => b.textContent)).toEqual(['System', 'Light', 'Dark']);
    const system = within(group).getByRole('button', { name: 'Match system' });
    expect(system.getAttribute('title')).toBe('Match system');
    expect(system.textContent).toBe('System');
  });

  it('presses System when nothing is stored, and that matches the page', async () => {
    page('dark', 'dark');
    render(<AppearanceControl />);
    const p = await open();
    expect(pressedNames(within(p).getByRole('group', { name: 'Theme' }))).toEqual(['Match system']);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('presses the stored choice, and it matches the page', async () => {
    page('light', 'dark');
    localStorage.setItem('cc_suite_theme', 'light');
    render(<AppearanceControl />);
    const p = await open();
    expect(pressedNames(within(p).getByRole('group', { name: 'Theme' }))).toEqual(['Light']);
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('choosing Light applies it and stores it; System clears the store and follows the operating system', async () => {
    page('dark', 'light');
    render(<AppearanceControl />);
    const p = await open();
    const group = within(p).getByRole('group', { name: 'Theme' });
    await click(within(group).getByRole('button', { name: 'Light' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('cc_suite_theme')).toBe('light');
    expect(pressedNames(group)).toEqual(['Light']);
    await click(within(group).getByRole('button', { name: 'Match system' }));
    expect(localStorage.getItem('cc_suite_theme')).toBeNull();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(pressedNames(group)).toEqual(['Match system']);
  });
});

describe('AppearanceControl: the accent swatches', () => {
  it('offers the eight named swatches and Default', async () => {
    render(<AppearanceControl />);
    const p = await open();
    expect(p.querySelectorAll('.color-swatch')).toHaveLength(Object.keys(ACCENTS).length);
    expect(within(p).getByRole('button', { name: 'Default' })).toBeTruthy();
  });

  it('draws Default as a compact pill outside the segmented groups', async () => {
    render(<AppearanceControl />);
    const p = await open();
    const button = within(p).getByRole('button', { name: 'Default' });
    expect(button.classList.contains('appearance-default')).toBe(true);
    expect(button.closest('.pref-toggle-group')).toBeNull();
  });

  it('a picked swatch sets its hue on the page and is pressed; Default clears it', async () => {
    render(<AppearanceControl />);
    const p = await open();
    await click(within(p).getByRole('button', { name: 'Nova' }));
    expect(document.documentElement.style.getPropertyValue('--cx-accent-h')).toBe(String(ACCENTS.nova));
    expect(within(p).getByRole('button', { name: 'Nova' }).getAttribute('aria-pressed')).toBe('true');
    await click(within(p).getByRole('button', { name: 'Default' }));
    expect(document.documentElement.hasAttribute('data-accent')).toBe(false);
    expect(within(p).getByRole('button', { name: 'Default' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(p).getByRole('button', { name: 'Nova' }).getAttribute('aria-pressed')).toBe('false');
  });
});

describe('AppearanceControl: keyboard and focus', () => {
  it('opening moves focus to the checked Theme option', async () => {
    page('light', 'dark');
    localStorage.setItem('cc_suite_theme', 'light');
    render(<AppearanceControl />);
    await open();
    expect(document.activeElement).toBe(within(panel()).getByRole('button', { name: 'Light' }));
  });

  it('Tab from the toggle enters the panel, and Shift+Tab from it enters at the end', async () => {
    render(<AppearanceControl />);
    const p = await open();
    const stops = [...p.querySelectorAll('button')];
    await act(async () => {
      toggle().focus();
      fireEvent.keyDown(toggle(), { key: 'Tab' });
    });
    expect(document.activeElement).toBe(stops[0]);
    await act(async () => {
      toggle().focus();
      fireEvent.keyDown(toggle(), { key: 'Tab', shiftKey: true });
    });
    expect(document.activeElement).toBe(stops[stops.length - 1]);
  });

  it('keeps Tab inside: from the last control it wraps to the first, and Shift+Tab from the first wraps to the last', async () => {
    render(<AppearanceControl />);
    const p = await open();
    const stops = [...p.querySelectorAll('button')];
    stops[stops.length - 1].focus();
    fireEvent.keyDown(stops[stops.length - 1], { key: 'Tab' });
    expect(document.activeElement).toBe(stops[0]);
    stops[0].focus();
    fireEvent.keyDown(stops[0], { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(stops[stops.length - 1]);
  });

  it('Escape closes the panel and returns focus to the toggle', async () => {
    render(<AppearanceControl />);
    const p = await open();
    await act(async () => {
      fireEvent.keyDown(within(p).getByRole('button', { name: 'Light' }), { key: 'Escape' });
    });
    expect(panel()).toBeNull();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle());
  });

  it('a press outside closes the panel; a press on plain content returns focus to the toggle', async () => {
    render(<AppearanceControl />);
    await open();
    await act(async () => {
      fireEvent.pointerDown(document.body);
      fireEvent.click(document.body);
    });
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(toggle());
  });

  it('a press on another control closes the panel and keeps the focus that control takes', async () => {
    render(<AppearanceControl />);
    await open();
    const other = document.createElement('button');
    document.body.appendChild(other);
    await act(async () => {
      fireEvent.pointerDown(other);
      other.focus();
      fireEvent.click(other);
    });
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(other);
    other.remove();
  });

  it('a press inside the panel does not close it', async () => {
    render(<AppearanceControl />);
    const p = await open();
    await act(async () => {
      fireEvent.pointerDown(within(p).getByRole('button', { name: 'Dark' }));
    });
    expect(panel()).toBe(p);
  });
});
