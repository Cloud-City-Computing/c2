/**
 * Cloud Codex - the suite preference contract, as src/lib/suite-prefs.js implements it (W6-CDX-44)
 *
 * Each rule of the contract (docs/maps/suite-ui-alignment-record.md, "The suite preference
 * contract") has a case here: the precedence steps, the cookie's attributes and write order, the
 * host-only writes, clearing, the reconcile that makes the cookie win, the legacy migration,
 * and the two re-apply paths. document.cookie is replaced by a small jar that records every write,
 * so a test can assert the exact strings a browser would be sent.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import * as prefs from '../../../src/lib/suite-prefs.js';
import { ACCENTS } from '../../../src/tokens/accents.js';

const THEME = 'cc_suite_theme';
const ACCENT = 'cc_suite_accent';
const PREFS_KEY = 'c2-user-prefs';

let jar;
let writes;

// A stand-in for document.cookie: a name-to-value map, with every assignment recorded verbatim.
function installJar() {
  jar = new Map();
  writes = [];
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get() {
      return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    set(raw) {
      writes.push(raw);
      const [pair, ...attrs] = raw.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      if (attrs.some((a) => /^\s*max-age=0\s*$/i.test(a))) jar.delete(name);
      else jar.set(name, pair.slice(eq + 1));
    },
  });
}

function setHost(hostname, protocol = 'http:') {
  vi.stubGlobal('location', { hostname, protocol, href: `${protocol}//${hostname}/` });
}

function setSystemLight(light) {
  window.matchMedia = vi.fn(() => ({ matches: light, addEventListener() {}, removeEventListener() {} }));
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-accent');
  document.documentElement.style.removeProperty('--cx-accent-h');
  document.documentElement.setAttribute('data-theme', 'dark');
  installJar();
  setHost('codex.example.com', 'https:');
  setSystemLight(false);
});

afterEach(() => {
  delete document.cookie;
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('precedence, theme', () => {
  it('a valid cookie beats localStorage, which beats the system', () => {
    jar.set(THEME, 'light');
    localStorage.setItem(THEME, 'dark');
    expect(prefs.resolveTheme()).toBe('light');
  });

  it('localStorage is read when no cookie is valid', () => {
    jar.set(THEME, 'blue');
    localStorage.setItem(THEME, 'light');
    expect(prefs.resolveTheme()).toBe('light');
  });

  it('the system decides when neither store holds a valid value', () => {
    setSystemLight(true);
    expect(prefs.resolveTheme()).toBe('light');
    setSystemLight(false);
    expect(prefs.resolveTheme()).toBe('dark');
  });

  it('nothing at all, and no matchMedia, gives dark', () => {
    Reflect.deleteProperty(window, 'matchMedia');
    expect(prefs.resolveTheme()).toBe('dark');
  });

  it('an invalid cookie falls through to localStorage, and an invalid store to the system', () => {
    jar.set(THEME, 'Light');
    localStorage.setItem(THEME, 'purple');
    setSystemLight(true);
    expect(prefs.resolveTheme()).toBe('light');
    expect(prefs.storedThemeChoice()).toBeNull();
  });

  it('takes the first valid cookie entry, and reads the name by exact match', () => {
    // A browser may hold two entries of one name (a host-only copy and a shared one); the first valid wins.
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => 'xcc_suite_theme=light; cc_suite_theme=blue; cc_suite_theme=dark; cc_suite_theme=light',
    });
    expect(prefs.storedThemeChoice()).toBe('dark');
  });

  it('a throwing localStorage is skipped, not fatal', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    setSystemLight(true);
    expect(prefs.resolveTheme()).toBe('light');
    vi.restoreAllMocks();
  });
});

describe('precedence, accent', () => {
  it('the cookie beats localStorage, and a valid store beats the legacy key', () => {
    jar.set(ACCENT, '200');
    localStorage.setItem(ACCENT, '325');
    localStorage.setItem(PREFS_KEY, JSON.stringify({ accentColor: 'nova' }));
    expect(prefs.resolveAccent()).toBe(200);
  });

  it('the legacy Codex key maps through its successor to a hue, when no contract value is set', () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ accentColor: 'rose' }));
    expect(prefs.resolveAccent()).toBe(355);
  });

  it('an unset accent is null, the package default', () => {
    expect(prefs.resolveAccent()).toBeNull();
  });

  it('an invalid value at each step falls through, and the legacy key must be an offered name', () => {
    jar.set(ACCENT, '232.0');
    localStorage.setItem(ACCENT, '7');
    localStorage.setItem(PREFS_KEY, JSON.stringify({ accentColor: 'constructor' }));
    expect(prefs.resolveAccent()).toBeNull();
  });
});

describe('writing: the choice is host-only, written at once', () => {
  it('writes the host-only cookie, then expires the name on the parent domain, then localStorage', async () => {
    await prefs.setTheme('light');
    expect(writes).toEqual([
      'cc_suite_theme=light; Path=/; Max-Age=34560000; SameSite=Lax; Secure',
      'cc_suite_theme=; Path=/; Max-Age=0; Domain=example.com',
    ]);
    expect(localStorage.getItem(THEME)).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('never gives the value-bearing cookie a Domain, and needs no request before it writes', async () => {
    await prefs.setTheme('dark');
    await prefs.setAccent(ACCENTS.blue);
    const values = writes.filter((w) => !/Max-Age=0/.test(w));
    expect(values).toHaveLength(2);
    for (const write of values) expect(write).not.toContain('Domain=');
    expect(localStorage.getItem(THEME)).toBe('dark');
    expect(localStorage.getItem(ACCENT)).toBe(String(ACCENTS.blue));
  });

  it('expires the name on each parent domain of the host, and never on the public suffix', async () => {
    setHost('a.b.example.test', 'https:');
    await prefs.setTheme('light');
    expect(writes.filter((w) => /Max-Age=0/.test(w))).toEqual([
      'cc_suite_theme=; Path=/; Max-Age=0; Domain=b.example.test',
      'cc_suite_theme=; Path=/; Max-Age=0; Domain=example.test',
    ]);
  });

  it('adds no Secure on plain http', async () => {
    setHost('codex.example.com', 'http:');
    await prefs.setTheme('dark');
    expect(writes[0]).toBe('cc_suite_theme=dark; Path=/; Max-Age=34560000; SameSite=Lax');
  });

  it('on localhost, writes one host-only cookie and no Domain', async () => {
    setHost('localhost', 'http:');
    await prefs.setTheme('light');
    expect(writes).toEqual(['cc_suite_theme=light; Path=/; Max-Age=34560000; SameSite=Lax']);
    expect(localStorage.getItem(THEME)).toBe('light');
  });

  it('a value outside the allowlist is ignored, with no write', async () => {
    await prefs.setTheme('blue');
    await prefs.setAccent(999);
    expect(writes).toEqual([]);
    expect(localStorage.getItem(THEME)).toBeNull();
  });

  it('the accent writes its hue as a plain decimal, with the same attribute rules', async () => {
    await prefs.setAccent(ACCENTS.nova);
    expect(writes).toEqual([
      'cc_suite_accent=355; Path=/; Max-Age=34560000; SameSite=Lax; Secure',
      'cc_suite_accent=; Path=/; Max-Age=0; Domain=example.com',
    ]);
    expect(localStorage.getItem(ACCENT)).toBe('355');
    expect(document.documentElement.style.getPropertyValue('--cx-accent-h')).toBe('355');
    expect(document.documentElement.hasAttribute('data-accent')).toBe(true);
  });
});

describe('clearing', () => {
  it('Match system expires the host-only form, the parent-domain form, and the key', async () => {
    await prefs.setTheme('light');
    writes.length = 0;
    await prefs.clearTheme();
    expect(writes).toEqual([
      'cc_suite_theme=; Path=/; Max-Age=0',
      'cc_suite_theme=; Path=/; Max-Age=0; Domain=example.com',
    ]);
    expect(localStorage.getItem(THEME)).toBeNull();
  });

  it('clearing on localhost expires the host-only form alone', async () => {
    setHost('localhost', 'http:');
    await prefs.setAccent(ACCENTS.blue);
    writes.length = 0;
    await prefs.clearAccent();
    expect(writes).toEqual(['cc_suite_accent=; Path=/; Max-Age=0']);
  });

  it('the accent clears the same way, and the default bindings return', async () => {
    await prefs.setAccent(ACCENTS.cyan);
    await prefs.clearAccent();
    expect(localStorage.getItem(ACCENT)).toBeNull();
    expect(document.documentElement.hasAttribute('data-accent')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--cx-accent-h')).toBe('');
  });

  it('Match system applies the system theme to the page at once', async () => {
    await prefs.setTheme('dark');
    setSystemLight(true);
    await prefs.clearTheme();
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

describe('reconcile: the cookie wins and rewrites localStorage, for both keys', () => {
  it('rewrites a stale localStorage theme and accent to the cookie values on reconcile', () => {
    jar.set(THEME, 'light');
    jar.set(ACCENT, '175');
    localStorage.setItem(THEME, 'dark');
    localStorage.setItem(ACCENT, '50');
    prefs.applyPreferences();
    expect(localStorage.getItem(THEME)).toBe('light');
    expect(localStorage.getItem(ACCENT)).toBe('175');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.style.getPropertyValue('--cx-accent-h')).toBe('175');
  });

  it('runs again on reapply, so a cookie change made elsewhere lands in both stores', () => {
    prefs.applyPreferences();
    jar.set(THEME, 'light');
    jar.set(ACCENT, '131');
    localStorage.setItem(THEME, 'dark');
    localStorage.setItem(ACCENT, '232');
    const off = prefs.watch();
    expect(localStorage.getItem(THEME)).toBe('light');
    expect(localStorage.getItem(ACCENT)).toBe('131');
    off();
  });
});

describe('keeping open pages in step', () => {
  let stop;
  beforeEach(() => {
    stop = prefs.watch();
  });
  afterEach(() => {
    stop();
  });

  it('a storage event for the theme re-applies it', () => {
    jar.set(THEME, 'light');
    window.dispatchEvent(new StorageEvent('storage', { key: THEME, newValue: 'light' }));
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('a storage event for the accent re-applies it', () => {
    jar.set(ACCENT, '325');
    window.dispatchEvent(new StorageEvent('storage', { key: ACCENT, newValue: '325' }));
    expect(document.documentElement.style.getPropertyValue('--cx-accent-h')).toBe('325');
  });

  it('a storage event for another key is ignored', () => {
    jar.set(THEME, 'light');
    window.dispatchEvent(new StorageEvent('storage', { key: 'other', newValue: 'x' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('coming back to the front re-applies both preferences', () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    jar.set(THEME, 'light');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(document.documentElement.dataset.theme).toBe('light');
    delete document.visibilityState;
  });

  it('notifies subscribers after a change', async () => {
    const seen = vi.fn();
    const off = prefs.subscribe(seen);
    await prefs.setTheme('light');
    expect(seen).toHaveBeenCalled();
    off();
  });
});

describe('the legacy migration', () => {
  it("turns c2-user-prefs' accentColor 'rose' into cc_suite_accent 355, and removes accentColor", async () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ accentColor: 'rose', fontSize: 'lg' }));
    await prefs.migrateLegacy();
    expect(localStorage.getItem(ACCENT)).toBe('355');
    expect(JSON.parse(localStorage.getItem(PREFS_KEY))).toEqual({ fontSize: 'lg' });
  });

  it('writes the contract value before it deletes the legacy key', async () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ accentColor: 'lime' }));
    const order = [];
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (k, v) {
      order.push(`set:${k}`);
      return setItem.call(this, k, v);
    });
    await prefs.migrateLegacy();
    vi.restoreAllMocks();
    expect(order.indexOf(`set:${ACCENT}`)).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(`set:${ACCENT}`)).toBeLessThan(order.indexOf(`set:${PREFS_KEY}`));
  });

  it('a stored contract accent wins over the legacy key, which is dropped without overwriting', async () => {
    jar.set(ACCENT, '200');
    localStorage.setItem(PREFS_KEY, JSON.stringify({ accentColor: 'rose' }));
    await prefs.migrateLegacy();
    expect(prefs.resolveAccent()).toBe(200);
    expect(JSON.parse(localStorage.getItem(PREFS_KEY))).toEqual({});
  });

  it('a legacy key this build does not offer is removed, not applied', async () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ accentColor: 'constructor' }));
    await prefs.migrateLegacy();
    expect(localStorage.getItem(ACCENT)).toBeNull();
    expect(JSON.parse(localStorage.getItem(PREFS_KEY))).toEqual({});
  });
});
