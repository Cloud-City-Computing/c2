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
import {
  loadUserPrefs,
  saveUserPrefs,
  applyPrefsToDOM,
  getPreferredEditorMode,
  ACCENT_COLORS,
  FONT_SIZES,
  DENSITIES,
} from '../../src/userPrefs.js';

const PREFS_KEY = 'c2-user-prefs';

describe('userPrefs', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('style');
    document.documentElement.style.cssText = '';
    document.body.removeAttribute('data-sidebar-default');
  });

  // ── Constants ──────────────────────────────────────────

  describe('exported constants', () => {
    it('ACCENT_COLORS has every entry with value/light/dark/hover hex strings', () => {
      const keys = Object.keys(ACCENT_COLORS);
      expect(keys.length).toBeGreaterThanOrEqual(8);
      for (const key of keys) {
        const c = ACCENT_COLORS[key];
        expect(c.value).toMatch(/^#[0-9a-f]{6}$/i);
        expect(c.light).toMatch(/^#[0-9a-f]{6}$/i);
        expect(c.dark).toMatch(/^#[0-9a-f]{6}$/i);
        expect(c.hover).toMatch(/^#[0-9a-f]{6}$/i);
      }
    });

    it('FONT_SIZES has sm/md/lg in pixels', () => {
      expect(FONT_SIZES.sm).toMatch(/px$/);
      expect(FONT_SIZES.md).toMatch(/px$/);
      expect(FONT_SIZES.lg).toMatch(/px$/);
    });

    it('DENSITIES are numeric scale factors', () => {
      expect(typeof DENSITIES.compact).toBe('number');
      expect(typeof DENSITIES.comfortable).toBe('number');
      expect(typeof DENSITIES.spacious).toBe('number');
      expect(DENSITIES.compact).toBeLessThan(DENSITIES.comfortable);
      expect(DENSITIES.comfortable).toBeLessThan(DENSITIES.spacious);
    });
  });

  // ── loadUserPrefs ──────────────────────────────────────

  describe('loadUserPrefs', () => {
    it('returns {} when nothing is stored', () => {
      expect(loadUserPrefs()).toEqual({});
    });

    it('returns the stored object when valid JSON is present', () => {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ accentColor: 'rose', fontSize: 'md' }));
      expect(loadUserPrefs()).toEqual({ accentColor: 'rose', fontSize: 'md' });
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
      saveUserPrefs({ accentColor: 'cyan', density: 'compact' });
      expect(JSON.parse(localStorage.getItem(PREFS_KEY))).toEqual({
        accentColor: 'cyan',
        density: 'compact',
      });
    });

    it('round-trips with loadUserPrefs', () => {
      const prefs = { accentColor: 'amber', fontSize: 'lg', density: 'spacious', sidebarDefault: 'collapsed' };
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
    it('sets all four --brand-blue* CSS custom properties for a known accent', () => {
      applyPrefsToDOM({ accentColor: 'rose' });
      const style = document.documentElement.style;
      expect(style.getPropertyValue('--brand-blue')).toBe(ACCENT_COLORS.rose.value);
      expect(style.getPropertyValue('--brand-blue-light')).toBe(ACCENT_COLORS.rose.light);
      expect(style.getPropertyValue('--brand-blue-dark')).toBe(ACCENT_COLORS.rose.dark);
      expect(style.getPropertyValue('--brand-blue-hover')).toBe(ACCENT_COLORS.rose.hover);
    });

    it('removes --brand-blue properties when accent is unknown', () => {
      // First set, then clear by passing an unknown accent
      applyPrefsToDOM({ accentColor: 'cyan' });
      applyPrefsToDOM({ accentColor: 'no-such-color' });
      expect(document.documentElement.style.getPropertyValue('--brand-blue')).toBe('');
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

    it('sets --density-scale for a known density', () => {
      applyPrefsToDOM({ density: 'compact' });
      expect(document.documentElement.style.getPropertyValue('--density-scale')).toBe(
        String(DENSITIES.compact)
      );
    });

    it('removes --density-scale when density is unknown', () => {
      applyPrefsToDOM({ density: 'spacious' });
      applyPrefsToDOM({ density: 'absurd' });
      expect(document.documentElement.style.getPropertyValue('--density-scale')).toBe('');
    });

    it('sets data-sidebar-default attribute when sidebarDefault is "collapsed"', () => {
      applyPrefsToDOM({ sidebarDefault: 'collapsed' });
      expect(document.body.getAttribute('data-sidebar-default')).toBe('collapsed');
    });

    it('removes data-sidebar-default attribute when sidebarDefault is anything else', () => {
      applyPrefsToDOM({ sidebarDefault: 'collapsed' });
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
