/**
 * Cloud Codex — Tests for src/userPrefs.js
 *
 * Runs in the jsdom project so localStorage and document.documentElement
 * are available for the apply-to-DOM and load/save round-trips.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as userPrefsModule from '../../src/userPrefs.js';
import {
  loadUserPrefs,
  saveUserPrefs,
  applyPrefsToDOM,
  getPreferredEditorMode,
  ACCENT_COLORS,
  FONT_SIZES,
} from '../../src/userPrefs.js';

const PREFS_KEY = 'c2-user-prefs';

describe('userPrefs', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('style');
    document.documentElement.style.cssText = '';
    document.body.removeAttribute('data-sidebar-default');
    document.documentElement.style.removeProperty('--density-scale');
  });

  // ── Constants ──────────────────────────────────────────

  describe('exported constants', () => {
    it('ACCENT_COLORS has exactly the eight picker hues, each with value, hover and fill oklch strings', () => {
      expect(Object.keys(ACCENT_COLORS).sort())
        .toEqual(['aurora', 'blue', 'cyan', 'lime', 'nebula', 'nova', 'pink', 'solar']);
      for (const key of Object.keys(ACCENT_COLORS)) {
        const c = ACCENT_COLORS[key];
        expect(c.value).toMatch(/^oklch\(0\.78 0\.12 [\d.]+\)$/);
        expect(c.hover).toMatch(/^oklch\(0\.88 0\.06 [\d.]+\)$/);
        expect(c.fill).toMatch(/^oklch\(0\.68 0\.13 [\d.]+\)$/);
        expect(c.dark).toMatch(/^oklch\(0\.45 0\.13 [\d.]+\)$/);
      }
    });

    it('FONT_SIZES has sm/md/lg in pixels', () => {
      expect(FONT_SIZES.sm).toMatch(/px$/);
      expect(FONT_SIZES.md).toMatch(/px$/);
      expect(FONT_SIZES.lg).toMatch(/px$/);
    });

    // W6-CDX-42, K8: Codex keeps the editor font size only; density and the sidebar default are gone.
    it('exports no DENSITIES table', () => {
      expect(userPrefsModule.DENSITIES).toBeUndefined();
    });
  });

  // ── loadUserPrefs ──────────────────────────────────────

  describe('loadUserPrefs', () => {
    it('returns {} when nothing is stored', () => {
      expect(loadUserPrefs()).toEqual({});
    });

    it('returns the stored object when valid JSON is present', () => {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ accentColor: 'nova', fontSize: 'md' }));
      expect(loadUserPrefs()).toEqual({ accentColor: 'nova', fontSize: 'md' });
    });

    it('maps each renamed accent key to its one successor, and keeps the four kept names', () => {
      const pairs = [['rose', 'nova'], ['amber', 'solar'], ['emerald', 'aurora'], ['violet', 'nebula'],
        ['coral', 'nova'], ['apricot', 'solar'], ['jade', 'aurora'], ['iris', 'nebula'],
        ['blue', 'blue'], ['cyan', 'cyan'], ['pink', 'pink'], ['lime', 'lime']];
      for (const [stored, loaded] of pairs) {
        localStorage.setItem(PREFS_KEY, JSON.stringify({ accentColor: stored, fontSize: 'md' }));
        expect(loadUserPrefs(), stored).toEqual({ accentColor: loaded, fontSize: 'md' });
      }
    });

    it('treats prototype names as unknown accents, never as hues', () => {
      for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
        localStorage.setItem(PREFS_KEY, JSON.stringify({ accentColor: name, fontSize: 'lg' }));
        expect(loadUserPrefs(), name).toEqual({ fontSize: 'lg' });
      }
    });

    it('drops an unknown accent key, so the default palette applies', () => {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ accentColor: 'no-such-color', fontSize: 'lg' }));
      expect(loadUserPrefs()).toEqual({ fontSize: 'lg' });
    });

    // W6-CDX-42, K8: a density or sidebar default stored by an earlier build is dropped on load.
    it('drops a stored density and sidebarDefault, and keeps the rest', () => {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ density: 'compact', sidebarDefault: 'collapsed', fontSize: 'sm', preferredEditor: 'markdown' }));
      expect(loadUserPrefs()).toEqual({ fontSize: 'sm', preferredEditor: 'markdown' });
    });

    it('falls back to {} when stored JSON is corrupt', () => {
      localStorage.setItem(PREFS_KEY, 'not-json{{{');
      expect(loadUserPrefs()).toEqual({});
    });

    it('falls back to {} when stored value is the literal string "null"', () => {
      localStorage.setItem(PREFS_KEY, 'null');
      expect(loadUserPrefs()).toEqual({});
    });
  });

  // ── saveUserPrefs ──────────────────────────────────────

  describe('saveUserPrefs', () => {
    it('persists prefs as JSON under the canonical key', () => {
      saveUserPrefs({ accentColor: 'cyan', fontSize: 'sm' });
      expect(JSON.parse(localStorage.getItem(PREFS_KEY))).toEqual({
        accentColor: 'cyan',
        fontSize: 'sm',
      });
    });

    it('round-trips with loadUserPrefs', () => {
      const prefs = { accentColor: 'solar', fontSize: 'lg', preferredEditor: 'markdown' };
      saveUserPrefs(prefs);
      expect(loadUserPrefs()).toEqual(prefs);
    });

    it('overwrites prior prefs (no merge — caller is responsible)', () => {
      saveUserPrefs({ accentColor: 'blue' });
      saveUserPrefs({ fontSize: 'sm' });
      expect(loadUserPrefs()).toEqual({ fontSize: 'sm' });
    });
  });

  // ── applyPrefsToDOM ────────────────────────────────────

  describe('applyPrefsToDOM', () => {
    it('sets the three --cx-accent custom properties for a known accent, never --brand-blue*', () => {
      applyPrefsToDOM({ accentColor: 'nova' });
      const style = document.documentElement.style;
      expect(style.getPropertyValue('--cx-accent')).toBe(ACCENT_COLORS.nova.value);
      expect(style.getPropertyValue('--cx-accent-hover')).toBe(ACCENT_COLORS.nova.hover);
      expect(style.getPropertyValue('--cx-accent-fill')).toBe(ACCENT_COLORS.nova.fill);
      expect(style.getPropertyValue('--cx-accent-dark')).toBe(ACCENT_COLORS.nova.dark);
      for (const name of ['--brand-blue', '--brand-blue-light', '--brand-blue-dark', '--brand-blue-hover']) {
        expect(style.getPropertyValue(name)).toBe('');
      }
    });

    it('writes --cx-accent-dark for a picked accent and removes it for the default', () => {
      applyPrefsToDOM({ accentColor: 'nova' });
      expect(document.documentElement.style.getPropertyValue('--cx-accent-dark')).toBe(ACCENT_COLORS.nova.dark);
      applyPrefsToDOM({});
      expect(document.documentElement.style.getPropertyValue('--cx-accent-dark')).toBe('');
    });

    it('treats a prototype name as the default: no throw, and the --cx-accent properties stay unset', () => {
      applyPrefsToDOM({ accentColor: 'constructor' });
      applyPrefsToDOM({ accentColor: '__proto__' });
      const style = document.documentElement.style;
      expect(style.getPropertyValue('--cx-accent')).toBe('');
      expect(style.getPropertyValue('--cx-accent-dark')).toBe('');
    });

    it('removes the --cx-accent properties when accent is unknown or the default', () => {
      // First set, then clear by passing an unknown accent
      applyPrefsToDOM({ accentColor: 'cyan' });
      applyPrefsToDOM({ accentColor: 'no-such-color' });
      const style = document.documentElement.style;
      expect(style.getPropertyValue('--cx-accent')).toBe('');
      expect(style.getPropertyValue('--cx-accent-hover')).toBe('');
      expect(style.getPropertyValue('--cx-accent-fill')).toBe('');
    });

    it('sets --editor-font-size for a known fontSize key', () => {
      applyPrefsToDOM({ fontSize: 'lg' });
      expect(document.documentElement.style.getPropertyValue('--editor-font-size')).toBe(FONT_SIZES.lg);
    });

    it('removes --editor-font-size when fontSize is unknown', () => {
      applyPrefsToDOM({ fontSize: 'lg' });
      applyPrefsToDOM({ fontSize: 'huge' });
      expect(document.documentElement.style.getPropertyValue('--editor-font-size')).toBe('');
    });

    // W6-CDX-42, K8: no density scale, and no sidebar attribute, whatever the prefs hold.
    it('never sets --density-scale, whatever density holds', () => {
      applyPrefsToDOM({ density: 'compact' });
      applyPrefsToDOM({ density: 'spacious' });
      expect(document.documentElement.style.getPropertyValue('--density-scale')).toBe('');
    });

    it('never sets data-sidebar-default, whatever sidebarDefault holds', () => {
      applyPrefsToDOM({ sidebarDefault: 'collapsed' });
      expect(document.body.hasAttribute('data-sidebar-default')).toBe(false);
      applyPrefsToDOM({ sidebarDefault: 'expanded' });
      expect(document.body.hasAttribute('data-sidebar-default')).toBe(false);
    });

    it('handles an empty prefs object without throwing', () => {
      expect(() => applyPrefsToDOM({})).not.toThrow();
    });
  });

  // ── getPreferredEditorMode ─────────────────────────────

  describe('getPreferredEditorMode', () => {
    it("defaults to 'richtext' when no pref is stored", () => {
      expect(getPreferredEditorMode()).toBe('richtext');
    });

    it("returns 'markdown' when preferredEditor === 'markdown'", () => {
      saveUserPrefs({ preferredEditor: 'markdown' });
      expect(getPreferredEditorMode()).toBe('markdown');
    });

    it("returns 'richtext' for any other stored value", () => {
      saveUserPrefs({ preferredEditor: 'wysiwyg' });
      expect(getPreferredEditorMode()).toBe('richtext');
      saveUserPrefs({ preferredEditor: '' });
      expect(getPreferredEditorMode()).toBe('richtext');
    });
  });
});
