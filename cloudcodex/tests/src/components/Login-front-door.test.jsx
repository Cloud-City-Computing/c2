/**
 * Cloud Codex - the sign-in modal as the suite's front door (W6-CDX-26)
 *
 * Suite mode off, the modal's markup is the same as before this session (a snapshot taken on the
 * unchanged component). Suite mode on, the OIDC sign-in is the primary action, labelled with the name
 * the providers route answers (the suite's name unless OIDC_PROVIDER_NAME is set), and local login is
 * the secondary one below it.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/util.jsx', () => ({
  destroyModal: vi.fn(),
  serverReq: vi.fn(),
  setSessionCookie: vi.fn(),
  apiFetch: vi.fn(),
}));

import { act, render, screen, waitFor } from '@testing-library/react';
import { apiFetch } from '../../../src/util.jsx';
import { __resetSuiteCache } from '../../../src/hooks/useSuite.js';
import Login from '../../../src/components/Login.jsx';

const OIDC_ON = { google: false, github: false, local: true, oidc: { enabled: true, name: 'SSO' } };
const OIDC_NAMED = { google: false, github: false, local: true, oidc: { enabled: true, name: 'Example Suite' } };
const ALL_OFF = { google: false, github: false, local: true, oidc: { enabled: false, name: 'SSO' } };

function providersAnswer(providers) {
  return Promise.resolve({ json: () => Promise.resolve({ success: true, providers }) });
}

function stubProviders(providers) {
  fetch.mockImplementation(() => providersAnswer(providers));
}

/** The modal's submit: the Login button that is not the Login tab. */
function submitButton() {
  return screen.getAllByRole('button', { name: 'Login' }).find((b) => b.classList.contains('stretched-button'));
}

function suiteAnswer(enabled) {
  apiFetch.mockImplementation((method, url) => Promise.resolve(
    url === '/api/suite' ? { enabled, name: enabled ? 'Example Suite' : null } : {},
  ));
}

describe('Login, suite mode off: the markup is unchanged', () => {
  beforeEach(() => {
    __resetSuiteCache();
    vi.stubGlobal('fetch', vi.fn());
    suiteAnswer(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the login tab with OIDC offered beside local login, as before', async () => {
    stubProviders(OIDC_ON);
    const { container } = render(<Login />);
    await screen.findByRole('link', { name: 'Sign in with SSO' });
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('renders the login tab with no OIDC and no Google, as before', async () => {
    stubProviders(ALL_OFF);
    const { container } = render(<Login />);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/oauth/providers'));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(container.innerHTML).toMatchSnapshot();
  });
});

describe('Login, suite mode on: OIDC is the primary action and local login is secondary', () => {
  beforeEach(() => {
    __resetSuiteCache();
    vi.stubGlobal('fetch', vi.fn());
    suiteAnswer(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('labels the OIDC link with the name the providers route answers, as a primary button', async () => {
    stubProviders(OIDC_NAMED);
    render(<Login />);
    const link = await screen.findByRole('link', { name: 'Sign in with Example Suite' });
    expect(link.getAttribute('href')).toBe('/api/auth/oidc/start');
    expect(link.className).toContain('btn-primary');
  });

  it('puts the OIDC link before the local username field, and the local submit after it as ghost', async () => {
    stubProviders(OIDC_NAMED);
    const { container } = render(<Login />);
    const link = await screen.findByRole('link', { name: 'Sign in with Example Suite' });
    const username = container.querySelector('#username');
    expect(link.compareDocumentPosition(username) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const submit = submitButton();
    expect(submit.className).toContain('btn-ghost');
    expect(submit.className).not.toContain('btn-primary');
  });

  it('keeps the local login primary when OIDC is not offered', async () => {
    stubProviders(ALL_OFF);
    render(<Login />);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/oauth/providers'));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(submitButton().className).toContain('btn-primary');
  });
});
