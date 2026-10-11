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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

  // W6-CDX-6: an OIDC sign-out is sent on to the issuer's end-session URL, after the local teardown.
  describe('the end-session URL (W6-CDX-6)', () => {
    const realLocation = window.location;
    let location;

    beforeEach(() => {
      location = { href: 'http://localhost:3000/account' };
      Object.defineProperty(window, 'location', { value: location, writable: true, configurable: true });
    });

    afterEach(() => {
      Object.defineProperty(window, 'location', { value: realLocation, writable: true, configurable: true });
      vi.useRealTimers();
    });

    it('navigates to the endSessionUrl the server answers, once the local sign-out has run', async () => {
      const endSessionUrl = 'https://id.example.test/end-session?client_id=codex-web&state=abc';
      utilMock.apiFetch.mockResolvedValueOnce({ success: true, endSessionUrl });
      render(<AccountPanel name="ada" email="ada@example.com" />);

      fireEvent.click(screen.getByRole('button', { name: 'Logout' }));

      await waitFor(() => expect(location.href).toBe(endSessionUrl));
      expect(utilMock.clearSessionCookie).toHaveBeenCalledTimes(1);
    });

    it('goes to / for a local session, which has no endSessionUrl', async () => {
      utilMock.apiFetch.mockResolvedValueOnce({ success: true });
      render(<AccountPanel name="ada" email="ada@example.com" />);

      fireEvent.click(screen.getByRole('button', { name: 'Logout' }));

      await waitFor(() => expect(location.href).toBe('/'));
    });

    it('never navigates to a URL that is not http or https', async () => {
      for (const endSessionUrl of ['javascript:alert(1)', 'data:text/html,hi', '/relative', 'not a url']) {
        location.href = 'http://localhost:3000/account';
        utilMock.apiFetch.mockResolvedValueOnce({ success: true, endSessionUrl });
        const { unmount } = render(<AccountPanel name="ada" email="ada@example.com" />);

        fireEvent.click(screen.getByRole('button', { name: 'Logout' }));

        await waitFor(() => expect(location.href).toBe('/'));
        unmount();
      }
    });

    it('ends the local session at once, before the server answers', () => {
      utilMock.apiFetch.mockReturnValueOnce(new Promise(() => {}));
      render(<AccountPanel name="ada" email="ada@example.com" />);

      fireEvent.click(screen.getByRole('button', { name: 'Logout' }));

      expect(utilMock.clearSessionCookie).toHaveBeenCalledTimes(1);
      expect(utilMock.removeSessStorage).toHaveBeenCalledWith('currentUser');
      expect(utilMock.apiFetch).toHaveBeenCalledWith('POST', '/api/logout', {});
    });

    it('stops waiting for a server that never answers after five seconds, and goes to /', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      utilMock.apiFetch.mockReturnValueOnce(new Promise(() => {}));
      render(<AccountPanel name="ada" email="ada@example.com" />);

      fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
      await vi.advanceTimersByTimeAsync(5000);

      expect(location.href).toBe('/');
    });
  });
});
