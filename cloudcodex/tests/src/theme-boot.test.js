/**
 * Cloud Codex - the pre-paint script in index.html resolves the same answers as suite-prefs.js (W6-CDX-44)
 *
 * The script is the inline <script> in index.html, run here as its own text (new Function) against each
 * precedence case, so the script and the module cannot drift apart. The accent cases cover every legacy
 * key the script knows, through the same ACCENTS and LEGACY_ACCENT tables the module reads.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCENTS, LEGACY_ACCENT, successorOf } from '../../src/tokens/accents.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];

let cookieText;

function boot({ cookie = '', stored = {}, system = 'dark' } = {}) {
  const root = document.documentElement;
  root.setAttribute('data-theme', 'dark');
  root.removeAttribute('data-accent');
  root.style.cssText = '';
  localStorage.clear();
  for (const [k, v] of Object.entries(stored)) localStorage.setItem(k, v);
  cookieText = cookie;
  Object.defineProperty(document, 'cookie', { configurable: true, get: () => cookieText });
  if (system === 'none') {
    Reflect.deleteProperty(window, 'matchMedia');
  } else {
    window.matchMedia = vi.fn(() => ({ matches: system === 'light' }));
  }
  new Function(script)();
  return {
    theme: root.getAttribute('data-theme'),
    meta: document.querySelector('meta[name="color-scheme"]')?.getAttribute('content'),
    hue: root.style.getPropertyValue('--cx-accent-h'),
    accent: root.hasAttribute('data-accent'),
  };
}

beforeEach(() => {
  const meta = document.createElement('meta');
  meta.setAttribute('name', 'color-scheme');
  meta.setAttribute('content', 'dark light');
  document.head.appendChild(meta);
});

afterEach(() => {
  document.querySelector('meta[name="color-scheme"]')?.remove();
  delete document.cookie;
  Reflect.deleteProperty(window, 'matchMedia');
  localStorage.clear();
});

describe('index.html: the pre-paint theme', () => {
  it('sits after the color-scheme meta and before the module script, with no stylesheet ahead of it', () => {
    const scriptAt = html.indexOf('<script>');
    expect(html.indexOf('name="color-scheme"')).toBeLessThan(scriptAt);
    expect(html.indexOf('<script type="module"')).toBeGreaterThan(scriptAt);
    expect(html.indexOf('rel="stylesheet"')).toBe(-1);
  });

  it('carries the no-script default data-theme="dark"', () => {
    expect(html).toMatch(/<html lang="en" data-theme="dark">/);
  });

  it('a stored light cookie wins over a stored dark key and the system', () => {
    expect(boot({ cookie: 'cc_suite_theme=light', stored: { cc_suite_theme: 'dark' }, system: 'dark' }).theme).toBe('light');
  });

  it('localStorage is read when no cookie is valid', () => {
    expect(boot({ cookie: 'cc_suite_theme=Light', stored: { cc_suite_theme: 'light' }, system: 'dark' }).theme).toBe('light');
  });

  it('the system decides when nothing is stored, and dark when matchMedia is missing', () => {
    expect(boot({ system: 'light' }).theme).toBe('light');
    expect(boot({ system: 'dark' }).theme).toBe('dark');
    expect(boot({ system: 'none' }).theme).toBe('dark');
  });

  it('keeps the meta color-scheme in step with the theme', () => {
    expect(boot({ cookie: 'cc_suite_theme=light' }).meta).toBe('light');
    expect(boot({ system: 'dark' }).meta).toBe('dark');
  });

  it('an invalid value at every step falls through to the system', () => {
    const r = boot({ cookie: 'cc_suite_theme=blue', stored: { cc_suite_theme: 'purple' }, system: 'light' });
    expect(r.theme).toBe('light');
  });
});

describe('index.html: the pre-paint accent', () => {
  it('sets no accent when nothing is stored', () => {
    const r = boot();
    expect(r.accent).toBe(false);
    expect(r.hue).toBe('');
  });

  it.each(Object.entries(ACCENTS))('a stored contract hue %s sets the attribute and the hue', (name, hue) => {
    const r = boot({ cookie: `cc_suite_accent=${hue}` });
    expect(r.accent, name).toBe(true);
    expect(r.hue, name).toBe(String(hue));
  });

  it.each(Object.keys({ ...ACCENTS, ...LEGACY_ACCENT }))('the legacy Codex key %s maps to its successor hue', (key) => {
    const expected = String(ACCENTS[successorOf(key)]);
    const r = boot({ stored: { 'c2-user-prefs': JSON.stringify({ accentColor: key }) } });
    expect(r.hue, key).toBe(expected);
  });

  it('a stored contract accent wins over the legacy key', () => {
    const r = boot({ cookie: 'cc_suite_accent=200', stored: { 'c2-user-prefs': JSON.stringify({ accentColor: 'nova' }) } });
    expect(r.hue).toBe('200');
  });

  it('rejects an invalid hue at each step and a prototype name, with no attribute', () => {
    const r = boot({
      cookie: 'cc_suite_accent=232.0',
      stored: { cc_suite_accent: '7', 'c2-user-prefs': JSON.stringify({ accentColor: 'constructor' }) },
    });
    expect(r.accent).toBe(false);
    expect(boot({ stored: { 'c2-user-prefs': '{"accentColor":"__proto__"}' } }).accent).toBe(false);
  });

  it('survives corrupt legacy JSON', () => {
    expect(boot({ stored: { 'c2-user-prefs': '{not json' } }).accent).toBe(false);
  });
});
