/**
 * Cloud Codex - the two-factor panel says who manages sign-in for an OIDC-linked account (W6-CDX-5)
 *
 * GET /api/2fa/status reports managed_by 'oidc' for an OIDC session. The panel then says, in plain
 * words, that sign-in is managed by the configured sign-in provider (OIDC_PROVIDER_NAME, read from
 * GET /api/oauth/providers) and that the two-factor set here applies only to password sign-in. Local
 * two-factor stays available: it still guards password sign-in.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { utilMock } = vi.hoisted(() => ({
  utilMock: {
    apiFetch: vi.fn(),
    getSessStorage: vi.fn(),
    getSessionTokenFromCookie: vi.fn(),
    setSessionCookie: vi.fn(),
  },
}));

vi.mock('../../../src/util.jsx', () => utilMock);

import { render, screen, waitFor } from '@testing-library/react';
import { apiFetch } from '../../../src/util.jsx';
import { AccountPreferencesPanel } from '../../../src/components/AccountMenu.jsx';

const MANAGED = /Sign-in to this account is managed by Example ID\. Two-factor set here applies only when you sign in with a password\./;

function providersResponse(oidc) {
  return Promise.resolve({ json: () => Promise.resolve({ success: true, providers: { google: false, github: false, oidc } }) });
}

describe('AccountPreferencesPanel, for an OIDC-linked account', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('says sign-in is managed by the configured provider, and keeps local two-factor available', async () => {
    apiFetch.mockResolvedValue({ success: true, method: 'none', managed_by: 'oidc' });
    fetch.mockImplementation(() => providersResponse({ enabled: true, name: 'Example ID' }));

    render(<AccountPreferencesPanel />);

    expect(await screen.findByText(MANAGED)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /authenticator app/i })).toBeEnabled();
    expect(screen.getByRole('radio', { name: /email/i })).toBeEnabled();
  });

  it('does not lock the two-factor panel for a managed_by answer the server no longer sends (CDX-SA-2)', async () => {
    apiFetch.mockResolvedValue({ success: true, method: 'none', managed_by: 'issuer' });
    fetch.mockImplementation(() => providersResponse({ enabled: true, name: 'Example ID' }));

    render(<AccountPreferencesPanel />);

    expect(await screen.findByRole('radio', { name: /authenticator app/i })).toBeEnabled();
    expect(screen.queryByText(/managed by/i)).not.toBeInTheDocument();
  });

  it('falls back to SSO when the provider reports no name', async () => {
    apiFetch.mockResolvedValue({ success: true, method: 'none', managed_by: 'oidc' });
    fetch.mockImplementation(() => providersResponse({ enabled: true, name: undefined }));

    render(<AccountPreferencesPanel />);

    expect(await screen.findByText(/Sign-in to this account is managed by SSO\./)).toBeInTheDocument();
  });

  it('says nothing about a provider for a local or Google account', async () => {
    apiFetch.mockResolvedValue({ success: true, method: 'none', managed_by: null });
    fetch.mockImplementation(() => providersResponse({ enabled: true, name: 'Example ID' }));

    render(<AccountPreferencesPanel />);

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('GET', '/api/2fa/status'));
    expect(screen.queryByText(/is managed by/)).toBeNull();
  });
});
