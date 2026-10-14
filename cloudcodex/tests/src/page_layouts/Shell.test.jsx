/**
 * Cloud Codex - The sidebar-led shell (W6-CDX-40, K1, K5, K9, K10)
 *
 * The layout is one sidebar: the product mark, the workspace slot,
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
import { MemoryRouter } from 'react-router-dom';
import { apiFetch, getSessionTokenFromCookie, attemptAutoLogin, fetchAdminStatus } from '../../../src/util.jsx';
import StdLayout from '../../../src/page_layouts/Std_Layout.jsx';

const USER = { id: 1, name: 'Alice Example', email: 'alice@example.com', avatar_url: null };
const WORKSPACES = [{ id: 7, name: 'Acme Workspace' }];
const ARCHIVES = [{ id: 3, name: 'Engineering Handbook', workspace_id: 7 }];

function world({ github = true, admin = false } = {}) {
  apiFetch.mockImplementation((method, url) => {
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
  notificationState.count = 3;
  window.sessionStorage.clear();
});

describe('the shell has one sidebar and no top bar', () => {
  it('renders no top bar, copyright footer or bottom tab bar', async () => {
    world({});
    const { container } = renderAt('/');
    await screen.findByText('page body');
    expect(container.querySelector('header.topbar')).toBeNull();
    expect(container.querySelector('footer.log-footer')).toBeNull();
    expect(container.querySelector('nav.mobile-nav')).toBeNull();
  });

  it('holds, in order, the product mark, the workspace slot, the search trigger, the nav and the footer', async () => {
    world({});
    renderAt('/');
    await screen.findByText('page body');
    await waitFor(() => expect(sidebar().querySelector('a.sidebar__brand')).not.toBeNull());
    const order = [...sidebar().children].map((el) => {
      if (el.matches('a.sidebar__brand')) return 'brand';
      if (el.matches('.workspace-slot')) return 'workspace';
      if (el.matches('.search-trigger')) return 'search';
      if (el.matches('nav.sidebar__nav')) return 'nav';
      if (el.matches('.sidebar__footer')) return 'footer';
      return el.tagName;
    });
    expect(order).toEqual(['brand', 'workspace', 'search', 'nav', 'footer']);
  });

  it('the product mark stands at the top of the sidebar, as an SVG and not an image', async () => {
    world({});
    renderAt('/');
    await screen.findByText('page body');
    await waitFor(() => expect(sidebar().querySelector('svg.sidebar__mark')).not.toBeNull());
    expect(sidebar().querySelector('svg.sidebar__mark')).not.toBeNull();
    expect(sidebar().querySelector('img')).toBeNull();
  });
});

describe('the workspace slot', () => {
  it('links to the Workspaces page', async () => {
    world({});
    renderAt('/');
    await screen.findByText('page body');
    const slot = await waitFor(() => sidebar().querySelector('a.workspace-slot'));
    expect(slot.getAttribute('href')).toBe('/workspaces');
    expect(slot.querySelector('.workspace-slot__name').textContent).toBe('Acme Workspace');
  });
});

describe('the sidebar names no suite', () => {
  it('renders no suite cluster and names no suite in the sidebar', async () => {
    world({});
    renderAt('/');
    await screen.findByText('page body');
    await waitFor(() => expect(sidebar().querySelector('.sidebar__mark')).not.toBeNull());
    expect(sidebar().querySelector('.cc-suite')).toBeNull();
    expect(sidebar().textContent).not.toMatch(/example suite/i);
  });
});

describe('Workspaces is always offered', () => {
  it('has the Workspaces item', async () => {
    world({});
    renderAt('/');
    await screen.findByText('page body');
    await waitFor(() => expect(within(sidebar()).getByRole('link', { name: 'Workspaces' })).toBeTruthy());
  });

});

describe('Notifications is a nav item with an unread count (K5)', () => {
  it('names the count in its accessible name and shows it in a pill', async () => {
    world({});
    renderAt('/');
    await screen.findByText('page body');
    const link = await waitFor(() => within(sidebar()).getByRole('link', { name: 'Notifications, 3 unread' }));
    expect(link.getAttribute('href')).toBe('/notifications');
    expect(link.querySelector('.sidebar__pill').textContent).toBe('3');
  });

  it('caps the pill at 99+ above 99', async () => {
    notificationState.count = 150;
    world({});
    renderAt('/');
    await screen.findByText('page body');
    const link = await waitFor(() => within(sidebar()).getByRole('link', { name: 'Notifications, 150 unread' }));
    expect(link.querySelector('.sidebar__pill').textContent).toBe('99+');
  });

  it('has no pill and a plain name when nothing is unread', async () => {
    notificationState.count = 0;
    world({});
    renderAt('/');
    await screen.findByText('page body');
    const link = await waitFor(() => within(sidebar()).getByRole('link', { name: 'Notifications' }));
    expect(link.querySelector('.sidebar__pill')).toBeNull();
  });
});

describe('the archives group and the account footer', () => {
  it('lists the archives the user can read', async () => {
    world({});
    renderAt('/');
    await screen.findByText('page body');
    await waitFor(() => expect(within(sidebar()).getByRole('link', { name: 'Engineering Handbook' })).toBeTruthy());
  });

  it('opens the footer menu on the name, with Account settings and Sign out', async () => {
    world({});
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
    world({});
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
    world({ admin: true });
    renderAt('/');
    await screen.findByText('page body');
    fireEvent.click(await waitFor(() => within(sidebar()).getByRole('button', { name: 'Alice Example' })));
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Admin' })).toBeTruthy();
    expect(within(sidebar()).queryByRole('link', { name: 'Admin' })).toBeNull();
  });

  it('names the menu button by the person, so its name survives the phone strip hiding the text', async () => {
    world({});
    renderAt('/');
    await screen.findByText('page body');
    const name = await waitFor(() => within(sidebar()).getByRole('button', { name: 'Alice Example' }));
    expect(name.getAttribute('aria-label')).toBe('Alice Example');
  });

  it('has a sign-out icon button with an accessible name', async () => {
    world({});
    renderAt('/');
    await screen.findByText('page body');
    expect(await waitFor(() => within(sidebar()).getByRole('button', { name: 'Sign out' }))).toBeTruthy();
  });
});
