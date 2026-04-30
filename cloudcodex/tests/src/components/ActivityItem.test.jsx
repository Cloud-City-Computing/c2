/**
 * Cloud Codex — Tests for src/components/ActivityItem.jsx
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ActivityItem from '../../../src/components/ActivityItem.jsx';

const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('ActivityItem', () => {
  it('renders the actor name, action verb, and resource link', () => {
    wrap(<ActivityItem entry={{
      id: 1,
      actor_name: 'Alice',
      action: 'log.create',
      resource_type: 'log',
      resource_id: 42,
      metadata: { title: 'Hello' },
      created_at: new Date().toISOString(),
    }} />);

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('created')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Hello' });
    expect(link.getAttribute('href')).toBe('/editor/42');
  });

  it('handles a JSON-string metadata field', () => {
    wrap(<ActivityItem entry={{
      id: 1,
      actor_name: 'Bob',
      action: 'log.publish',
      resource_type: 'log',
      resource_id: 7,
      metadata: JSON.stringify({ title: 'Doc7' }),
      created_at: new Date().toISOString(),
    }} />);
    expect(screen.getByText('published')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Doc7' })).toBeInTheDocument();
  });

  it('falls back to "Someone" when actor_name is missing', () => {
    wrap(<ActivityItem entry={{
      id: 1, action: 'log.update', resource_type: 'log', resource_id: 1,
      metadata: {}, created_at: new Date().toISOString(),
    }} />);
    expect(screen.getByText('Someone')).toBeInTheDocument();
  });

  it('uses the raw action string as verb for unknown actions', () => {
    wrap(<ActivityItem entry={{
      id: 1, actor_name: 'A', action: 'mystery.event',
      resource_type: 'log', resource_id: 1, metadata: {}, created_at: new Date().toISOString(),
    }} />);
    expect(screen.getByText('mystery.event')).toBeInTheDocument();
  });

  it('renders archive resource type with /archives URL', () => {
    wrap(<ActivityItem entry={{
      id: 1, actor_name: 'A', action: 'archive.create',
      resource_type: 'archive', resource_id: 9, metadata: { name: 'Inbox' },
      created_at: new Date().toISOString(),
    }} />);
    const link = screen.getByRole('link', { name: 'Inbox' });
    expect(link.getAttribute('href')).toBe('/archives/9');
  });

  it('renders comment resource with deep link including hash', () => {
    wrap(<ActivityItem entry={{
      id: 1, actor_name: 'A', action: 'comment.create',
      resource_type: 'comment', resource_id: 99, metadata: { log_id: 7, snippet: 'hi' },
      created_at: new Date().toISOString(),
    }} />);
    const link = screen.getByRole('link', { name: /hi/ });
    expect(link.getAttribute('href')).toBe('/editor/7#comment-99');
  });

  it('falls back to a span for unknown resource_type', () => {
    const { container } = wrap(<ActivityItem entry={{
      id: 1, actor_name: 'A', action: 'foo',
      resource_type: 'mystery', resource_id: 5, metadata: {}, created_at: new Date().toISOString(),
    }} />);
    // No <a> for resource — only the actor avatar (no link)
    expect(container.querySelectorAll('a').length).toBe(0);
    expect(screen.getByText(/mystery #5/)).toBeInTheDocument();
  });

  it('uses an avatar image when actor_avatar is set, placeholder otherwise', () => {
    const { container, rerender } = wrap(<ActivityItem entry={{
      id: 1, actor_name: 'A', action: 'log.update', resource_type: 'log', resource_id: 1,
      metadata: {}, created_at: new Date().toISOString(),
      actor_avatar: 'https://x/a.png',
    }} />);
    expect(container.querySelector('img.activity-item__avatar')).not.toBeNull();

    rerender(<MemoryRouter><ActivityItem entry={{
      id: 1, actor_name: 'A', action: 'log.update', resource_type: 'log', resource_id: 1,
      metadata: {}, created_at: new Date().toISOString(),
    }} /></MemoryRouter>);
    expect(container.querySelector('.activity-item__avatar--placeholder')).not.toBeNull();
  });
});
