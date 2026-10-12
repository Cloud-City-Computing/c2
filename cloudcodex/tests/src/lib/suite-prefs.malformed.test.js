/**
 * Cloud Codex - a malformed GET /api/suite holds every preference write (W6-CDX-44)
 *
 * The real useSuite and suite-prefs run here, with only apiFetch mocked. A 200 body without
 * preferenceDomain must write no cookie and no localStorage, while the page still shows the choice.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/util.jsx', () => ({ apiFetch: vi.fn() }));

import { apiFetch } from '../../../src/util.jsx';
import * as prefs from '../../../src/lib/suite-prefs.js';
import { __resetSuiteCache } from '../../../src/hooks/useSuite.js';

let writes;

beforeEach(async () => {
  localStorage.clear();
  writes = [];
  let jar = '';
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => jar,
    set: (raw) => {
      writes.push(raw);
      jar = raw;
    },
  });
  vi.stubGlobal('location', { hostname: 'codex.example.com', protocol: 'https:', href: 'https://codex.example.com/' });
  document.documentElement.setAttribute('data-theme', 'dark');
  apiFetch.mockReset();
  __resetSuiteCache();
  prefs.__resetSuitePrefs();
});

afterEach(() => {
  delete document.cookie;
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('a malformed /api/suite answer', () => {
  it('writes no cookie and no localStorage for a 200 body without preferenceDomain', async () => {
    apiFetch.mockResolvedValue({ enabled: true, name: 'Example Suite' });
    await prefs.setTheme('light');
    expect(writes).toEqual([]);
    expect(localStorage.getItem('cc_suite_theme')).toBeNull();
    // The page still shows the choice made in it; only the stores wait.
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('writes nothing for the accent either, and a later valid answer releases a later write', async () => {
    apiFetch.mockResolvedValueOnce({ enabled: true, name: 'Example Suite' });
    await prefs.setAccent(232);
    expect(writes).toEqual([]);
    apiFetch.mockResolvedValueOnce({ enabled: true, name: 'Example Suite', preferenceDomain: 'example.com' });
    await prefs.setAccent(355);
    expect(writes[0]).toBe('cc_suite_accent=355; Path=/; Max-Age=34560000; SameSite=Lax; Secure; Domain=example.com');
    expect(localStorage.getItem('cc_suite_accent')).toBe('355');
  });
});
