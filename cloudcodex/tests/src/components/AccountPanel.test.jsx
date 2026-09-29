/**
 * Cloud Codex - Tests for src/components/AccountPanel.jsx, the account dropdown and sign-out
 *
 * Sign-out deletes the server's session row, then clears the session cookie
 * through the one client helper that knows both names (W6-CDX-3), so an https
 * page does not keep a __Host-sessionToken the old literal never touched.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { utilMock } = vi.hoisted(() => ({
  utilMock: {
    apiFetch: vi.fn(),
    removeSessStorage: vi.fn(),
    clearSessionCookie: vi.fn(),
  },
}));

vi.mock('../../../src/util.jsx', () => utilMock);

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AccountPanel from '../../../src/components/AccountPanel.jsx';

beforeEach(() => {
  for (const fn of Object.values(utilMock)) fn.mockReset();
});

describe('AccountPanel', () => {
  it('shows who is signed in', () => {
    render(<AccountPanel name="ada" email="ada@example.com" />);
    expect(screen.getByText('ada')).toBeInTheDocument();
    expect(screen.getByText(/ada@example\.com/)).toBeInTheDocument();
  });

  it('signs out: deletes the session, forgets the cached user, clears the cookie', async () => {
    utilMock.apiFetch.mockResolvedValueOnce({ success: true });
    render(<AccountPanel name="ada" email="ada@example.com" />);

    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));

    await waitFor(() => expect(utilMock.clearSessionCookie).toHaveBeenCalledTimes(1));
    expect(utilMock.apiFetch).toHaveBeenCalledWith('POST', '/api/logout', {});
    expect(utilMock.removeSessStorage).toHaveBeenCalledWith('currentUser');
  });

  it('still clears the cookie when the server cannot be reached', async () => {
    utilMock.apiFetch.mockRejectedValueOnce(new Error('offline'));
    render(<AccountPanel name="ada" email="ada@example.com" />);

    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));

    await waitFor(() => expect(utilMock.clearSessionCookie).toHaveBeenCalledTimes(1));
  });
});
