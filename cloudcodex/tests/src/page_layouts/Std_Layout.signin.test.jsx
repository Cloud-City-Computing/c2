/**
 * Cloud Codex - The signed-out landing has a sign-in control (W6-CDX-40 review, item 1)
 *
 * On a local-login instance the control opens the Login modal. Where OIDC is the only sign-in it starts the OIDC
 * flow, as the front door does. The landing after a sign-out (/?signedOut=1) shows it on both kinds of instance.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/util.jsx', () => ({
  apiFetch: vi.fn(),
  showModal: vi.fn(),
  standardRedirect: vi.fn(),
  getSessionTokenFromCookie: vi.fn(() => null),
  attemptAutoLogin: vi.fn(),
  fetchAdminStatus: vi.fn(),
  validateInviteToken: vi.fn(),
  removeSessStorage: vi.fn(),
  clearSessionCookie: vi.fn(),
}));
vi.mock('../../../src/components/Login.jsx', () => ({ default: () => null }));
vi.mock('../../../src/components/FirstRunGate.jsx', () => ({ default: () => null }));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { apiFetch, showModal } from '../../../src/util.jsx';
import StdLayout from '../../../src/page_layouts/Std_Layout.jsx';
import { __resetSuiteCache } from '../../../src/hooks/useSuite.js';
import { clearOidcBounce } from '../../../src/hooks/useSignedOutTarget.js';

const ONLY_OIDC = { google: false, github: false, local: false, oidc: { enabled: true, name: 'SSO' } };
const LOCAL_ONLY = { google: false, github: false, local: true, oidc: { enabled: false, name: 'SSO' } };
const START = '/api/auth/oidc/start?returnTo=%2F';

const realLocation = window.location;
let location;

function world({ providers, suiteOn = false }) {
  apiFetch.mockImplementation((method, url) => Promise.resolve(
    url === '/api/suite' ? { enabled: suiteOn, name: 'Example Suite' } : { connected: false },
  ));
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    json: () => Promise.resolve({ success: true, providers }),
  })));
}

function landingAt(search) {
  location.search = search;
  location.href = `http://localhost:3000/${search}`;
  return render(<MemoryRouter><StdLayout><p>page body</p></StdLayout></MemoryRouter>);
}

beforeEach(() => {
  __resetSuiteCache();
  clearOidcBounce();
  window.sessionStorage.clear();
  showModal.mockClear();
  location = { href: 'http://localhost:3000/', pathname: '/', search: '', hash: '', assign: vi.fn() };
  Object.defineProperty(window, 'location', { value: location, writable: true, configurable: true });
});

afterEach(() => {
  Object.defineProperty(window, 'location', { value: realLocation, writable: true, configurable: true });
  vi.unstubAllGlobals();
});

describe('the signed-out landing offers a sign-in', () => {
  it('on a local-login instance, the Sign in button opens the Login modal', async () => {
    world({ providers: LOCAL_ONLY });
    landingAt('?signedOut=1');
    const button = await screen.findByRole('button', { name: 'Sign in' });
    fireEvent.click(button);
    await waitFor(() => expect(showModal).toHaveBeenCalledOnce());
    expect(location.assign).not.toHaveBeenCalled();
  });

  it('where OIDC is the only sign-in, the Sign in button starts the OIDC flow with the root as its return', async () => {
    world({ providers: ONLY_OIDC });
    landingAt('?signedOut=1');
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(location.assign).toHaveBeenCalledWith(START));
    expect(showModal).not.toHaveBeenCalled();
  });

  it('shows the Sign in button on the landing after a sign-out in suite mode too', async () => {
    world({ providers: ONLY_OIDC, suiteOn: true });
    landingAt('?signedOut=1');
    expect(await screen.findByText("You're signed out of Example Suite.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('falls back to the Login modal when the providers answer cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    apiFetch.mockImplementation(() => Promise.resolve({ enabled: false }));
    landingAt('?signedOut=1');
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledOnce());
    expect(location.assign).not.toHaveBeenCalled();
  });
});
