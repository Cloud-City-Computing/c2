/**
 * Cloud Codex - The phone strip collapses the Archives group to one item (W6-CDX-40 review, item 5)
 *
 * The strip's rule is read from the real stylesheet and matched with jsdom's own selector engine against the
 * rendered sidebar, so a selector that names no element fails here. With twelve archives, every archive item but
 * the first (All archives) must match the hiding rule.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { archiveState } = vi.hoisted(() => ({ archiveState: { archives: [] } }));
vi.mock('../../../src/util.jsx', () => ({
  apiFetch: vi.fn((method, url) => (url === '/api/archives'
    ? Promise.resolve({ success: true, archives: archiveState.archives })
    : Promise.resolve({}))),
}));
vi.mock('../../../src/hooks/useNotificationChannel.js', () => ({
  default: () => ({ unreadCount: 0, recent: [], markRead: vi.fn(), markAllRead: vi.fn() }),
}));
vi.mock('../../../src/hooks/useGitHubStatus.jsx', () => ({
  default: () => ({ connected: false }),
  GitHubStatusProvider: ({ children }) => children,
}));

import Sidebar from '../../../src/components/Sidebar.jsx';

const CSS = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../src/index.css'), 'utf8');

/** The selectors of every rule in the 599 px block that hides an element (display: none). */
function phoneHidingSelectors() {
  const start = CSS.indexOf('@media (max-width: 599px) {');
  expect(start, 'the 599 px phone block exists').toBeGreaterThan(-1);
  const body = CSS.slice(start, CSS.indexOf('\n}\n', start));
  const selectors = [];
  for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/display:\s*none/.test(m[2].replace(/\s+/g, ''))) selectors.push(...m[1].split(',').map((s) => s.trim()));
  }
  return selectors;
}

describe('the phone strip with twelve archives', () => {
  it('hides every archive item after All archives, by a selector that matches them', async () => {
    archiveState.archives = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: `Archive ${i + 1}` }));
    const { container } = render(
      <MemoryRouter>
        <Sidebar user={{ id: 1, name: 'Alice' }} suite={{ enabled: false, name: null, commandWorkspaceUrl: null }} isAdmin={false} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(container.querySelectorAll('.sidebar__group li').length).toBe(13));
    const hidden = phoneHidingSelectors();
    const matchesHidingRule = (el) => hidden.some((sel) => {
      try { return el.matches(sel); } catch { return false; }
    });
    const items = [...container.querySelectorAll('.sidebar__group li')];
    // All archives (the first item) stays; the other twelve are hidden on the strip.
    expect(matchesHidingRule(items[0])).toBe(false);
    expect(items.slice(1).filter(matchesHidingRule).length).toBe(12);
  });
});
