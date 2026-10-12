/**
 * Cloud Codex - the header's theme toggle (W6-CDX-44)
 *
 * A native button named for the theme it switches to. Each capture-style case sets data-theme and the
 * matchMedia mock together, so the page and the operating-system answer agree.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';

vi.mock('../../../src/hooks/useSuite.js', () => ({ suitePreferenceDomain: vi.fn(() => Promise.resolve(null)) }));

import ThemeToggle from '../../../src/components/ThemeToggle.jsx';
import * as prefs from '../../../src/lib/suite-prefs.js';

function page(theme, system = 'dark') {
  document.documentElement.setAttribute('data-theme', theme);
  window.matchMedia = vi.fn(() => ({ matches: system === 'light', addEventListener() {}, removeEventListener() {} }));
}

beforeEach(() => {
  localStorage.clear();
  prefs.__resetSuitePrefs();
  page('dark');
});

afterEach(async () => {
  cleanup();
  await prefs.clearTheme();
  Reflect.deleteProperty(window, 'matchMedia');
  localStorage.clear();
});

describe('ThemeToggle', () => {
  it('is a native button named for the theme it switches to', () => {
    render(<ThemeToggle />);
    const button = screen.getByRole('button', { name: 'Switch to light theme' });
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
  });

  it('names the other theme when the page is light', () => {
    page('light', 'light');
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeTruthy();
  });

  it('switches the page and persists the choice, and its name flips', async () => {
    render(<ThemeToggle />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    });
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('cc_suite_theme')).toBe('light');
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeTruthy();
  });

  it('follows a choice made in another tab, when storage changes', () => {
    // The app starts watch() at boot (main.jsx); the storage event reaches the toggle through it.
    const stop = prefs.watch();
    render(<ThemeToggle />);
    act(() => {
      localStorage.setItem('cc_suite_theme', 'light');
      window.dispatchEvent(new StorageEvent('storage', { key: 'cc_suite_theme', newValue: 'light' }));
    });
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeTruthy();
    stop();
  });
});
