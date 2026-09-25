/**
 * Cloud Codex - Tests for LinkedAccountsPanel in src/components/AccountMenu.jsx
 *
 * The GitHub link callback ends on /account with `github_linked=1` or a
 * `github_error` code. The panel turns either into its status line and takes
 * the parameter off the URL, so a reload does not repeat it. Before this the
 * page ignored both, and a refused link looked like nothing had happened.
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
  },
}));

vi.mock('../../../src/util.jsx', () => utilMock);

import { render, screen } from '@testing-library/react';
import { apiFetch } from '../../../src/util.jsx';
import { LinkedAccountsPanel } from '../../../src/components/AccountMenu.jsx';

/** Land on `url` the way the callback's redirect does, then render the panel. */
async function renderAt(url) {
  window.history.replaceState({}, '', url);
  render(<LinkedAccountsPanel />);
  return screen.findByRole('heading', { name: 'Linked Accounts' });
}

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({
    accounts: [{ provider: 'github', provider_username: 'first', token_status: 'active' }],
    hasPassword: true,
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ providers: { github: true } }) })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('LinkedAccountsPanel and the GitHub link callback', () => {
  // The race loser: another GitHub account linked this user a moment earlier,
  // so the panel shows that one, and has to say why it is not this one.
  it('explains link_conflict and names the way out, as an error', async () => {
    await renderAt('/account?github_error=link_conflict');

    const status = screen.getByText(
      'Another GitHub account was linked to your account at the same moment, so this one was not. ' +
        'To use this one instead, unlink the current one and link again.'
    );
    expect(status).toHaveClass('panel-status', 'error');
  });

  it.each([
    ['already_linked_other', 'That GitHub account is already linked to another Cloud Codex user.'],
    ['access_denied', 'GitHub linking was cancelled.'],
    ['invalid_state', 'The GitHub link expired or was started in another browser. Please try again.'],
  ])('explains %s', async (code, message) => {
    await renderAt(`/account?github_error=${code}`);
    expect(screen.getByText(message)).toHaveClass('panel-status', 'error');
  });

  it('falls back to a generic message for a code it does not know', async () => {
    await renderAt('/account?github_error=something_new');
    expect(screen.getByText('GitHub linking failed. Please try again.')).toHaveClass('panel-status', 'error');
  });

  it('confirms a completed link', async () => {
    await renderAt('/account?github_linked=1');
    expect(screen.getByText('GitHub account linked.')).toHaveClass('panel-status', 'success');
  });

  it('takes the parameter off the URL and keeps the rest', async () => {
    await renderAt('/account?tab=links&github_error=link_conflict');
    expect(window.location.pathname).toBe('/account');
    expect(window.location.search).toBe('?tab=links');
  });

  it('shows no status without either parameter', async () => {
    await renderAt('/account');
    expect(document.querySelector('.panel-status')).toBeNull();
  });
});
