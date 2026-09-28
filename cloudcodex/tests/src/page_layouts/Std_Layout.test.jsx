/**
 * Cloud Codex - Tests for the standard layout's GitHub status request
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../src/util.jsx', () => ({
  apiFetch: vi.fn(),
  showModal: vi.fn(),
  showDropdownMenu: vi.fn(),
  standardRedirect: vi.fn(),
  getSessionTokenFromCookie: vi.fn(),
  attemptAutoLogin: vi.fn(),
  fetchAdminStatus: vi.fn(),
  validateInviteToken: vi.fn(),
}));

// The layout's children are out of scope here; each would make requests of its own.
vi.mock('../../../src/components/Login.jsx', () => ({ default: () => null }));
vi.mock('../../../src/components/AccountPanel.jsx', () => ({ default: () => null }));
vi.mock('../../../src/components/SearchBox.jsx', () => ({ default: () => null }));
vi.mock('../../../src/components/NotificationBell.jsx', () => ({ default: () => null }));
vi.mock('../../../src/components/FirstRunGate.jsx', () => ({ default: () => null }));

import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  apiFetch,
  getSessionTokenFromCookie,
  attemptAutoLogin,
  fetchAdminStatus,
} from '../../../src/util.jsx';
import StdLayout from '../../../src/page_layouts/Std_Layout.jsx';

const USER = { id: 1, name: 'Alice', email: 'alice@example.com' };

const renderLayout = () => render(
  <MemoryRouter>
    <StdLayout><p>page body</p></StdLayout>
  </MemoryRouter>,
);

const statusCalls = () => apiFetch.mock.calls.filter(([, url]) => url === '/api/github/status');

beforeEach(() => {
  vi.clearAllMocks();
  apiFetch.mockResolvedValue({ connected: true });
  fetchAdminStatus.mockResolvedValue({ isAdmin: false });
});

describe('Std_Layout and /api/github/status', () => {
  // /api/github/status is behind requireAuth, so asking it for a signed-out
  // visitor is a 401 in the console of every landing page view.
  it('does not ask for a signed-out visitor', async () => {
    getSessionTokenFromCookie.mockReturnValue(null);
    renderLayout();
    await screen.findByText(/please log in/i);
    expect(statusCalls()).toEqual([]);
  });

  it('does not ask when the session cookie no longer signs anyone in', async () => {
    getSessionTokenFromCookie.mockReturnValue('stale-token');
    attemptAutoLogin.mockResolvedValue(null);
    renderLayout();
    await screen.findByText(/please log in/i);
    expect(statusCalls()).toEqual([]);
  });

  it('asks once for a signed-in user, and shows the GitHub link when one is linked', async () => {
    getSessionTokenFromCookie.mockReturnValue('token');
    attemptAutoLogin.mockResolvedValue(USER);
    renderLayout();
    await screen.findByText('page body');
    await waitFor(() => expect(statusCalls()).toEqual([['GET', '/api/github/status']]));
    expect(screen.getAllByRole('link', { name: /github/i }).length).toBeGreaterThan(0);
  });

  it('hides the GitHub link from a signed-in user with no account linked', async () => {
    getSessionTokenFromCookie.mockReturnValue('token');
    attemptAutoLogin.mockResolvedValue(USER);
    apiFetch.mockResolvedValue({ connected: false });
    renderLayout();
    await screen.findByText('page body');
    await waitFor(() => expect(screen.queryAllByRole('link', { name: /github/i })).toEqual([]));
    expect(screen.getAllByRole('link', { name: /home/i }).length).toBeGreaterThan(0);
  });
});
