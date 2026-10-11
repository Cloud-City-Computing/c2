/**
 * Cloud Codex - The top bar with suite mode off renders exactly its pre-suite DOM
 *
 * W6-CDX-25 adds a suite cluster to the brand slot. With the suite off the slot must not
 * change, so this snapshot is taken from the code before that change and never updated to
 * follow it. Regenerate it only for a deliberate top-bar change, and say so in the PR.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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
vi.mock('../../../src/components/Login.jsx', () => ({ default: () => null }));
vi.mock('../../../src/components/AccountPanel.jsx', () => ({ default: () => null }));
vi.mock('../../../src/components/SearchBox.jsx', () => ({ default: () => null }));
vi.mock('../../../src/components/NotificationBell.jsx', () => ({ default: () => null }));
vi.mock('../../../src/components/FirstRunGate.jsx', () => ({ default: () => null }));

import { TopBar } from '../../../src/page_layouts/Std_Layout.jsx';

const USER = { id: 1, name: 'Alice', email: 'alice@example.com', avatar_url: null };

describe('TopBar with the suite off', () => {
  it('renders the anonymous top bar exactly as before the suite cluster', () => {
    const { container } = render(<MemoryRouter><TopBar user={null} /></MemoryRouter>);
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('renders the signed-in top bar exactly as before the suite cluster', () => {
    const { container } = render(<MemoryRouter><TopBar user={USER} /></MemoryRouter>);
    expect(container.innerHTML).toMatchSnapshot();
  });
});

describe('TopBar with the suite on', () => {
  const SUITE_ON = { enabled: true, name: 'Example Suite', commandWorkspaceUrl: 'https://command.example.test/w/1' };

  it('puts the cluster in the brand slot in place of the plain brand link', () => {
    const { container } = render(<MemoryRouter><TopBar user={USER} suite={SUITE_ON} /></MemoryRouter>);
    const left = container.querySelector('.topbar__left');
    expect(left.querySelector('.cc-suite__toggle')).not.toBeNull();
    expect(left.querySelector('.topbar__brand')).toBeNull();
  });

  it('shows no cluster to a signed-out visitor, who has no Cloud Command link to offer', () => {
    const { container } = render(<MemoryRouter><TopBar user={null} suite={SUITE_ON} /></MemoryRouter>);
    expect(container.querySelector('.cc-suite')).toBeNull();
    expect(container.querySelector('.topbar__brand')).not.toBeNull();
  });

  it('keeps the plain brand when the suite is off', () => {
    const { container } = render(<MemoryRouter><TopBar user={USER} suite={{ enabled: false, name: null, commandWorkspaceUrl: null }} /></MemoryRouter>);
    expect(container.querySelector('.cc-suite')).toBeNull();
  });
});
