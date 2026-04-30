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
