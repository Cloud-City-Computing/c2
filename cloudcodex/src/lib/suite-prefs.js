/**
 * Cloud Codex - the suite preference contract (W6-CDX-44)
 *
 * The one module that reads, writes, clears, migrates and keeps open pages in step for the theme and
 * the accent, exactly as docs/maps/suite-ui-alignment-record.md's "suite preference contract"
 * states it. Cloud Command implements the same contract; a change to it lands in both products.
 *
 * Reads: a valid cookie, then localStorage, then (accent only) the legacy Codex key, then the system
 * (theme) or the package's fixed ramp (accent). Writes: the shared cookie when the preference domain
 * is in use, a host-only expiry beside it, then localStorage. No write happens before the domain is
 * known (suitePreferenceDomain), and a failed read holds the write rather than guessing host-only.
 * The pre-paint script in index.html applies the same precedence before first paint; the test in
 * tests/src/theme-boot.test.js runs that script against these cases.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { suitePreferenceDomain } from '../hooks/useSuite.js';
import { ACCENTS, isAccent, successorOf } from '../tokens/accents.js';

export const THEME_NAME = 'cc_suite_theme';
export const ACCENT_NAME = 'cc_suite_accent';
const PREFS_KEY = 'c2-user-prefs';
const MAX_AGE = 34560000; // 400 days, the longest lifetime browsers keep

const HUE_STRINGS = new Set(Object.values(ACCENTS).map(String));
const isTheme = (value) => value === 'light' || value === 'dark';
const isHue = (value) => HUE_STRINGS.has(value);

// --- Reading -----------------------------------------------------------------

/** The first entry named `name` whose value passes `ok`, read by exact name; ASCII space and tab are stripped. */
function readCookie(name, ok) {
  let raw;
  try {
    raw = document.cookie;
  } catch {
    return null;
  }
  if (!raw) return null;
  for (const entry of raw.split(';')) {
    const part = entry.replace(/^[ \t]+/, '');
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq) === name && ok(part.slice(eq + 1))) return part.slice(eq + 1);
  }
  return null;
}

function readStored(name, ok) {
  try {
    const value = localStorage.getItem(name);
    return value !== null && ok(value) ? value : null;
  } catch {
    return null;
  }
}

