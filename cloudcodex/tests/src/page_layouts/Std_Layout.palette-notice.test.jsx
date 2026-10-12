/**
 * Cloud Codex - A session notice closes the search palette first (W6-CDX-40 review, item 2)
 *
 * The notice is a dialog of its own. Opened over the palette, two dialogs would stack with no order between them,
 * so the layout announces the notice and the palette closes before the notice takes the focus.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { sessionHandlers } = vi.hoisted(() => ({ sessionHandlers: [] }));
vi.mock('../../../src/lib/session-ended.js', () => ({
  onSessionEnded: (fn) => { sessionHandlers.push(fn); return () => {}; },
}));
vi.mock('../../../src/lib/unsaved-changes.js', () => ({
  hasUnsavedChanges: () => true,
  unsavedCopyText: () => '',
}));
vi.mock('../../../src/util.jsx', () => ({
  apiFetch: vi.fn(() => Promise.resolve({})),
  showModal: vi.fn(),
  standardRedirect: vi.fn(),
  getSessionTokenFromCookie: vi.fn(() => 'tok'),
  attemptAutoLogin: vi.fn(() => Promise.resolve({ id: 1, name: 'Alice' })),
  fetchAdminStatus: vi.fn(() => Promise.resolve({ isAdmin: false })),
  validateInviteToken: vi.fn(),
  removeSessStorage: vi.fn(),
  clearSessionCookie: vi.fn(),
}));
vi.mock('../../../src/components/Login.jsx', () => ({ default: () => null }));
vi.mock('../../../src/components/FirstRunGate.jsx', () => ({ default: () => null }));
vi.mock('../../../src/hooks/useNotificationChannel.js', () => ({
  default: () => ({ unreadCount: 0, recent: [], markRead: vi.fn(), markAllRead: vi.fn() }),
}));

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import StdLayout from '../../../src/page_layouts/Std_Layout.jsx';
import { __resetSuiteCache } from '../../../src/hooks/useSuite.js';

beforeEach(() => {
  __resetSuiteCache();
  sessionHandlers.length = 0;
});

describe('the session notice and the search palette', () => {
  it('closes the palette when the notice appears, and the notice takes the focus', async () => {
    render(<MemoryRouter><StdLayout><p>page body</p></StdLayout></MemoryRouter>);
    await screen.findByText('page body');
    await waitFor(() => expect(sessionHandlers.length).toBe(1));

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: /search or jump to/i })).toBeTruthy();

    await act(async () => { sessionHandlers[0](); });
    expect(await screen.findByText(/your session ended/i)).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: /search or jump to/i })).toBeNull();
    await waitFor(() => expect(document.activeElement?.textContent).toMatch(/sign in again/i));
  });
});
