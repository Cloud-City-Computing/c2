/**
 * Cloud Codex — Tests for src/components/PresenceAvatars.jsx
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PresenceAvatars from '../../../src/components/PresenceAvatars.jsx';

describe('PresenceAvatars', () => {
  it('renders nothing when there are no users', () => {
    const { container } = render(<PresenceAvatars users={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when users is undefined', () => {
    const { container } = render(<PresenceAvatars />);
    expect(container.firstChild).toBeNull();
  });

  it('renders an initial circle for each user without an avatar URL', () => {
    render(<PresenceAvatars users={[
      { id: 1, name: 'Alice', color: '#fff' },
      { id: 2, name: 'Bob', color: '#aaa' },
    ]} />);
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('renders an <img> when avatar_url is set', () => {
    const { container } = render(<PresenceAvatars users={[
      { id: 1, name: 'Alice', avatar_url: 'https://x/a.png', color: '#fff' },
    ]} />);
    const img = container.querySelector('img');
    expect(img.getAttribute('src')).toBe('https://x/a.png');
    expect(img.getAttribute('alt')).toBe('Alice');
  });

  it('shows at most 3 avatars and a +N overflow indicator for more', () => {
    const users = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, name: `U${i}`, color: '#fff' }));
    const { container } = render(<PresenceAvatars users={users} />);
    // 3 main avatars + the dot indicator. Tooltip avatars render only on hover.
    expect(container.querySelectorAll('.presence-avatars > .presence-avatar').length).toBe(3);
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('shows tooltip with all users on mouse enter', () => {
    const users = [
      { id: 1, name: 'Alice', color: '#fff' },
      { id: 2, name: 'Bob', color: '#aaa' },
    ];
    const { container } = render(<PresenceAvatars users={users} />);
    fireEvent.mouseEnter(container.firstChild);
    expect(container.querySelector('.presence-tooltip')).toBeInTheDocument();
  });

  it('falls back to "?" when name is missing', () => {
    render(<PresenceAvatars users={[{ id: 1, color: '#fff' }]} />);
    expect(screen.getByText('?')).toBeInTheDocument();
  });
});
