/**
 * Cloud Codex — Tests for src/components/NotificationItem.jsx
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NotificationItem from '../../../src/components/NotificationItem.jsx';

const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

const baseNotif = {
  id: 1,
  title: 'You were mentioned',
  body: '<p>Hello <b>world</b></p>',
  actor_name: 'Alice',
  link_url: '/d/123',
  read_at: null,
  created_at: new Date(Date.now() - 60000).toISOString(),
};

describe('NotificationItem', () => {
  it('renders the title and a stripped-HTML body snippet', () => {
    wrap(<NotificationItem notification={baseNotif} onActivate={vi.fn()} />);
    expect(screen.getByText('You were mentioned')).toBeInTheDocument();
    // HTML stripped from body
    expect(screen.getByText(/Hello world/i)).toBeInTheDocument();
  });

  it('marks unread items with the unread modifier class and dot', () => {
    const { container } = wrap(<NotificationItem notification={baseNotif} onActivate={vi.fn()} />);
    expect(container.firstChild.className).toMatch(/notification-item--unread/);
    expect(container.querySelector('.notification-item__dot')).not.toBeNull();
  });

  it('omits the unread modifier when read_at is set', () => {
    const { container } = wrap(<NotificationItem
      notification={{ ...baseNotif, read_at: '2026-04-01' }}
      onActivate={vi.fn()}
    />);
    expect(container.firstChild.className).not.toMatch(/notification-item--unread/);
    expect(container.querySelector('.notification-item__dot')).toBeNull();
  });

  it('renders an internal route as a Link (router-aware) for "/" prefixed URLs', () => {
    const { container } = wrap(<NotificationItem notification={baseNotif} onActivate={vi.fn()} />);
    const link = container.querySelector('a');
    expect(link.getAttribute('href')).toBe('/d/123');
    // React Router's Link does not add a target attribute
    expect(link.getAttribute('target')).toBeNull();
  });

  it('renders an external URL as a plain <a>', () => {
    const { container } = wrap(<NotificationItem
      notification={{ ...baseNotif, link_url: 'https://github.com/x/y' }}
      onActivate={vi.fn()}
    />);
    expect(container.querySelector('a').getAttribute('href')).toBe('https://github.com/x/y');
  });

  it('clicking calls onActivate with the notification', () => {
    const onActivate = vi.fn();
    const { container } = wrap(<NotificationItem notification={baseNotif} onActivate={onActivate} />);
    fireEvent.click(container.querySelector('a'));
    expect(onActivate).toHaveBeenCalledWith(baseNotif);
  });

  it('renders the actor avatar image when avatar URL is set', () => {
    const { container } = wrap(<NotificationItem
      notification={{ ...baseNotif, actor_avatar: 'https://x/a.png' }}
      onActivate={vi.fn()}
    />);
    expect(container.querySelector('img.notification-item__avatar')).not.toBeNull();
  });

  it('falls back to a placeholder initial when there is no avatar URL', () => {
    const { container } = wrap(<NotificationItem notification={baseNotif} onActivate={vi.fn()} />);
    expect(container.querySelector('.notification-item__avatar--placeholder')).not.toBeNull();
  });
});
