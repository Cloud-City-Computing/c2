/**
 * Cloud Codex — Tests for ExploreCard (src/components/ExploreBrowser.jsx)
 *
 * Covers B13: the card title has to be a real link, not a click-only heading,
 * so a document can be opened from the browse grid without a mouse.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Keep the real docUrl so the href assertions pin the actual URL contract;
// stub only the network calls the module reaches for.
vi.mock('../../../src/util.jsx', async () => {
  const actual = await vi.importActual('../../../src/util.jsx');
  return {
    ...actual,
    browseLogs: vi.fn(async () => ({ results: [], total: 0, totalPages: 0 })),
    searchLogs: vi.fn(async () => ({ results: [], total: 0, totalPages: 0 })),
    fetchFavorites: vi.fn(async () => ({ results: [] })),
    fetchSearchFilters: vi.fn(async () => ({ workspaces: [], squads: [], archives: [] })),
    addFavorite: vi.fn(async () => ({})),
    removeFavorite: vi.fn(async () => ({})),
  };
});
vi.mock('../../../src/hooks/usePresence', () => ({
  default: () => ({ getLogUsers: () => [] }),
}));

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ExploreCard } from '../../../src/components/ExploreBrowser.jsx';

const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

const ITEM = { id: 42, title: 'Runbook', archive_id: 7, created_at: '2026-01-01T00:00:00Z' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ExploreCard', () => {
  it('renders the title as a link to the document in its archive', () => {
    wrap(<ExploreCard item={ITEM} onClick={vi.fn()} activeUsers={[]} />);
    const link = screen.getByRole('link', { name: 'Runbook' });
    expect(link.getAttribute('href')).toBe('/archives/7/doc/42');
  });

  it('falls back to the standalone editor URL when the document has no archive', () => {
    wrap(<ExploreCard item={{ id: 42, title: 'Loose' }} onClick={vi.fn()} activeUsers={[]} />);
    expect(screen.getByRole('link', { name: 'Loose' }).getAttribute('href')).toBe('/editor/42');
  });

  it('the title link is reachable by Tab', async () => {
    const user = userEvent.setup();
    wrap(<ExploreCard item={ITEM} onClick={vi.fn()} activeUsers={[]} />);
    const link = screen.getByRole('link', { name: 'Runbook' });
    await user.tab();
    expect(document.activeElement).toBe(link);
  });

  it('activating the link does not also fire the card click, so the document opens once', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    wrap(<ExploreCard item={ITEM} onClick={onClick} activeUsers={[]} />);
    await user.click(screen.getByRole('link', { name: 'Runbook' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('the card itself stays clickable for mouse users', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    const { container } = wrap(<ExploreCard item={ITEM} onClick={onClick} activeUsers={[]} />);
    await user.click(container.querySelector('.explore-card__meta'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('the favourite button is separate from the title link', async () => {
    const onToggleFavorite = vi.fn();
    const onClick = vi.fn();
    const user = userEvent.setup();
    wrap(
      <ExploreCard item={ITEM} onClick={onClick} activeUsers={[]}
        isFavorited={false} onToggleFavorite={onToggleFavorite} />
    );
    // Queried by title, not by accessible name: the button's name is the bare
    // glyph "☆". That is a separate defect, filed as B15.
    await user.click(screen.getByTitle('Add to favorites'));
    expect(onToggleFavorite).toHaveBeenCalledWith(42);
    expect(onClick).not.toHaveBeenCalled();
  });
});
