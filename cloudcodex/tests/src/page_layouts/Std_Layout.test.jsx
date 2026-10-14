/**
 * Cloud Codex - Tests for the standard layout's GitHub status request
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/util.jsx', () => ({
  apiFetch: vi.fn(),
  showModal: vi.fn(),
  showDropdownMenu: vi.fn(),
  standardRedirect: vi.fn(),
  getSessionTokenFromCookie: vi.fn(),
  attemptAutoLogin: vi.fn(),
  fetchAdminStatus: vi.fn(),
  validateInviteToken: vi.fn(),
}));

// The layout's children are out of scope here; each would make requests of its own.
vi.mock('../../../src/components/Login.jsx', () => ({ default: () => null }));
vi.mock('../../../src/components/FirstRunGate.jsx', () => ({ default: () => null }));

import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  apiFetch,
  getSessionTokenFromCookie,
  attemptAutoLogin,
  fetchAdminStatus,
} from '../../../src/util.jsx';
import StdLayout from '../../../src/page_layouts/Std_Layout.jsx';
import { __resetSuiteCache } from '../../../src/hooks/useSuite.js';
import { showModal, standardRedirect, getSessionTokenFromCookie as cookieToken } from '../../../src/util.jsx';

const USER = { id: 1, name: 'Alice', email: 'alice@example.com' };

const renderLayout = () => render(
  <MemoryRouter>
    <StdLayout><p>page body</p></StdLayout>
  </MemoryRouter>,
);

const statusCalls = () => apiFetch.mock.calls.filter(([, url]) => url === '/api/github/status');

beforeEach(() => {
  vi.clearAllMocks();
  apiFetch.mockResolvedValue({ connected: true });
  fetchAdminStatus.mockResolvedValue({ isAdmin: false });
});

describe('Std_Layout and /api/github/status', () => {
  // /api/github/status is behind requireAuth, so asking it for a signed-out
  // visitor is a 401 in the console of every landing page view.
  it('does not ask for a signed-out visitor', async () => {
    getSessionTokenFromCookie.mockReturnValue(null);
    renderLayout();
    await screen.findByText(/please log in/i);
    expect(statusCalls()).toEqual([]);
  });

  it('does not ask when the session cookie no longer signs anyone in', async () => {
    getSessionTokenFromCookie.mockReturnValue('stale-token');
    attemptAutoLogin.mockResolvedValue(null);
    renderLayout();
    await screen.findByText(/please log in/i);
    expect(statusCalls()).toEqual([]);
  });

  it('asks once for a signed-in user, and shows the GitHub link when one is linked', async () => {
    getSessionTokenFromCookie.mockReturnValue('token');
    attemptAutoLogin.mockResolvedValue(USER);
    renderLayout();
    await screen.findByText('page body');
    await waitFor(() => expect(statusCalls()).toEqual([['GET', '/api/github/status']]));
    expect(screen.getAllByRole('link', { name: /github/i }).length).toBeGreaterThan(0);
  });

  it('hides the GitHub link from a signed-in user with no account linked', async () => {
    getSessionTokenFromCookie.mockReturnValue('token');
    attemptAutoLogin.mockResolvedValue(USER);
    apiFetch.mockResolvedValue({ connected: false });
    renderLayout();
    await screen.findByText('page body');
    await waitFor(() => expect(screen.queryAllByRole('link', { name: /github/i })).toEqual([]));
    expect(screen.getAllByRole('link', { name: /home/i }).length).toBeGreaterThan(0);
  });
});

describe('Std_Layout, the signed-out front door (W6-CDX-26)', () => {
  const ONLY_OIDC = { google: false, github: false, local: false, oidc: { enabled: true, name: 'SSO' } };
  const LOCAL_ONLY = { google: false, github: false, local: true, oidc: { enabled: false, name: 'SSO' } };
  const OIDC_AND_LOCAL = { google: false, github: false, local: true, oidc: { enabled: true, name: 'SSO' } };

  function stubWorld({ suiteOn, providers }) {
    apiFetch.mockImplementation((method, url) => Promise.resolve(
      url === '/api/suite' ? { enabled: suiteOn, name: 'Example Suite' } : { connected: false },
    ));
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      json: () => Promise.resolve({ success: true, providers }),
    })));
  }

  beforeEach(() => {
    __resetSuiteCache();
    window.sessionStorage.clear();
    cookieToken.mockReturnValue(null);
    showModal.mockClear();
    standardRedirect.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, '', '/');
  });

  it('shows no signed-out sentence, and the welcome as before', async () => {
    stubWorld({ suiteOn: false, providers: ONLY_OIDC });
    window.history.replaceState({}, '', '/?signedOut=1');
    renderLayout();
    await screen.findByText(/please log in/i);
    expect(screen.queryByText(/signed out of/i)).toBeNull();
  });

  it('opens the Login modal on a deep link when no OIDC is offered, and keeps the target', async () => {
    stubWorld({ suiteOn: false, providers: LOCAL_ONLY });
    window.history.replaceState({}, '', '/doc/9');
    renderLayout();
    await waitFor(() => expect(showModal).toHaveBeenCalledOnce());
    expect(standardRedirect).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem('c2-sign-in-target')).toBe('/doc/9');
  });

  it('opens the modal, and does not redirect to "/", on a deep link with OIDC beside local login', async () => {
    stubWorld({ suiteOn: false, providers: OIDC_AND_LOCAL });
    window.history.replaceState({}, '', '/doc/9');
    renderLayout();
    await waitFor(() => expect(showModal).toHaveBeenCalledOnce());
    expect(standardRedirect).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem('c2-sign-in-target')).toBe('/doc/9');
  });

  it('sends a deep link on an OIDC-only instance to the sign-in, not to the modal or the root', async () => {
    stubWorld({ suiteOn: false, providers: ONLY_OIDC });
    window.history.replaceState({}, '', '/doc/9');
    renderLayout();
    await waitFor(() => expect(window.sessionStorage.getItem('c2-oidc-bounce')).toBe('1'));
    expect(showModal).not.toHaveBeenCalled();
    expect(standardRedirect).not.toHaveBeenCalled();
  });
});
