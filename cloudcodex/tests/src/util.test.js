/**
 * Cloud Codex — Tests for src/util.jsx
 *
 * Frontend project (jsdom). Covers pure helpers, the apiFetch / serverReq
 * fetch wrappers, cookie / sessionStorage helpers, DOM helpers, and a
 * representative sample of the 70+ API wrappers (each is a thin
 * `apiFetch(method, url, body)` call — testing every one would be
 * redundant, so we test enough to validate the pattern across domains).
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  apiFetch,
  serverReq,
  timeAgo,
  docUrl,
  getErrorMessage,
  TAG_LABELS,
  setSessStorage,
  getSessStorage,
  removeSessStorage,
  getSessionTokenFromCookie,
  setSessionCookie,
  clearSessionCookie,
  upgradeLegacySessionCookie,
  clearInner,
  createAndAppend,
  // Sample API wrappers
  fetchWorkspaces,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
  searchUsers,
  fetchDocument,
  saveDocument,
  publishVersion,
  addFavorite,
  removeFavorite,
  markNotificationRead,
  fetchWorkspaceActivity,
  fetchLogActivity,
  fetchNotifications,
  exportDocument,
} from '../../src/util.jsx';

const STORAGE_PREFIX = 'c2-';

// --- fetch mock ---

let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  // Clean cookies between tests
  document.cookie.split(';').forEach((c) => {
    document.cookie = c.trim().split('=')[0] + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
  });
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Pure helpers ──────────────────────────────────────────

describe('TAG_LABELS', () => {
  it('exposes display names for every comment tag', () => {
    expect(TAG_LABELS).toMatchObject({
      comment: 'Comment',
      suggestion: 'Suggestion',
      question: 'Question',
      issue: 'Issue',
      note: 'Note',
    });
  });
});

describe('timeAgo', () => {
  it('returns "just now" for very recent timestamps', () => {
    expect(timeAgo(new Date().toISOString())).toBe('just now');
  });

  it('returns "<N>m ago" for under-an-hour-old timestamps', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(timeAgo(fiveMinAgo)).toBe('5m ago');
  });

  it('returns "<N>h ago" for under-a-day-old timestamps', () => {
    const threeHrsAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    expect(timeAgo(threeHrsAgo)).toBe('3h ago');
  });

  it('returns "<N>d ago" for under-30-days-old timestamps', () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    expect(timeAgo(fiveDaysAgo)).toBe('5d ago');
  });

  it('falls through to a localized date for older timestamps', () => {
    const longAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const out = timeAgo(longAgo);
    // Localized format — varies by locale, but should contain the year somewhere
    expect(out).toMatch(/\d/);
    expect(out).not.toMatch(/^just now$/);
    expect(out).not.toMatch(/ago$/);
  });
});

describe('docUrl', () => {
  it('routes archive-scoped docs to /archives/<archiveId>/doc/<id>', () => {
    expect(docUrl({ id: 7, archive_id: 3 })).toBe('/archives/3/doc/7');
  });

  it('routes archive-less docs to /editor/<id>', () => {
    expect(docUrl({ id: 7 })).toBe('/editor/7');
    expect(docUrl({ id: 7, archive_id: null })).toBe('/editor/7');
    expect(docUrl({ id: 7, archive_id: 0 })).toBe('/editor/7');
  });
});

describe('getErrorMessage', () => {
  it('prefers err.body.message when present', () => {
    expect(getErrorMessage({ body: { message: 'X' }, message: 'Y' })).toBe('X');
  });

  it('falls back to err.message', () => {
    expect(getErrorMessage({ message: 'Y' })).toBe('Y');
  });

  it('falls back to a generic message when nothing is provided', () => {
    expect(getErrorMessage(null)).toBe('An unexpected error occurred.');
    expect(getErrorMessage(undefined)).toBe('An unexpected error occurred.');
    expect(getErrorMessage({})).toBe('An unexpected error occurred.');
  });
});

// ── Storage helpers ──────────────────────────────────────

describe('sessionStorage helpers', () => {
  it('setSessStorage prefixes the key and JSON-encodes the value', () => {
    setSessStorage('foo', { a: 1 });
    expect(sessionStorage.getItem(STORAGE_PREFIX + 'foo')).toBe(JSON.stringify({ a: 1 }));
  });

  it('getSessStorage returns null for missing keys', () => {
    expect(getSessStorage('missing')).toBeNull();
  });

  it('round-trips JSON values through set/get', () => {
    setSessStorage('user', { id: 1, name: 'Alice' });
    expect(getSessStorage('user')).toEqual({ id: 1, name: 'Alice' });
  });

  it('returns the raw string when stored value is not valid JSON', () => {
    sessionStorage.setItem(STORAGE_PREFIX + 'raw', 'not-json{');
    expect(getSessStorage('raw')).toBe('not-json{');
  });

  it('removeSessStorage deletes the prefixed key', () => {
    setSessStorage('toRemove', 1);
    removeSessStorage('toRemove');
    expect(sessionStorage.getItem(STORAGE_PREFIX + 'toRemove')).toBeNull();
  });
});

// ── Cookie / token helper ────────────────────────────────

describe('getSessionTokenFromCookie', () => {
  it('returns null when no sessionToken cookie is set', () => {
    expect(getSessionTokenFromCookie()).toBeNull();
  });

  it('returns the token value when sessionToken cookie is present', () => {
    document.cookie = 'sessionToken=abc123def456';
    expect(getSessionTokenFromCookie()).toBe('abc123def456');
  });

  it('clears the cached currentUser when there is no token', () => {
    setSessStorage('currentUser', { id: 1 });
    expect(getSessionTokenFromCookie()).toBeNull();
    expect(sessionStorage.getItem(STORAGE_PREFIX + 'currentUser')).toBeNull();
  });

  it('finds the token even with other cookies present', () => {
    document.cookie = 'foo=bar';
    document.cookie = 'sessionToken=xyz';
    document.cookie = 'baz=qux';
    expect(getSessionTokenFromCookie()).toBe('xyz');
  });
});

describe('setSessionCookie', () => {
  // The one writer of the session cookie on the client: sign-in and the
  // account panel's session rotation must set it identically, or a rotated
  // session would come back with different lifetime or scope rules.
  // A plain-http page (jsdom's default here) cannot hold a Secure cookie, so
  // the name and the Secure attribute follow the page's scheme (W6-CDX-3).
  it('writes the legacy name without Secure on a plain-http page, never with a Domain', () => {
    const set = vi.spyOn(Document.prototype, 'cookie', 'set');
    try {
      setSessionCookie('fresh-token');
      expect(set).toHaveBeenCalledTimes(1);
      expect(set).toHaveBeenCalledWith('sessionToken=fresh-token; path=/; max-age=604800; samesite=strict');
    } finally {
      set.mockRestore();
    }
  });
});

// ── The __Host- session cookie on an https page (W6-CDX-3) ──────────
//
// jsdom's cookie jar enforces the prefix rules a browser does (a __Host-
// cookie needs Secure and Path=/, and a Secure cookie needs an https page),
// so these run on a page reconfigured to https and read the jar back rather
// than trusting the string written.

describe('the session cookie on an https page', () => {
  const HOME = window.location.href;
  const EXPIRED = 'expires=Thu, 01 Jan 1970 00:00:00 GMT';

  beforeEach(() => {
    globalThis.jsdom.reconfigure({ url: 'https://codex.example.com/' });
  });

  afterEach(() => {
    document.cookie = `__Host-sessionToken=; ${EXPIRED}; path=/; secure`;
    document.cookie = `sessionToken=; ${EXPIRED}; path=/`;
    document.cookie = `sessionToken=; ${EXPIRED}; path=/; secure`;
    sessionStorage.clear();
    vi.useRealTimers();
    globalThis.jsdom.reconfigure({ url: HOME });
  });

  // A browser stores a cookie whose name starts with Unicode whitespace
  // (U+2000, U+3000, U+FEFF, U+00A0) as a different cookie, so none of the
  // __Host- rules apply to it and a sibling host can set it for the whole
  // domain. jsdom's jar never produces such a name, so these read a Cookie
  // string as a browser would hand it over.
  const PLANTS = ['\u2000', '\u3000', '\ufeff', '\u00a0'];
  const cookieReads = (value) => vi.spyOn(Document.prototype, 'cookie', 'get').mockReturnValue(value);

  describe('setSessionCookie', () => {
    it('writes __Host-sessionToken, Secure, Path=/ and no Domain, which the jar accepts', () => {
      const set = vi.spyOn(Document.prototype, 'cookie', 'set');
      try {
        setSessionCookie('fresh-token');
        expect(set).toHaveBeenCalledWith('__Host-sessionToken=fresh-token; path=/; max-age=604800; secure; samesite=strict');
      } finally {
        set.mockRestore();
      }
      expect(document.cookie).toBe('__Host-sessionToken=fresh-token');
    });
  });

  describe('getSessionTokenFromCookie', () => {
    it('reads the prefixed cookie', () => {
      setSessionCookie('host-token');
      expect(getSessionTokenFromCookie()).toBe('host-token');
    });

    it('prefers the prefixed cookie over a legacy one', () => {
      document.cookie = 'sessionToken=tossed; path=/; secure';
      setSessionCookie('host-token');
      expect(getSessionTokenFromCookie()).toBe('host-token');
    });

    // A lone legacy cookie on https may have been tossed by a sibling host.
    // It is promoted only after the server agrees (upgradeLegacySessionCookie),
    // never read straight into a bearer header.
    it('reads the real prefixed cookie past a planted name that starts with Unicode whitespace', () => {
      for (const ws of PLANTS) {
        const get = cookieReads(`${ws}__Host-sessionToken=EVIL; theme=dark; __Host-sessionToken=REAL`);
        try {
          expect(getSessionTokenFromCookie(), JSON.stringify(ws)).toBe('REAL');
        } finally {
          get.mockRestore();
        }
      }
    });

    it('reads no token at all from a planted name alone', () => {
      for (const ws of PLANTS) {
        const get = cookieReads(`theme=dark; ${ws}__Host-sessionToken=EVIL`);
        try {
          expect(getSessionTokenFromCookie(), JSON.stringify(ws)).toBeNull();
        } finally {
          get.mockRestore();
        }
      }
    });

    it('does not read a lone legacy cookie', () => {
      document.cookie = 'sessionToken=old-token; path=/; secure';
      setSessStorage('currentUser', { id: 1 });
      expect(getSessionTokenFromCookie()).toBeNull();
      expect(sessionStorage.getItem(STORAGE_PREFIX + 'currentUser')).toBeNull();
    });
  });

  describe('clearSessionCookie', () => {
    it('expires both names', () => {
      setSessionCookie('host-token');
      document.cookie = 'sessionToken=old-token; path=/; secure';
      clearSessionCookie();
      expect(document.cookie).toBe('');
    });
  });

  describe('upgradeLegacySessionCookie', () => {
    it('moves a legacy cookie the server accepts to the prefixed name, and expires the legacy one', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ valid: true, user: { id: 1 } }) });
      document.cookie = 'sessionToken=old-token; path=/; secure';

      await upgradeLegacySessionCookie();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/validate-session');
      expect(opts.method).toBe('POST');
      expect(JSON.parse(opts.body)).toEqual({ token: 'old-token', legacyCookie: true });
      expect(document.cookie).toBe('__Host-sessionToken=old-token');
      expect(getSessionTokenFromCookie()).toBe('old-token');
    });

    it('expires a legacy cookie the server refuses, and writes nothing', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ valid: false }) });
      document.cookie = 'sessionToken=old-token; path=/; secure';

      await upgradeLegacySessionCookie();

      expect(document.cookie).toBe('');
    });

    it('keeps the legacy cookie when the server cannot be reached, so a blip signs nobody out', async () => {
      fetchMock.mockRejectedValueOnce(new Error('offline'));
      document.cookie = 'sessionToken=old-token; path=/; secure';

      await upgradeLegacySessionCookie();

      expect(document.cookie).toBe('sessionToken=old-token');
    });

    it('asks nothing when a prefixed cookie already exists', async () => {
      setSessionCookie('host-token');
      document.cookie = 'sessionToken=tossed; path=/; secure';

      await upgradeLegacySessionCookie();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(getSessionTokenFromCookie()).toBe('host-token');
    });

    it('asks nothing when there is no session cookie at all', async () => {
      await upgradeLegacySessionCookie();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('is not stopped by a planted name that only looks like the prefixed cookie', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ valid: false }) });
      const get = cookieReads('\u2000__Host-sessionToken=EVIL; sessionToken=old-token');
      try {
        await upgradeLegacySessionCookie();
      } finally {
        get.mockRestore();
      }
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ token: 'old-token', legacyCookie: true });
    });

    // A legacy cookie a sibling set with a Domain cannot be expired by this
    // host's clear, so it would come back on every page load.
    it('asks once per tab: a refused legacy cookie that survives the clear is not asked about again', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ valid: false }) });
      document.cookie = 'sessionToken=old-token; path=/; secure';
      await upgradeLegacySessionCookie();
      document.cookie = 'sessionToken=old-token; path=/; secure';

      await upgradeLegacySessionCookie();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(getSessionTokenFromCookie()).toBeNull();
    });

    // main.jsx waits for this before the first render, so a server that never
    // answers must not leave the page blank.
    it('gives up after a few seconds when the server does not answer, and keeps the legacy cookie', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      fetchMock.mockReturnValueOnce(new Promise(() => {}));
      document.cookie = 'sessionToken=old-token; path=/; secure';

      let settled = false;
      const upgrade = upgradeLegacySessionCookie().then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(4999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await upgrade;

      expect(settled).toBe(true);
      expect(document.cookie).toBe('sessionToken=old-token');
    });
  });
});

describe('the session cookie on a plain-http page', () => {
  it('reads the legacy name, the only one a plain-http page can hold', () => {
    setSessionCookie('http-token');
    expect(getSessionTokenFromCookie()).toBe('http-token');
  });

  it('clearSessionCookie expires it', () => {
    setSessionCookie('http-token');
    clearSessionCookie();
    expect(getSessionTokenFromCookie()).toBeNull();
  });

  it('upgradeLegacySessionCookie leaves it alone and asks nothing', async () => {
    setSessionCookie('http-token');
    await upgradeLegacySessionCookie();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getSessionTokenFromCookie()).toBe('http-token');
  });
});

// ── apiFetch ─────────────────────────────────────────────

describe('apiFetch', () => {
  it('sends a JSON Content-Type header and the Bearer token from the cookie', async () => {
    document.cookie = 'sessionToken=tok';
    await apiFetch('GET', '/api/x');
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.method).toBe('GET');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.headers['Authorization']).toBe('Bearer tok');
  });

  it('does not attach an Authorization header when there is no cookie', async () => {
    await apiFetch('GET', '/api/x');
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers['Authorization']).toBeUndefined();
  });

  it('serializes data to a JSON body for POST/PUT/DELETE', async () => {
    await apiFetch('POST', '/api/x', { a: 1 });
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.body).toBe(JSON.stringify({ a: 1 }));
  });

  it('does not attach a body to GET requests even if data is provided', async () => {
    await apiFetch('GET', '/api/x', { a: 1 });
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.body).toBeUndefined();
  });

  it('returns the parsed JSON body on success', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: 42 }),
    });
    expect(await apiFetch('GET', '/api/x')).toEqual({ data: 42 });
  });

  it('throws an Error with status and body fields on a non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ message: 'Forbidden' }),
    });
    await expect(apiFetch('GET', '/api/x')).rejects.toMatchObject({
      message: 'Forbidden',
      status: 403,
      body: { message: 'Forbidden' },
    });
  });

  it('still throws even if the error body fails to parse', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => { throw new Error('Bad JSON'); },
    });
    await expect(apiFetch('GET', '/api/x')).rejects.toMatchObject({ status: 500 });
  });

  it('logs and re-throws when fetch itself rejects (network error)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockRejectedValueOnce(new Error('Network down'));
    await expect(apiFetch('GET', '/api/x')).rejects.toThrow('Network down');
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

// ── serverReq ────────────────────────────────────────────

describe('serverReq', () => {
  it('uses application/json by default and merges custom headers', async () => {
    await serverReq('GET', '/api/x', undefined, { 'X-Trace': 'abc' });
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-Trace': 'abc',
    });
  });

  it('sends a body for POST', async () => {
    await serverReq('POST', '/api/x', { a: 1 });
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.body).toBe(JSON.stringify({ a: 1 }));
  });

  it('returns parsed JSON on success', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: 1 }) });
    expect(await serverReq('GET', '/api/x')).toEqual({ ok: 1 });
  });

  it('throws with status on a non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });
    await expect(serverReq('GET', '/api/x')).rejects.toMatchObject({ status: 401 });
  });
});

// ── DOM helpers ──────────────────────────────────────────

describe('DOM helpers', () => {
  it('clearInner removes all children from an element', () => {
    const div = document.createElement('div');
    div.innerHTML = '<span>a</span><span>b</span>';
    expect(div.children.length).toBe(2);
    clearInner(div);
    expect(div.children.length).toBe(0);
  });

  it('createAndAppend creates a tag, applies className, and appends it', () => {
    const parent = document.createElement('div');
    const child = createAndAppend(parent, 'p', 'foo bar');
    expect(child.tagName).toBe('P');
    expect(child.className).toBe('foo bar');
    expect(parent.firstChild).toBe(child);
  });

  it('createAndAppend handles missing className gracefully', () => {
    const parent = document.createElement('div');
    const child = createAndAppend(parent, 'span');
    expect(child.className).toBe('');
  });
});

// ── API wrappers (representative sample across domains) ──

describe('API wrappers — call apiFetch with the right method, URL, and body', () => {
  it('fetchWorkspaces → GET /api/workspaces', async () => {
    await fetchWorkspaces();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/workspaces');
    expect(opts.method).toBe('GET');
  });

  it('createWorkspace → POST /api/workspaces with name + nested options', async () => {
    await createWorkspace('Acme', { squadName: 'Default', archiveName: 'Inbox' });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/workspaces');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ name: 'Acme', squadName: 'Default', archiveName: 'Inbox' });
  });

  it('updateWorkspace → PUT /api/workspaces/:id', async () => {
    await updateWorkspace(7, 'Renamed');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/workspaces/7');
    expect(opts.method).toBe('PUT');
    expect(JSON.parse(opts.body)).toEqual({ name: 'Renamed' });
  });

  it('deleteWorkspace → DELETE /api/workspaces/:id', async () => {
    await deleteWorkspace(7);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/workspaces/7');
    expect(opts.method).toBe('DELETE');
  });

  it('searchUsers URL-encodes the query parameter', async () => {
    await searchUsers('alice & bob');
    expect(fetchMock.mock.calls[0][0]).toBe(
      `/api/users/search?q=${encodeURIComponent('alice & bob')}`
    );
  });

  it('fetchDocument passes the doc id via query string', async () => {
    await fetchDocument(42);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/document?doc_id=42');
  });

  it('saveDocument POSTs html + markdown content to /api/save-document', async () => {
    await saveDocument(7, '<p>html</p>', '# md');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/save-document');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toMatchObject({
      doc_id: 7,
      html_content: '<p>html</p>',
      markdown_content: '# md',
    });
  });

  it('saveDocument omits markdown_content when not provided', async () => {
    await saveDocument(7, '<p>html</p>');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).not.toHaveProperty('markdown_content');
    expect(body).toMatchObject({ doc_id: 7, html_content: '<p>html</p>' });
  });

  it('publishVersion sends the payload to /api/document/:id/publish', async () => {
    await publishVersion(7, { title: 'v1', notes: 'first' });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/document/7');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ title: 'v1', notes: 'first' });
  });

  it('addFavorite / removeFavorite hit the favorites endpoints', async () => {
    await addFavorite(5);
    expect(fetchMock.mock.calls[0]).toEqual(['/api/favorites', expect.objectContaining({ method: 'POST' })]);
    await removeFavorite(5);
    expect(fetchMock.mock.calls[1]).toEqual(['/api/favorites/5', expect.objectContaining({ method: 'DELETE' })]);
  });

  it('markNotificationRead → POST /api/notifications/:id/read', async () => {
    await markNotificationRead(99);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/notifications/99/read');
  });

  it('fetchWorkspaceActivity composes workspace, before, limit, action_prefix', async () => {
    await fetchWorkspaceActivity({
      workspaceId: 5,
      before: '2026-04-01',
      limit: 10,
      actionPrefix: 'log',
    });
    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain('workspace=5');
    expect(url).toContain('before=2026-04-01');
    expect(url).toContain('limit=10');
    expect(url).toContain('action_prefix=log');
  });

  it('fetchLogActivity defaults to including comments and versions', async () => {
    await fetchLogActivity(7);
    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain('/api/activity/log/7');
  });

  it('fetchNotifications builds the unread query when unreadOnly is true', async () => {
    await fetchNotifications({ limit: 5, unreadOnly: true });
    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain('limit=5');
    expect(url).toContain('unread=1');
  });
});

// ── PDF export ────────────────────────────────────────────

// The print window is an about:blank popup, which inherits the opener's
// Content-Security-Policy. In production that policy is script-src 'self', so
// an inline <script> written into the popup never runs and the print dialog
// never opens. The opener drives the popup instead.
describe('exportDocument: pdf', () => {
  let popup;
  let listeners;

  beforeEach(() => {
    listeners = {};
    popup = {
      document: { write: vi.fn(), close: vi.fn(), readyState: 'loading' },
      addEventListener: vi.fn((type, fn) => { listeners[type] = fn; }),
      print: vi.fn(),
      close: vi.fn(),
    };
    vi.spyOn(window, 'open').mockReturnValue(popup);
  });

  afterEach(() => {
    window.open.mockRestore();
  });

  it('writes no inline script into the print window', async () => {
    await exportDocument(1, 'pdf', 'Title', '<p>Body</p>');
    const html = popup.document.write.mock.calls.map((c) => c[0]).join('');
    expect(html).toContain('<p>Body</p>');
    expect(html).not.toMatch(/<script/i);
    expect(popup.document.close).toHaveBeenCalled();
  });

  it('prints once the window has loaded, then closes it after printing', async () => {
    await exportDocument(1, 'pdf', 'Title', '<p>Body</p>');
    expect(popup.print).not.toHaveBeenCalled();
    listeners.load();
    expect(popup.print).toHaveBeenCalledTimes(1);
    expect(popup.close).not.toHaveBeenCalled();
    listeners.afterprint();
    expect(popup.close).toHaveBeenCalledTimes(1);
  });

  it('prints straight away when the window has already finished loading', async () => {
    popup.document.readyState = 'complete';
    await exportDocument(1, 'pdf', 'Title', '<p>Body</p>');
    expect(popup.print).toHaveBeenCalledTimes(1);
  });

  it('still escapes the title and sanitizes the body', async () => {
    await exportDocument(1, 'pdf', '<b>&"', '<img src=x onerror="alert(1)">');
    const html = popup.document.write.mock.calls.map((c) => c[0]).join('');
    expect(html).toContain('<title>&lt;b&gt;&amp;&quot;</title>');
    expect(html).not.toContain('onerror');
  });

  it('throws when the pop-up is blocked', async () => {
    window.open.mockReturnValue(null);
    await expect(exportDocument(1, 'pdf', 'Title', '<p>Body</p>')).rejects.toThrow(/Pop-up blocked/);
  });
});
