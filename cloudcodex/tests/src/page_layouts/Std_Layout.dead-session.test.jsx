/**
 * Cloud Codex - A dead session on a page load goes through the signed-out front door (the D2 fix)
 *
 * The layout trusts a cached signed-in user for the life of the tab, so a session that the server has
 * ended (a sign-out in the other product, a back-channel logout) still renders the page. The first
 * authenticated request then comes back 401 "Invalid or expired session". These tests run the real
 * apiFetch and attemptAutoLogin and stub only the network and the modal, so the whole chain is exercised:
 * the 401, the announcement, the layout's front door, and the once-per-tab bounce guard.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/components/Login.jsx', () => ({ default: () => null }));
vi.mock('../../../src/components/AccountPanel.jsx', () => ({ default: () => null }));
vi.mock('../../../src/components/SearchBox.jsx', () => ({ default: () => null }));
vi.mock('../../../src/components/NotificationBell.jsx', () => ({ default: () => null }));
vi.mock('../../../src/components/FirstRunGate.jsx', () => ({ default: () => null }));

vi.mock('../../../src/util.jsx', async (importOriginal) => ({
  ...(await importOriginal()),
  showModal: vi.fn(),
  standardRedirect: vi.fn(),
}));

import { useEffect, useState } from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { fetchDocument, setSessStorage, showModal } from '../../../src/util.jsx';
import StdLayout from '../../../src/page_layouts/Std_Layout.jsx';
import { SIGN_IN_TARGET_KEY } from '../../../src/hooks/useSignedOutTarget.js';
import { setUnsaved, __resetUnsaved } from '../../../src/lib/unsaved-changes.js';

const USER = { id: 1, name: 'Alice', email: 'alice@example.com' };
const DOC_PATH = '/archives/1/doc/1';
const ONLY_OIDC = { google: false, github: false, local: false, oidc: { enabled: true, name: 'SSO' } };
const OIDC_AND_LOCAL = { google: false, github: false, local: true, oidc: { enabled: true, name: 'SSO' } };

// The Editor's own load, reduced to what matters here: a document request whose failure is shown in place.
function DocumentPage() {
  const [text, setText] = useState('Loading Document...');
  useEffect(() => {
    fetchDocument('1').then(
      () => setText('the document'),
      (e) => setText(e.body?.message ?? 'Error loading document.'),
    );
  }, []);
  return <p>{text}</p>;
}

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

// The server's answers for a page whose session the server has ended.
function serverWith({ providers, suiteOn = false, documentIs401 = true }) {
  return vi.fn((url) => {
    if (url === '/api/suite') return Promise.resolve(json({ enabled: suiteOn, name: 'Example Suite' }));
    if (url === '/api/oauth/providers') return Promise.resolve(json({ success: true, providers }));
    if (url.startsWith('/api/document?')) {
      return Promise.resolve(documentIs401
        ? json({ success: false, message: 'Invalid or expired session' }, 401)
        : json({ success: true, document: { id: 1, title: 'Doc' } }));
    }
    return Promise.resolve(json({ success: true, connected: false, isAdmin: false }));
  });
}

// The browser state of a tab that signed in earlier and whose session has since ended server-side.
function staleTab(path = DOC_PATH) {
  document.cookie = 'sessionToken=stale-token; path=/';
  setSessStorage('currentUser', USER);
  return { fake: { pathname: path, search: '', hash: '', protocol: 'http:', assign: vi.fn() } };
}

function installLocation(fake) {
  delete window.location;
  window.location = fake;
}

const renderPage = () => render(
  <MemoryRouter>
    <StdLayout><DocumentPage /></StdLayout>
  </MemoryRouter>,
);

let realLocation;

beforeEach(() => {
  realLocation = window.location;
  __resetUnsaved();
  window.sessionStorage.clear();
  document.cookie = 'sessionToken=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  showModal.mockClear();
});

afterEach(() => {
  window.location = realLocation;
  vi.unstubAllGlobals();
});

describe('a dead session on a document load, in hosted mode (OIDC is the only sign-in)', () => {
  it('bounces to the OIDC sign-in with the document kept as returnTo, once per tab', async () => {
    const tab = staleTab();
    installLocation(tab.fake);
    vi.stubGlobal('fetch', serverWith({ providers: ONLY_OIDC }));
    renderPage();
    await waitFor(() => expect(tab.fake.assign).toHaveBeenCalledOnce());
    expect(tab.fake.assign).toHaveBeenCalledWith(`/api/auth/oidc/start?returnTo=${encodeURIComponent(DOC_PATH)}`);
    expect(window.sessionStorage.getItem('c2-oidc-bounce')).toBe('1');
    expect(showModal).not.toHaveBeenCalled();
  });

  it('a second visit to the same document, still dead, shows the signed-out landing and does not bounce again', async () => {
    const tab = staleTab();
    installLocation(tab.fake);
    vi.stubGlobal('fetch', serverWith({ providers: ONLY_OIDC }));
    const first = renderPage();
    await waitFor(() => expect(tab.fake.assign).toHaveBeenCalledOnce());
    first.unmount();

    // The bounce's round trip is not modelled: the browser is back on the document with the server's dead session
    // (the cookie is still there, the cached user was forgotten by the first 401) and the marker the first bounce
    // left in this tab. The layout's own check finds no session, and the guard keeps it on the landing.
    renderPage();
    expect(await screen.findByText(/please log in/i)).toBeTruthy();
    expect(tab.fake.assign).toHaveBeenCalledOnce();
    expect(showModal).not.toHaveBeenCalled();
  });

  it('several requests on one page refused as dead send the tab to the sign-in once', async () => {
    const tab = staleTab();
    installLocation(tab.fake);
    vi.stubGlobal('fetch', serverWith({ providers: ONLY_OIDC }));
    render(
      <MemoryRouter>
        <StdLayout><DocumentPage /><DocumentPage /><DocumentPage /></StdLayout>
      </MemoryRouter>,
    );
    await waitFor(() => expect(tab.fake.assign).toHaveBeenCalledOnce());
    expect(screen.getByText(/please log in/i)).toBeTruthy();
    expect(tab.fake.assign).toHaveBeenCalledOnce();
  });
});

describe('a dead session on a document load, with local sign-in offered', () => {
  it('opens the sign-in screen with the document kept as the return target, and does not bounce', async () => {
    const tab = staleTab();
    installLocation(tab.fake);
    vi.stubGlobal('fetch', serverWith({ providers: OIDC_AND_LOCAL }));
    renderPage();
    await waitFor(() => expect(showModal).toHaveBeenCalledOnce());
    expect(tab.fake.assign).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(SIGN_IN_TARGET_KEY)).toBe(DOC_PATH);
    expect(window.sessionStorage.getItem('c2-oidc-bounce')).toBeNull();
  });
});

describe('a live session', () => {
  it('a document load that succeeds renders the page and neither bounces nor opens the sign-in', async () => {
    const tab = staleTab();
    installLocation(tab.fake);
    vi.stubGlobal('fetch', serverWith({ providers: ONLY_OIDC, documentIs401: false }));
    renderPage();
    expect(await screen.findByText('the document')).toBeTruthy();
    expect(tab.fake.assign).not.toHaveBeenCalled();
    expect(showModal).not.toHaveBeenCalled();
  });
});

// ── a dead session with unsaved changes on the page never navigates away (momus item 1) ──

describe('a dead session while the editor holds unsaved changes', () => {
  it('does not navigate, shows the notice, and keeps the page and its content', async () => {
    const tab = staleTab();
    installLocation(tab.fake);
    setUnsaved('editor', true, () => 'my draft');
    vi.stubGlobal('fetch', serverWith({ providers: ONLY_OIDC }));
    renderPage();
    expect(await screen.findByText(/your session ended/i)).toBeTruthy();
    expect(screen.getByText(/your unsaved changes are still here/i)).toBeTruthy();
    expect(screen.getByText('Invalid or expired session')).toBeTruthy(); // the page is still mounted, not unmounted by a bounce
    expect(tab.fake.assign).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem('c2-oidc-bounce')).toBeNull();
    expect(showModal).not.toHaveBeenCalled();
  });

  it('sign in again opens the current page in a new tab, leaving this one as it is', async () => {
    const tab = staleTab();
    installLocation(tab.fake);
    setUnsaved('editor', true, () => 'my draft');
    vi.stubGlobal('fetch', serverWith({ providers: ONLY_OIDC }));
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /sign in again/i }));
    expect(open).toHaveBeenCalledWith(DOC_PATH, '_blank', 'noopener');
    expect(tab.fake.assign).not.toHaveBeenCalled();
    expect(screen.getByText(/your unsaved changes are still here/i)).toBeTruthy();
    open.mockRestore();
  });

  it('copy my changes puts the editor text on the clipboard', async () => {
    const tab = staleTab();
    installLocation(tab.fake);
    setUnsaved('editor', true, () => 'my draft');
    vi.stubGlobal('fetch', serverWith({ providers: ONLY_OIDC }));
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /copy my changes/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('my draft'));
    delete navigator.clipboard;
  });

  it('after a sign-in in another tab, "I have signed in" clears the notice and the page carries on', async () => {
    const tab = staleTab();
    installLocation(tab.fake);
    setUnsaved('editor', true, () => 'my draft');
    const base = serverWith({ providers: ONLY_OIDC });
    vi.stubGlobal('fetch', vi.fn((url, opts) => (url === '/api/validate-session'
      ? Promise.resolve(json({ valid: true, user: USER }))
      : base(url, opts))));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /i have signed in/i }));
    await waitFor(() => expect(screen.queryByText(/your session ended/i)).toBeNull());
    expect(tab.fake.assign).not.toHaveBeenCalled();
  });

  it('a clean page with the same dead session bounces, as before', async () => {
    const tab = staleTab();
    installLocation(tab.fake);
    setUnsaved('editor', false);
    vi.stubGlobal('fetch', serverWith({ providers: ONLY_OIDC }));
    renderPage();
    await waitFor(() => expect(tab.fake.assign).toHaveBeenCalledOnce());
    expect(screen.queryByText(/your session ended/i)).toBeNull();
  });
});

