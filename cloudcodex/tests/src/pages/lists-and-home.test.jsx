/**
 * Cloud Codex - the list pages, home and the empty state (W6-CDX-41, Task 4.1)
 *
 * One empty-state component (.empty-state: a title, one line, an optional action) renders on Home with no documents,
 * an empty document tree, Notifications with none and Activity with none. Home, the archive list and the archive
 * view each carry the shared page header (.page-header with the page's h1). Home has no hero.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import EmptyState from '../../../src/components/EmptyState.jsx';

vi.mock('../../../src/util.jsx', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    apiFetch: vi.fn(() => Promise.resolve({
      success: true, notifications: [], activity: [], results: [], workspaces: [{ id: 1, name: 'Hoth' }], invitations: [], logs: [],
      archives: [{ id: 1, name: 'Release Planning', squad_id: null, workspace_id: null }],
      user: { id: 1, name: 'Ada' },
    })),
    browseLogs: vi.fn(() => Promise.resolve({ logs: [], total: 0, totalPages: 0 })),
    fetchMyInvitations: vi.fn(() => Promise.resolve({ invitations: [] })),
    fetchFavorites: vi.fn(() => Promise.resolve({ favorites: [] })),
    fetchSearchFilters: vi.fn(() => Promise.resolve({ workspaces: [], squads: [], archives: [] })),
  };
});

vi.mock('../../../src/page_layouts/Std_Layout.jsx', () => ({ default: ({ children }) => <div>{children}</div> }));

vi.mock('../../../src/hooks/usePresence', () => ({
  default: () => ({ getLogUsers: () => [] }),
}));

describe('EmptyState', () => {
  it('renders the one empty-state shape: a title, one line, and an optional action', () => {
    const { container } = render(
      <EmptyState title="No documents yet" action={<button type="button">Go to Archives</button>}>
        Create an archive, then add your first document to it.
      </EmptyState>,
    );
    const root = container.querySelector('.empty-state');
    expect(root).not.toBeNull();
    expect(root.querySelector('.empty-state__title')).toHaveTextContent('No documents yet');
    expect(root.querySelector('.empty-state__body')).toHaveTextContent('Create an archive');
    expect(root.querySelector('.empty-state__action button')).toHaveTextContent('Go to Archives');
  });

  it('omits the action slot when there is no action', () => {
    const { container } = render(<EmptyState title="No notifications">Nothing new.</EmptyState>);
    expect(container.querySelector('.empty-state__action')).toBeNull();
  });
});

describe('the list pages and home', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, notifications: [], activity: [], results: [], workspaces: [{ id: 1, name: 'Hoth' }], logs: [], user: { id: 1, name: 'Ada' } }),
    })));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('Home has the page header, no hero, and the empty state when there are no documents', async () => {
    const { default: HomePage } = await import('../../../src/pages/HomePage.jsx');
    const { container } = render(<MemoryRouter><HomePage /></MemoryRouter>);
    await waitFor(() => expect(container.querySelector('.empty-state')).not.toBeNull());
    expect(container.querySelector('.home-hero')).toBeNull();
    expect(container.querySelector('.page-header h1')).toHaveTextContent('Home');
    expect(container.querySelector('.empty-state')).toHaveTextContent('No documents yet');
  });

  it('Notifications renders the empty state when there are none', async () => {
    const { default: NotificationsPage } = await import('../../../src/pages/NotificationsPage.jsx');
    const { container } = render(<MemoryRouter><NotificationsPage /></MemoryRouter>);
    await waitFor(() => expect(container.querySelector('.empty-state')).not.toBeNull());
    expect(container.querySelector('.empty-state')).toHaveTextContent('No notifications');
  });

  it('Activity renders the empty state when there is none', async () => {
    const { default: WorkspaceActivity } = await import('../../../src/pages/WorkspaceActivity.jsx');
    const { container } = render(<MemoryRouter><WorkspaceActivity /></MemoryRouter>);
    await waitFor(() => expect(container.querySelector('.empty-state')).not.toBeNull());
    expect(container.querySelector('.empty-state')).toHaveTextContent('No activity yet');
  });

  it('the archive view carries the archive name in the page header', async () => {
    const { default: ArchiveView } = await import('../../../src/pages/ArchiveView.jsx');
    const { container } = render(
      <MemoryRouter initialEntries={['/archives/1']}>
        <Routes><Route path="/archives/:archiveId" element={<ArchiveView />} /></Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(container.querySelector('.page-header h1')).toHaveTextContent('Release Planning'));
    expect(container.querySelectorAll('.page-header .btn-primary')).toHaveLength(0);
  });
});
