/**
 * Cloud Codex - the body-to-domain mapping of GET /api/suite, and what a malformed answer does (W6-CDX-44)
 *
 * A write waits for suitePreferenceDomain(). A body that does not carry preferenceDomain as null or a
 * string must hold the write, never read as "no domain" (which would write host-only). A malformed
 * answer is not cached for the page's life: the next asker asks again.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/util.jsx', () => ({ apiFetch: vi.fn() }));

import { apiFetch } from '../../../src/util.jsx';
import { suitePreferenceDomain, __resetSuiteCache } from '../../../src/hooks/useSuite.js';

beforeEach(() => {
  vi.clearAllMocks();
  __resetSuiteCache();
});

describe('suitePreferenceDomain: the body-to-domain mapping', () => {
  it('returns the domain string the body carries', async () => {
    apiFetch.mockResolvedValue({ enabled: true, name: 'Example Suite', preferenceDomain: 'example.com' });
    await expect(suitePreferenceDomain()).resolves.toBe('example.com');
  });

  it('returns null when the body carries null (suite mode off, or the variable unset)', async () => {
    apiFetch.mockResolvedValue({ enabled: false, name: null, preferenceDomain: null });
    await expect(suitePreferenceDomain()).resolves.toBeNull();
  });

  it('rejects a 200 body without the key, so the write is held and no cookie is written', async () => {
    apiFetch.mockResolvedValue({ enabled: true, name: 'Example Suite' });
    await expect(suitePreferenceDomain()).rejects.toThrow(/preferenceDomain/);
  });

  it.each([
    ['a number', 42],
    ['a boolean', true],
    ['an object', { domain: 'example.com' }],
    ['an empty body', null],
    ['undefined', undefined],
  ])('rejects a preferenceDomain that is %s', async (_label, value) => {
    apiFetch.mockResolvedValue(value === null ? null : { enabled: true, preferenceDomain: value });
    await expect(suitePreferenceDomain()).rejects.toThrow(/preferenceDomain/);
  });

  it('does not keep a malformed answer: the next call asks the server again and maps the good answer', async () => {
    apiFetch.mockResolvedValueOnce({ enabled: true, name: 'Example Suite' });
    await expect(suitePreferenceDomain()).rejects.toThrow();
    apiFetch.mockResolvedValueOnce({ enabled: true, name: 'Example Suite', preferenceDomain: 'example.com' });
    await expect(suitePreferenceDomain()).resolves.toBe('example.com');
    expect(apiFetch.mock.calls.map(([, url]) => url)).toEqual(['/api/suite', '/api/suite']);
  });

  it('does not keep a rejected request either', async () => {
    apiFetch.mockRejectedValueOnce(new Error('offline'));
    await expect(suitePreferenceDomain()).rejects.toThrow('offline');
    apiFetch.mockResolvedValueOnce({ preferenceDomain: null });
    await expect(suitePreferenceDomain()).resolves.toBeNull();
  });
});
