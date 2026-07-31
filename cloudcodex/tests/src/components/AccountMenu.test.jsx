/**
 * Cloud Codex — Tests for src/components/AccountMenu.jsx
 *
 * Scoped to the TOTP setup rendering branch added for mail-off instances
 * (task 6b): the QR image and secret render inline when the enable response
 * carries them, and the section renders exactly as before when it doesn't.
 * This file does not attempt to cover the rest of AccountPreferencesPanel.
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
  },
}));

vi.mock('../../../src/util.jsx', () => utilMock);

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { apiFetch } from '../../../src/util.jsx';
import { AccountPreferencesPanel } from '../../../src/components/AccountMenu.jsx';

beforeEach(() => {
  apiFetch.mockReset();
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
