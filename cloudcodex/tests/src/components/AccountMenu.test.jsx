/**
 * Cloud Codex — Tests for src/components/AccountMenu.jsx
 *
 * Two scopes. The TOTP setup rendering branch added for mail-off instances
 * (task 6b): the QR image and secret render inline when the enable response
 * carries them, and the section renders exactly as before when it doesn't.
 * This file does not attempt to cover the rest of AccountPreferencesPanel.
 *
 * And AccountInfoUpdatePanel: a name change sends nothing extra, an email
 * change asks for the current password (or, on an account with no password,
 * takes the emailed code), the server's refusal copy is shown as sent, and a
 * rotated session token is stored the way sign-in stores it.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

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
import userEvent from '@testing-library/user-event';
import { apiFetch, getSessStorage, getSessionTokenFromCookie, setSessionCookie } from '../../../src/util.jsx';
import { AccountPreferencesPanel, AccountInfoUpdatePanel } from '../../../src/components/AccountMenu.jsx';

beforeEach(() => {
  apiFetch.mockReset();
  setSessionCookie.mockReset();
  getSessStorage.mockReset();
  getSessionTokenFromCookie.mockReset();
});

async function renderAndStartTotpSetup(enableResponse) {
  apiFetch.mockImplementation((methodVerb, url) => {
    if (url === '/api/2fa/status') return Promise.resolve({ success: true, method: 'none' });
    if (url === '/api/2fa/enable') return Promise.resolve(enableResponse);
    return Promise.resolve({});
  });

  const user = userEvent.setup();
  render(<AccountPreferencesPanel />);

  await waitFor(() => expect(screen.getByRole('radio', { name: /authenticator app/i })).toBeInTheDocument());
  await user.click(screen.getByRole('radio', { name: /authenticator app/i }));

  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('POST', '/api/2fa/enable', { method: 'totp' }));
}

describe('AccountPreferencesPanel — TOTP setup rendering', () => {
  it('renders the QR code and secret when the enable response carries them (mail disabled)', async () => {
    await renderAndStartTotpSetup({
      success: true,
      message: 'Scan the QR code shown on screen with your authenticator app, then enter the code below to complete setup.',
      setupToken: 'setup-token-123',
      qr_data_url: 'data:image/png;base64,abc123',
      secret: 'JBSWY3DPEHPK3PXP',
    });

    const qr = await screen.findByAltText(/totp qr code/i);
    expect(qr).toHaveAttribute('src', 'data:image/png;base64,abc123');
    expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
  });

  it('does not render a QR image or secret when the enable response omits them (mail enabled)', async () => {
    await renderAndStartTotpSetup({
      success: true,
      message: 'A QR code has been sent to your email. Scan it with your authenticator app, then enter the code below to complete setup.',
      setupToken: 'setup-token-456',
    });

    await screen.findByText(/check your email for the qr code/i);
    expect(screen.queryByAltText(/totp qr code/i)).not.toBeInTheDocument();
    expect(screen.queryByText('JBSWY3DPEHPK3PXP')).not.toBeInTheDocument();
  });
});

describe('AccountInfoUpdatePanel', () => {
  const ORIGINAL = { id: 1, name: 'testuser', email: 'test@example.com' };

  /** The server the panel talks to; `routes` answers by URL, each may throw. */
  function serve({ hasPassword = true, routes = {} } = {}) {
    getSessStorage.mockImplementation((key) => (key === 'currentUser' ? { id: 1 } : null));
    getSessionTokenFromCookie.mockReturnValue('caller-token');
    apiFetch.mockImplementation(async (method, url, body) => {
      if (url === '/api/get-user') return { success: true, user: ORIGINAL };
      if (url === '/api/oauth/status') return { success: true, accounts: [], hasPassword };
      if (routes[url]) return routes[url](body);
      throw new Error(`unexpected ${method} ${url}`);
    });
  }

  const refusal = (status, message) => () => {
    throw Object.assign(new Error(message), { status, body: { success: false, message } });
  };

  const updateCalls = () => apiFetch.mock.calls.filter(([, url]) => url === '/api/update-account');

  async function renderPanel() {
    const user = userEvent.setup();
    render(<AccountInfoUpdatePanel />);
    await waitFor(() => expect(screen.getByLabelText('Email')).toHaveValue(ORIGINAL.email));
    return user;
  }

  it('sends a name change with the session token and nothing else, and asks for no password', async () => {
    serve({ routes: { '/api/update-account': async () => ({ success: true }) } });
    const user = await renderPanel();

    expect(screen.queryByLabelText(/current password/i)).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'renamed');
    expect(screen.queryByLabelText(/current password/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /update info/i }));

    await screen.findByText('Account updated successfully.');
    expect(updateCalls()).toEqual([['POST', '/api/update-account', { token: 'caller-token', userId: 1, name: 'renamed' }]]);
    expect(setSessionCookie).not.toHaveBeenCalled();
  });

  it('sends nothing when nothing changed', async () => {
    serve({ routes: { '/api/update-account': async () => ({ success: true }) } });
    const user = await renderPanel();

    await user.click(screen.getByRole('button', { name: /update info/i }));

    await screen.findByText(/nothing to update/i);
    expect(updateCalls()).toEqual([]);
  });

  it('asks for the current password once the email is edited, sends it, and stores the rotated session', async () => {
    serve({ routes: { '/api/update-account': async () => ({ success: true, token: 'fresh-token' }) } });
    const user = await renderPanel();

    await user.clear(screen.getByLabelText('Email'));
    await user.type(screen.getByLabelText('Email'), 'new@example.com');
    const current = screen.getByLabelText(/current password/i);
    expect(current).toHaveAttribute('type', 'password');
    expect(current).toHaveAttribute('autocomplete', 'current-password');
    await user.type(current, 'password123');
    await user.click(screen.getByRole('button', { name: /update info/i }));

    await screen.findByText(/signed out/i);
    expect(updateCalls()).toEqual([[
      'POST', '/api/update-account',
      { token: 'caller-token', userId: 1, email: 'new@example.com', currentPassword: 'password123' },
    ]]);
    expect(setSessionCookie).toHaveBeenCalledWith('fresh-token');
    // The new address is now the saved one, so the password field goes away.
    expect(screen.queryByLabelText(/current password/i)).not.toBeInTheDocument();
  });

  it('does not send an email change without a current password', async () => {
    serve({ routes: { '/api/update-account': async () => ({ success: true, token: 'fresh-token' }) } });
    const user = await renderPanel();

    await user.clear(screen.getByLabelText('Email'));
    await user.type(screen.getByLabelText('Email'), 'new@example.com');
    await user.click(screen.getByRole('button', { name: /update info/i }));

    await screen.findByText(/enter your current password/i);
    expect(updateCalls()).toEqual([]);
  });

  it("shows the server's refusal as sent and keeps the session it has", async () => {
    serve({ routes: { '/api/update-account': refusal(401, 'Your current password is incorrect.') } });
    const user = await renderPanel();

    await user.clear(screen.getByLabelText('Email'));
    await user.type(screen.getByLabelText('Email'), 'new@example.com');
    await user.type(screen.getByLabelText(/current password/i), 'wrong');
    await user.click(screen.getByRole('button', { name: /update info/i }));

    await screen.findByText(/your current password is incorrect\./i);
    expect(setSessionCookie).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/current password/i)).toBeInTheDocument();
  });

  it('takes the emailed code on an account with no password, then stores the rotated session', async () => {
    serve({
      hasPassword: false,
      routes: {
        '/api/update-account': async () => ({ success: true, requires_email_code: true, confirmToken: 'confirm-token', message: 'We sent a 6-digit code to your current email address. Enter it to confirm the change.' }),
        '/api/update-account/confirm-email': async () => ({ success: true, token: 'fresh-token', email: 'new@example.com', message: 'Your email address has been changed.' }),
      },
    });
    const user = await renderPanel();

    await user.clear(screen.getByLabelText('Email'));
    await user.type(screen.getByLabelText('Email'), 'new@example.com');
    expect(screen.queryByLabelText(/current password/i)).not.toBeInTheDocument();
    expect(screen.getByText(/code sent to test@example\.com/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /update info/i }));

    const code = await screen.findByLabelText(/confirmation code/i);
    expect(updateCalls()).toEqual([['POST', '/api/update-account', { token: 'caller-token', userId: 1, email: 'new@example.com' }]]);
    expect(setSessionCookie).not.toHaveBeenCalled();

    await user.type(code, '123456');
    await user.click(screen.getByRole('button', { name: /confirm email/i }));

    await screen.findByText(/signed out/i);
    expect(apiFetch).toHaveBeenCalledWith('POST', '/api/update-account/confirm-email', { confirmToken: 'confirm-token', code: '123456' });
    expect(setSessionCookie).toHaveBeenCalledWith('fresh-token');
    expect(screen.queryByLabelText(/confirmation code/i)).not.toBeInTheDocument();
  });

  it('shows why an email change cannot happen on a password-less account when mail is off', async () => {
    const why = 'This account has no password, so an email change is confirmed with a code sent to your current address, and this instance cannot send email. Ask your administrator to change it.';
    serve({ hasPassword: false, routes: { '/api/update-account': refusal(503, why) } });
    const user = await renderPanel();

    await user.clear(screen.getByLabelText('Email'));
    await user.type(screen.getByLabelText('Email'), 'new@example.com');
    await user.click(screen.getByRole('button', { name: /update info/i }));

    await screen.findByText(new RegExp(why.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    expect(screen.queryByLabelText(/confirmation code/i)).not.toBeInTheDocument();
  });

  it('shows a wrong code as refused and stays on the code step', async () => {
    serve({
      hasPassword: false,
      routes: {
        '/api/update-account': async () => ({ success: true, requires_email_code: true, confirmToken: 'confirm-token', message: 'Code sent.' }),
        '/api/update-account/confirm-email': refusal(401, 'Invalid or expired verification code'),
      },
    });
    const user = await renderPanel();

    await user.clear(screen.getByLabelText('Email'));
    await user.type(screen.getByLabelText('Email'), 'new@example.com');
    await user.click(screen.getByRole('button', { name: /update info/i }));
    await user.type(await screen.findByLabelText(/confirmation code/i), '000000');
    await user.click(screen.getByRole('button', { name: /confirm email/i }));

    await screen.findByText(/invalid or expired verification code/i);
    expect(screen.getByLabelText(/confirmation code/i)).toBeInTheDocument();
    expect(setSessionCookie).not.toHaveBeenCalled();
  });

  it('cancels the code step back to the form', async () => {
    serve({
      hasPassword: false,
      routes: { '/api/update-account': async () => ({ success: true, requires_email_code: true, confirmToken: 'confirm-token', message: 'Code sent.' }) },
    });
    const user = await renderPanel();

    await user.clear(screen.getByLabelText('Email'));
    await user.type(screen.getByLabelText('Email'), 'new@example.com');
    await user.click(screen.getByRole('button', { name: /update info/i }));
    await screen.findByLabelText(/confirmation code/i);
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.queryByLabelText(/confirmation code/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /update info/i })).toBeInTheDocument();
  });

  it('asks for the password when it cannot tell whether the account has one', async () => {
    serve({ routes: {} });
    apiFetch.mockImplementation(async (method, url) => {
      if (url === '/api/get-user') return { success: true, user: ORIGINAL };
      throw new Error('network');
    });
    const user = await renderPanel();

    await user.clear(screen.getByLabelText('Email'));
    await user.type(screen.getByLabelText('Email'), 'new@example.com');

    expect(screen.getByLabelText(/current password/i)).toBeInTheDocument();
  });
});
