/**
 * Cloud Codex - The sidebar-led shell (W6-CDX-40, K1, K5, K9, K10)
 *
 * The layout is one sidebar: the suite cluster (suite on) or the product mark (suite off), the workspace slot,
 * the search trigger, the navigation with Notifications' unread count, the archives group, and the account
 * footer. There is no top bar, no copyright footer and no bottom tab bar.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../src/util.jsx', () => ({
  apiFetch: vi.fn(),
  showModal: vi.fn(),
  standardRedirect: vi.fn(),
  getSessionTokenFromCookie: vi.fn(),
  attemptAutoLogin: vi.fn(),
  fetchAdminStatus: vi.fn(),
  validateInviteToken: vi.fn(),
  removeSessStorage: vi.fn(),
  clearSessionCookie: vi.fn(),
}));
vi.mock('../../../src/components/Login.jsx', () => ({ default: () => null }));
vi.mock('../../../src/components/FirstRunGate.jsx', () => ({ default: () => null }));
vi.mock('../../../src/hooks/useNotificationChannel.js', () => ({
  default: () => ({ unreadCount: notificationState.count, recent: [], markRead: vi.fn(), markAllRead: vi.fn() }),
}));

const notificationState = { count: 3 };

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { apiFetch, getSessionTokenFromCookie, attemptAutoLogin, fetchAdminStatus } from '../../../src/util.jsx';
import StdLayout from '../../../src/page_layouts/Std_Layout.jsx';
import WorkspacesGate from '../../../src/components/WorkspacesGate.jsx';
import { __resetSuiteCache } from '../../../src/hooks/useSuite.js';

const USER = { id: 1, name: 'Alice Example', email: 'alice@example.com', avatar_url: null };
const SUITE_ON = { enabled: true, name: 'Example Suite' };
const SUITE_OFF = { enabled: false, name: 'Example Suite' };
const WORKSPACES = [{ id: 7, name: 'Acme Workspace' }];
const ARCHIVES = [{ id: 3, name: 'Engineering Handbook', workspace_id: 7 }];

function world({ suite, github = true, admin = false }) {
  apiFetch.mockImplementation((method, url) => {
    if (url === '/api/suite') return Promise.resolve(suite);
    if (url === '/api/suite/links') return Promise.resolve({ commandWorkspaceUrl: 'https://command.example.test/w/1' });
    if (url === '/api/workspaces') return Promise.resolve({ success: true, workspaces: WORKSPACES });
    if (url === '/api/archives') return Promise.resolve({ success: true, archives: ARCHIVES });
    if (url === '/api/github/status') return Promise.resolve({ connected: github });
    return Promise.resolve({});
  });
  getSessionTokenFromCookie.mockReturnValue('token');
  attemptAutoLogin.mockResolvedValue(USER);
  fetchAdminStatus.mockResolvedValue({ isAdmin: admin });
}

function renderAt(path = '/', ui) {
  window.history.replaceState({}, '', path);
  return render(
    <MemoryRouter initialEntries={[path]}>
      {ui ?? <StdLayout><p>page body</p></StdLayout>}
    </MemoryRouter>,
  );
}

const sidebar = () => document.querySelector('aside.sidebar');

beforeEach(() => {
  __resetSuiteCache();
  notificationState.count = 3;
  window.sessionStorage.clear();
});

describe('the shell has one sidebar and no top bar', () => {
  it('renders no top bar, copyright footer or bottom tab bar', async () => {
    world({ suite: SUITE_ON });
    const { container } = renderAt('/');
    await screen.findByText('page body');
    expect(container.querySelector('header.topbar')).toBeNull();
    expect(container.querySelector('footer.log-footer')).toBeNull();
    expect(container.querySelector('nav.mobile-nav')).toBeNull();
  });

  it('holds, in order, the cluster, the workspace slot, the search trigger, the nav and the footer', async () => {
    world({ suite: SUITE_ON });
    renderAt('/');
    await screen.findByText('page body');
    await waitFor(() => expect(sidebar().querySelector('.cc-suite__toggle')).not.toBeNull());
    const order = [...sidebar().children].map((el) => {
      if (el.matches('.cc-suite')) return 'cluster';
      if (el.matches('.workspace-slot')) return 'workspace';
      if (el.matches('.search-trigger')) return 'search';
      if (el.matches('nav.sidebar__nav')) return 'nav';
      if (el.matches('.sidebar__footer')) return 'footer';
      return el.tagName;
    });
    expect(order).toEqual(['cluster', 'workspace', 'search', 'nav', 'footer']);
  });

  it('with the suite off, the product mark stands in the cluster slot, as an SVG and not an image', async () => {
    world({ suite: SUITE_OFF });
    renderAt('/');
    await screen.findByText('page body');
    await waitFor(() => expect(sidebar().querySelector('svg.sidebar__mark')).not.toBeNull());
    expect(sidebar().querySelector('svg.sidebar__mark')).not.toBeNull();
    expect(sidebar().querySelector('img')).toBeNull();
  });
});

describe('the workspace slot', () => {
  it('names the workspace this instance is, read-only in suite mode', async () => {
    world({ suite: SUITE_ON });
    renderAt('/');
    await screen.findByText('page body');
    const slot = await waitFor(() => sidebar().querySelector('.workspace-slot'));
    expect(slot.querySelector('.workspace-slot__name').textContent).toBe('Acme Workspace');
    expect(slot.tagName).toBe('DIV');
  });

  it('links to the Workspaces page outside suite mode', async () => {
    world({ suite: SUITE_OFF });
    renderAt('/');
    await screen.findByText('page body');
    const slot = await waitFor(() => sidebar().querySelector('a.workspace-slot'));
    expect(slot.getAttribute('href')).toBe('/workspaces');
    expect(slot.querySelector('.workspace-slot__name').textContent).toBe('Acme Workspace');
  });
});

describe('suite mode off keeps the suite out of the page', () => {
  it('renders no cluster and names no suite in the sidebar', async () => {
    world({ suite: SUITE_OFF });
    renderAt('/');
    await screen.findByText('page body');
    await waitFor(() => expect(sidebar().querySelector('.sidebar__mark')).not.toBeNull());
    expect(sidebar().querySelector('.cc-suite')).toBeNull();
    expect(sidebar().textContent).not.toMatch(/example suite/i);
  });
});

describe('the suite cluster in the sidebar', () => {
  it('is the mark as an SVG, not an image (K10)', async () => {
    world({ suite: SUITE_ON });
    renderAt('/');
    await screen.findByText('page body');
    await waitFor(() => expect(sidebar().querySelector('svg.cc-suite__mark')).not.toBeNull());
    expect(sidebar().querySelector('.cc-suite img')).toBeNull();
  });
});

describe('Workspaces is hidden in suite mode (K9)', () => {
  it('has no Workspaces item in suite mode', async () => {
    world({ suite: SUITE_ON });
    renderAt('/');
    await screen.findByText('page body');
    await waitFor(() => expect(sidebar().querySelector('.cc-suite')).not.toBeNull());
    expect(within(sidebar()).queryByRole('link', { name: 'Workspaces' })).toBeNull();
  });

  it('keeps the Workspaces item outside suite mode', async () => {
    world({ suite: SUITE_OFF });
    renderAt('/');
    await screen.findByText('page body');
    await waitFor(() => expect(within(sidebar()).getByRole('link', { name: 'Workspaces' })).toBeTruthy());
  });

  it('redirects /workspaces and /workspaces/:id to the home page in suite mode', async () => {
    world({ suite: SUITE_ON });
    const routes = (
      <MemoryRouter initialEntries={['/workspaces/7']}>
        <Routes>
          <Route path="/" element={<p>home page</p>} />
          <Route path="/workspaces/:workspaceId" element={<WorkspacesGate><p>workspaces page</p></WorkspacesGate>} />
        </Routes>
      </MemoryRouter>
    );
    render(routes);
    expect(await screen.findByText('home page')).toBeTruthy();
    expect(screen.queryByText('workspaces page')).toBeNull();
  });

  it('shows the workspaces page outside suite mode', async () => {
    world({ suite: SUITE_OFF });
    render(
      <MemoryRouter initialEntries={['/workspaces']}>
        <Routes>
          <Route path="/workspaces" element={<WorkspacesGate><p>workspaces page</p></WorkspacesGate>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('workspaces page')).toBeTruthy();
  });
});

describe('Notifications is a nav item with an unread count (K5)', () => {
  it('names the count in its accessible name and shows it in a pill', async () => {
    world({ suite: SUITE_ON });
    renderAt('/');
    await screen.findByText('page body');
    const link = await waitFor(() => within(sidebar()).getByRole('link', { name: 'Notifications, 3 unread' }));
    expect(link.getAttribute('href')).toBe('/notifications');
    expect(link.querySelector('.sidebar__pill').textContent).toBe('3');
  });

  it('caps the pill at 99+ above 99', async () => {
    notificationState.count = 150;
    world({ suite: SUITE_ON });
    renderAt('/');
    await screen.findByText('page body');
    const link = await waitFor(() => within(sidebar()).getByRole('link', { name: 'Notifications, 150 unread' }));
    expect(link.querySelector('.sidebar__pill').textContent).toBe('99+');
  });

  it('has no pill and a plain name when nothing is unread', async () => {
    notificationState.count = 0;
    world({ suite: SUITE_ON });
    renderAt('/');
    await screen.findByText('page body');
    const link = await waitFor(() => within(sidebar()).getByRole('link', { name: 'Notifications' }));
    expect(link.querySelector('.sidebar__pill')).toBeNull();
  });
});

describe('the archives group and the account footer', () => {
  it('lists the archives the user can read', async () => {
    world({ suite: SUITE_ON });
    renderAt('/');
    await screen.findByText('page body');
    await waitFor(() => expect(within(sidebar()).getByRole('link', { name: 'Engineering Handbook' })).toBeTruthy());
  });

  it('opens the footer menu on the name, with Account settings and Sign out', async () => {
    world({ suite: SUITE_ON });
    renderAt('/');
    await screen.findByText('page body');
    const name = await waitFor(() => within(sidebar()).getByRole('button', { name: 'Alice Example' }));
    expect(name.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(name);
    expect(name.getAttribute('aria-expanded')).toBe('true');
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Account settings' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: 'Sign out' })).toBeTruthy();
    expect(within(menu).queryByRole('menuitem', { name: 'Admin' })).toBeNull();
  });

  it('closes on Escape and returns focus to the name, and never shows the modal dimmer', async () => {
    world({ suite: SUITE_ON });
    const { container } = renderAt('/');
    await screen.findByText('page body');
    const name = await waitFor(() => within(sidebar()).getByRole('button', { name: 'Alice Example' }));
    fireEvent.click(name);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(name.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(name);
    const dimmer = container.ownerDocument.getElementById('modal-dimmer');
    expect(dimmer === null || dimmer.style.display === 'none' || !dimmer.classList.contains('active')).toBe(true);
  });

  it('lists Admin in the footer menu for an admin, and nowhere else in the sidebar', async () => {
    world({ suite: SUITE_ON, admin: true });
    renderAt('/');
    await screen.findByText('page body');
    fireEvent.click(await waitFor(() => within(sidebar()).getByRole('button', { name: 'Alice Example' })));
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Admin' })).toBeTruthy();
    expect(within(sidebar()).queryByRole('link', { name: 'Admin' })).toBeNull();
  });

  it('names the menu button by the person, so its name survives the phone strip hiding the text', async () => {
    world({ suite: SUITE_ON });
    renderAt('/');
    await screen.findByText('page body');
    const name = await waitFor(() => within(sidebar()).getByRole('button', { name: 'Alice Example' }));
    expect(name.getAttribute('aria-label')).toBe('Alice Example');
  });

  it('has a sign-out icon button with an accessible name', async () => {
    world({ suite: SUITE_ON });
    renderAt('/');
    await screen.findByText('page body');
    expect(await waitFor(() => within(sidebar()).getByRole('button', { name: 'Sign out' }))).toBeTruthy();
  });
});