function systemTheme() {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** The theme a user chose and stored (steps 1 and 2), or null for Match system. */
export function storedThemeChoice() {
  return readCookie(THEME_NAME, isTheme) ?? readStored(THEME_NAME, isTheme);
}

/** The theme to show: the stored choice, else the operating system's. */
export function resolveTheme() {
  return storedThemeChoice() ?? systemTheme();
}

function storedAccentValue() {
  return readCookie(ACCENT_NAME, isHue) ?? readStored(ACCENT_NAME, isHue);
}

/** The legacy Codex accent (c2-user-prefs.accentColor, step 3), mapped through its successor to a hue. */
function legacyAccentHue() {
  try {
    const key = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null')?.accentColor;
    if (typeof key !== 'string') return null;
    const name = successorOf(key);
    return isAccent(name) ? ACCENTS[name] : null;
  } catch {
    return null;
  }
}

/** The accent hue to show, or null for the package's default ramp. */
export function resolveAccent() {
  const stored = storedAccentValue();
  return stored !== null ? Number(stored) : legacyAccentHue();
}

/**
 * The preference domain when the host is under it (the dot boundary: the host equals it or ends with
 * "." plus it), else null. A null domain means every write is host-only.
 */
export function domainInUse(hostname, domain) {
  if (!domain) return null;
  return hostname === domain || hostname.endsWith(`.${domain}`) ? domain : null;
}

// --- The domain, and held writes ---------------------------------------------

let domainPromise = null;
let domainKnown = false;
let domainValue = null;

function knowDomain() {
  domainPromise ??= suitePreferenceDomain().then(
    (domain) => {
      domainKnown = true;
      domainValue = domain;
      return domain;
    },
    (error) => {
      domainPromise = null; // the next write asks again
      throw error;
    },
  );
  return domainPromise;
}

/** Runs `write(domain)` now when the domain is known, else once it is; a failed read drops the write. */
function whenDomainKnown(write) {
  if (domainKnown) {
    write(domainValue);
    return Promise.resolve();
  }
  return knowDomain().then((domain) => write(domain), () => {});
}

// --- Writing -----------------------------------------------------------------

function writeChoice(name, value, domain) {
  const shared = domainInUse(location.hostname, domain);
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${name}=${value}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax${secure}${shared ? `; Domain=${shared}` : ''}`;
  if (shared) document.cookie = `${name}=; Path=/; Max-Age=0`;
  try {
    localStorage.setItem(name, value);
  } catch {
    // Storage blocked: the cookie (when written) still carries the choice.
  }
}

function expireChoice(name, domain) {
  const shared = domainInUse(location.hostname, domain);
  if (shared) document.cookie = `${name}=; Path=/; Max-Age=0; Domain=${shared}`;
  document.cookie = `${name}=; Path=/; Max-Age=0`;
  try {
    localStorage.removeItem(name);
  } catch {
    // Storage blocked: nothing to remove.
  }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) meta.setAttribute('content', theme);
}

function applyAccent(hue) {
  const root = document.documentElement;
  if (hue === null) {
    root.style.removeProperty('--cx-accent-h');
    root.removeAttribute('data-accent');
  } else {
    root.style.setProperty('--cx-accent-h', String(hue));
    root.setAttribute('data-accent', '');
  }
}

const listeners = new Set();
function notify() {
  for (const listener of listeners) listener();
}

/** Calls `fn` whenever a preference changes here or in another open tab. Returns the unsubscribe. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Chooses light or dark. The page changes at once and subscribers hear it; the stores follow when the domain
 * is known, and subscribers hear that too, so none is left reading a store the held write has not reached yet.
 */
export function setTheme(value) {
  if (!isTheme(value)) return Promise.resolve();
  applyTheme(value);
  notify();
  return whenDomainKnown((domain) => writeChoice(THEME_NAME, value, domain)).then(notify);
}

/** Match system: expires the stored choice, and the page follows the operating system. */
export function clearTheme() {
  applyTheme(systemTheme());
  notify();
  return whenDomainKnown((domain) => expireChoice(THEME_NAME, domain)).then(notify);
}

/** Chooses one of the eight picker hues. */
export function setAccent(hue) {
  const value = String(hue);
  if (!isHue(value)) return Promise.resolve();
  applyAccent(Number(value));
  notify();
  return whenDomainKnown((domain) => writeChoice(ACCENT_NAME, value, domain)).then(notify);
}

/** Default: expires the stored accent, and the package's own ramp returns. */
export function clearAccent() {
  applyAccent(null);
  notify();
  return whenDomainKnown((domain) => expireChoice(ACCENT_NAME, domain)).then(notify);
}

// --- Keeping open pages in step ----------------------------------------------

/** Re-reads both preferences and applies them. The cookie wins: where it holds a value, localStorage is brought to match. */
export function applyPreferences() {
  const cookieTheme = readCookie(THEME_NAME, isTheme);
  if (cookieTheme !== null) mirror(THEME_NAME, cookieTheme);
  const cookieAccent = readCookie(ACCENT_NAME, isHue);
  if (cookieAccent !== null) mirror(ACCENT_NAME, cookieAccent);
  applyTheme(resolveTheme());
  applyAccent(resolveAccent());
  notify();
}

function mirror(name, value) {
  try {
    if (localStorage.getItem(name) !== value) localStorage.setItem(name, value);
  } catch {
    // Storage blocked: the page still shows the cookie's value.
  }
}

let stopWatching = null;

/**
 * Applies both preferences now, then again when the tab comes back to the front and when either key
 * changes in another tab or product. Idempotent; returns the stop function.
 */
export function watch() {
  if (stopWatching) return stopWatching;
  const onVisible = () => {
    if (document.visibilityState === 'visible') applyPreferences();
  };
  const onStorage = (event) => {
    if (event.key === null || event.key === THEME_NAME || event.key === ACCENT_NAME) applyPreferences();
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('storage', onStorage);
  stopWatching = () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('storage', onStorage);
    stopWatching = null;
  };
  applyPreferences();
  return stopWatching;
}

// --- Migration ---------------------------------------------------------------

/**
 * Moves a stored Codex accent (c2-user-prefs.accentColor) into the contract, once, then removes it from
 * the prefs object. The contract write lands before the legacy key is deleted, and a stored contract
 * accent wins over the legacy one. If the domain cannot be read, nothing moves and nothing is deleted.
 */
export async function migrateLegacy() {
  let prefs;
  try {
    prefs = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null');
  } catch {
    return;
  }
  if (prefs === null || typeof prefs !== 'object' || !Object.hasOwn(prefs, 'accentColor')) return;
  try {
    await knowDomain();
  } catch {
    return;
  }
  const hue = legacyAccentHue();
  if (hue !== null && storedAccentValue() === null) void setAccent(hue);
  delete prefs.accentColor;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage blocked: the legacy key stays, and the next load tries again.
  }
  applyPreferences();
}

/** Test seam: forget the domain so the next write asks for it again. */
export function __resetSuitePrefs() {
  domainPromise = null;
  domainKnown = false;
  domainValue = null;
}
