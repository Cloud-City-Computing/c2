/**
 * Cloud Codex - the avatar (W6-CDX-39, Task 2.4): a stable tint from a hash of the user id, one of the
 * package's --avatar-1..8, with the initial in the dark ink; a photo when there is one.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import Avatar from '../../../src/components/Avatar.jsx';
import { avatarTint } from '../../../src/lib/avatar-tint.js';

describe('avatarTint', () => {
  it('is stable for one id, and is always 1 to 8', () => {
    expect(avatarTint('user-42')).toBe(avatarTint('user-42'));
    for (let i = 0; i < 200; i += 1) {
      const t = avatarTint(`u${i}`);
      expect(t).toBeGreaterThanOrEqual(1);
      expect(t).toBeLessThanOrEqual(8);
    }
  });

  it('spreads users across the eight tints', () => {
    const seen = new Set();
    for (let i = 0; i < 200; i += 1) seen.add(avatarTint(`user-${i}`));
    expect(seen.size).toBe(8);
  });
});

describe('Avatar', () => {
  it('shows the uppercase initial of the name on its tint, in the dark ink', () => {
    const { container } = render(<Avatar id={7} name="ada lovelace" size={24} />);
    const el = container.querySelector('.avatar');
    expect(el.textContent).toBe('A');
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.style.background).toBe(`var(--avatar-${avatarTint(7)})`);
    expect(el.getAttribute('data-size')).toBe('24');
  });

  it('shows ? when there is no name', () => {
    const { container } = render(<Avatar id={1} />);
    expect(container.querySelector('.avatar').textContent).toBe('?');
  });

  it('shows the photo when there is one', () => {
    const { container } = render(<Avatar id={1} name="Kyle" src="/avatars/1.png" />);
    const img = container.querySelector('img.avatar');
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe('/avatars/1.png');
    expect(img.getAttribute('alt')).toBe('');
  });
});
