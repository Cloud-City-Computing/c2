/**
 * Cloud Codex - the activity and notification avatars are keyed on the actor's id (W6-CDX-39, momus 6).
 * Two users with the same name must not share a tint: the tint is a hash of the id, not of the name.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ActivityItem from '../../../src/components/ActivityItem.jsx';
import NotificationItem from '../../../src/components/NotificationItem.jsx';
import { avatarTint } from '../../../src/lib/avatar-tint.js';

// Two ids that hash to different tints, so the assertion is not a coincidence of the hash.
const [FIRST, SECOND] = (() => {
  for (let a = 1; a < 50; a += 1) {
    for (let b = a + 1; b < 50; b += 1) {
      if (avatarTint(a) !== avatarTint(b)) return [a, b];
    }
  }
  throw new Error('no pair');
})();

const bg = (container) => container.querySelector('.avatar').style.background;

describe('avatars are keyed on the actor id', () => {
  it('gives two activity actors with one name different tints, from their ids', () => {
    const entry = (userId) => ({
      id: userId, user_id: userId, actor_name: 'Sam', action: 'log.update', resource_type: 'log',
      resource_id: 1, metadata: {}, created_at: new Date().toISOString(),
    });
    const a = render(<MemoryRouter><ActivityItem entry={entry(FIRST)} /></MemoryRouter>);
    const b = render(<MemoryRouter><ActivityItem entry={entry(SECOND)} /></MemoryRouter>);
    expect(bg(a.container)).toBe(`var(--avatar-${avatarTint(FIRST)})`);
    expect(bg(b.container)).toBe(`var(--avatar-${avatarTint(SECOND)})`);
    expect(bg(a.container)).not.toBe(bg(b.container));
  });

  it('gives two notification actors with one name different tints, from their ids', () => {
    const notif = (actorId) => ({
      id: actorId, actor_id: actorId, actor_name: 'Sam', type: 'mention', title: 'Mentioned',
      body: '', link_url: '/', created_at: new Date().toISOString(), read_at: null,
    });
    const a = render(<MemoryRouter><NotificationItem notification={notif(FIRST)} onActivate={() => {}} /></MemoryRouter>);
    const b = render(<MemoryRouter><NotificationItem notification={notif(SECOND)} onActivate={() => {}} /></MemoryRouter>);
    expect(bg(a.container)).toBe(`var(--avatar-${avatarTint(FIRST)})`);
    expect(bg(b.container)).not.toBe(bg(a.container));
  });
});
