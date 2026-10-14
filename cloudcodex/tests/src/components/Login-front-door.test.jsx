/**
 * Cloud Codex - the sign-in modal's markup (W6-CDX-26)
 *
 * The modal's markup is the same as before the suite was removed (a snapshot taken on the component).
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
import Login from '../../../src/components/Login.jsx';

const OIDC_ON = { google: false, github: false, local: true, oidc: { enabled: true, name: 'SSO' } };
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

describe('Login: the markup is unchanged', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
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
