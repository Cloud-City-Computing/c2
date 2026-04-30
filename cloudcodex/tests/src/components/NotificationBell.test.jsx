/**
 * Cloud Codex — Tests for src/components/NotificationBell.jsx
 *
 * Mocks the underlying useNotificationChannel hook so we can drive the bell
 * with controlled state without spinning up a real WebSocket.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const channelState = { unreadCount: 0, recent: [], markRead: vi.fn(), markAllRead: vi.fn() };

vi.mock('../../../src/hooks/useNotificationChannel.js', () => ({
  default: () => channelState,
}));

import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import NotificationBell from '../../../src/components/NotificationBell.jsx';

const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(() => {
  channelState.unreadCount = 0;
  channelState.recent = [];
  channelState.markRead = vi.fn();
  channelState.markAllRead = vi.fn();
});

describe('NotificationBell', () => {
  it('renders a bell button with no badge when there are no unread items', () => {
    const { container } = wrap(<NotificationBell />);
    expect(screen.getByRole('button', { name: /notifications, 0 unread/i })).toBeInTheDocument();
    expect(container.querySelector('.notification-bell__badge')).toBeNull();
  });

  it('shows a badge with the unread count', () => {
    channelState.unreadCount = 3;
    const { container } = wrap(<NotificationBell />);
    expect(container.querySelector('.notification-bell__badge').textContent).toBe('3');
  });

  it('caps the badge text at "99+"', () => {
    channelState.unreadCount = 9999;
    const { container } = wrap(<NotificationBell />);
    expect(container.querySelector('.notification-bell__badge').textContent).toBe('99+');
  });

  it('opens a dropdown when the bell is clicked', async () => {
    const user = userEvent.setup();
    wrap(<NotificationBell />);
    const btn = screen.getByRole('button', { name: /notifications/i });
    await user.click(btn);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
  });

  it('toggles the dropdown closed on a second click', async () => {
    const user = userEvent.setup();
    wrap(<NotificationBell />);
    const btn = screen.getByRole('button', { name: /notifications/i });
    await user.click(btn);
    expect(screen.queryByRole('menu')).not.toBeNull();
    await user.click(btn);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('shows recent notifications inside the dropdown', async () => {
    const user = userEvent.setup();
    channelState.unreadCount = 1;
    channelState.recent = [
      { id: 1, title: 'Hi there', actor_name: 'Bob', created_at: new Date().toISOString(), read_at: null, link_url: '/d/1' },
    ];
    wrap(<NotificationBell />);
    await user.click(screen.getByRole('button', { name: /notifications/i }));
    expect(screen.getByText('Hi there')).toBeInTheDocument();
  });

  it('shows a "Mark all read" button when unreadCount > 0', async () => {
    const user = userEvent.setup();
    channelState.unreadCount = 2;
    wrap(<NotificationBell />);
    await user.click(screen.getByRole('button', { name: /notifications/i }));
    const markAll = screen.getByRole('button', { name: /mark all read/i });
    await user.click(markAll);
    expect(channelState.markAllRead).toHaveBeenCalled();
  });

  it('closes the dropdown on Escape', async () => {
    const user = userEvent.setup();
    wrap(<NotificationBell />);
    await user.click(screen.getByRole('button', { name: /notifications/i }));
    expect(screen.queryByRole('menu')).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
