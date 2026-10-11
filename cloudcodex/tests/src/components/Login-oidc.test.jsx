/**
 * Cloud Codex - the sign-in screen offers OIDC when the server says it is enabled (W6-CDX-5)
 *
 * GET /api/oauth/providers names the OIDC provider and whether it is on. The Login screen shows one
 * "Sign in with <name>" link to /api/auth/oidc/start, beside Google, and nothing when OIDC is off.
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

import { render, screen, waitFor } from '@testing-library/react';
import Login from '../../../src/components/Login.jsx';

function providersResponse(providers) {
  return Promise.resolve({ json: () => Promise.resolve({ success: true, providers }) });
}

describe('Login: the OIDC sign-in button', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('links to the OIDC start route, labelled with the configured name', async () => {
    fetch.mockImplementation(() => providersResponse({ google: false, github: false, oidc: { enabled: true, name: 'Cloud City ID' } }));
    render(<Login />);

    const link = await screen.findByRole('link', { name: 'Sign in with Cloud City ID' });
    expect(link.getAttribute('href')).toBe('/api/auth/oidc/start');
  });

  it('shows no OIDC button when the server reports OIDC off', async () => {
    fetch.mockImplementation(() => providersResponse({ google: false, github: false, oidc: { enabled: false, name: 'SSO' } }));
    render(<Login />);

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/oauth/providers'));
    expect(screen.queryByRole('link', { name: /Sign in with/ })).toBeNull();
  });
});
