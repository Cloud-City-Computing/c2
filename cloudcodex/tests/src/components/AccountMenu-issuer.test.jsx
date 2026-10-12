/**
 * Cloud Codex - an account the issuer manages reads read-only in suite mode (W6-CDX-42, K6)
 *
 * GET /api/2fa/status says managed_by 'issuer' for an account with a user_identities row in suite mode. The
 * name, email, password and two-factor panels then render as text, with no field to edit and no submit, each
 * with "Managed by " plus the provider name (GET /api/oauth/providers) and a link to the configured account page
 * (oidc.accountUrl), and no link when that is unset. With suite mode off the same account stays editable.
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
    uploadAvatar: vi.fn(),
  },
}));

vi.mock('../../../src/util.jsx', () => utilMock);

import { render, screen, waitFor } from '@testing-library/react';
import { apiFetch, getSessStorage } from '../../../src/util.jsx';
import { AccountInfoUpdatePanel, AccountPreferencesPanel } from '../../../src/components/AccountMenu.jsx';

const ACCOUNT_URL = 'https://id.example.test/ui/console/users/me';

const USER = { id: 7, name: 'Ada Lovelace', email: 'ada@example.test' };

/** GET /api/oauth/providers, through the global fetch the panels use. */
function stubProviders(oidc) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    json: () => Promise.resolve({ success: true, providers: { google: false, github: false, oidc } }),
  })));
}

/** The account's answers. `managedBy` is what /api/2fa/status reports. */
function stubAccount({ managedBy = null, method = 'none' } = {}) {
  apiFetch.mockImplementation((verb, url) => {
    if (url === '/api/get-user') return Promise.resolve({ success: true, user: { ...USER } });
    if (url === '/api/oauth/status') return Promise.resolve({ success: true, hasPassword: true });
    if (url === '/api/2fa/status') return Promise.resolve({ success: true, method, enabled: method !== 'none', managed_by: managedBy });
    return Promise.resolve({});
  });
}

describe('AccountInfoUpdatePanel, an issuer-managed account in suite mode', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    getSessStorage.mockReturnValue({ id: USER.id });
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders name, email and password read-only, with no field to edit and no submit', async () => {
    stubAccount({ managedBy: 'issuer' });
    stubProviders({ enabled: true, name: 'Cloud City ID', accountUrl: ACCOUNT_URL });

    render(<AccountInfoUpdatePanel />);

    expect(await screen.findByText(USER.name)).toBeInTheDocument();
    expect(screen.getByText(USER.email)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /update info/i })).toBeNull();
    expect(screen.queryByLabelText(/^name$/i)).toBeNull();
    expect(screen.queryByLabelText(/^email$/i)).toBeNull();
  });

  it('says each field is managed by the provider, and links the configured account page', async () => {
    stubAccount({ managedBy: 'issuer' });
    stubProviders({ enabled: true, name: 'Cloud City ID', accountUrl: ACCOUNT_URL });

    render(<AccountInfoUpdatePanel />);

    await waitFor(() => expect(screen.getAllByText('Managed by Cloud City ID').length).toBe(3));
    const link = screen.getAllByRole('link', { name: /cloud city id/i })[0];
    expect(link).toHaveAttribute('href', ACCOUNT_URL);
  });

  it('shows no link when the account page is not configured', async () => {
    stubAccount({ managedBy: 'issuer' });
    stubProviders({ enabled: true, name: 'Cloud City ID', accountUrl: null });

    render(<AccountInfoUpdatePanel />);

    await waitFor(() => expect(screen.getAllByText('Managed by Cloud City ID').length).toBe(3));
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('stays editable with suite mode off (no managed_by from the server)', async () => {
    stubAccount({ managedBy: null });
    stubProviders({ enabled: false, name: 'SSO', accountUrl: null });

    render(<AccountInfoUpdatePanel />);

    expect(await screen.findByLabelText(/^name$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^email$/i)).toBeEnabled();
    expect(screen.getByRole('button', { name: /update info/i })).toBeInTheDocument();
    expect(screen.queryByText(/managed by/i)).toBeNull();
  });
});

describe('AccountPreferencesPanel, an issuer-managed account in suite mode', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders two-factor read-only: no radio, the current method as text, and the account link', async () => {
    stubAccount({ managedBy: 'issuer', method: 'totp' });
    stubProviders({ enabled: true, name: 'Cloud City ID', accountUrl: ACCOUNT_URL });

    render(<AccountPreferencesPanel />);

    expect(await screen.findByText('Managed by Cloud City ID')).toBeInTheDocument();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.getByText('Authenticator app')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /cloud city id/i })).toHaveAttribute('href', ACCOUNT_URL);
  });

  it('keeps the radio choices for an issuer-linked account with suite mode off', async () => {
    stubAccount({ managedBy: null, method: 'none' });
    stubProviders({ enabled: false, name: 'SSO', accountUrl: null });

    render(<AccountPreferencesPanel />);

    expect(await screen.findAllByRole('radio')).toHaveLength(3);
    expect(screen.queryByText(/managed by/i)).toBeNull();
  });
});
