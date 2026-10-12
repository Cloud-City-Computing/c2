/**
 * Cloud Codex - the Notifications and Activity filter rows are the one tab row (W6-CDX-39, Task 2.4, momus 4).
 * Each row is a `.tabs` nav of `.tabs__tab` buttons, and the active one carries `.active`.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../src/util.jsx', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    apiFetch: vi.fn(() => Promise.resolve({ success: true, notifications: [], activity: [], workspaces: [], user: { id: 1, name: 'Ada' } })),
  };
});

vi.mock('../../../src/page_layouts/Std_Layout.jsx', () => ({ default: ({ children }) => <div>{children}</div> }));

describe('the filter rows are one tab row', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The pages fetch relative URLs directly; jsdom has no base for them, so answer every request here.
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, notifications: [], activity: [], workspaces: [], user: { id: 1, name: 'Ada' } }),
    })));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('renders the Notifications filters as a .tabs nav of .tabs__tab buttons, one active', async () => {
    const { default: NotificationsPage } = await import('../../../src/pages/NotificationsPage.jsx');
    const { container } = render(<MemoryRouter><NotificationsPage /></MemoryRouter>);
    await waitFor(() => expect(container.querySelector('nav.tabs')).not.toBeNull());
    const tabs = container.querySelectorAll('nav.tabs .tabs__tab');
    expect(tabs.length).toBeGreaterThan(1);
    expect(container.querySelectorAll('nav.tabs .tabs__tab.active').length).toBe(1);
  });

  it('renders the Activity filters as a .tabs nav of .tabs__tab buttons, one active', async () => {
    const { default: WorkspaceActivity } = await import('../../../src/pages/WorkspaceActivity.jsx');
    const { container } = render(<MemoryRouter><WorkspaceActivity /></MemoryRouter>);
    await waitFor(() => expect(container.querySelector('nav.tabs')).not.toBeNull());
    expect(container.querySelectorAll('nav.tabs .tabs__tab.active').length).toBe(1);
    expect(screen.getByRole('navigation', { name: 'Filter activity' })).toHaveClass('tabs');
  });
});
