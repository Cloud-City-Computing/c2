/**
 * Cloud Codex - the document header (W6-CDX-41, Task 4.1)
 *
 * The header above the editor canvas: the title (the page's h1), the meta line in faint text with the author's name
 * and never the email (the email is for the GitHub and admin surfaces, not a document's byline), star and watch as
 * icon buttons with accessible names, and Edit as the header's one primary in read mode.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import DocumentHeader from '../../../src/components/DocumentHeader.jsx';

const DOC = {
  id: 5,
  title: 'Q3 plan',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  version: 3,
  created_at: '2026-10-01T10:00:00Z',
  archive_id: 1,
  archive_name: 'Release Planning',
};

function renderHeader(props = {}) {
  const handlers = {
    onEdit: vi.fn(),
    onToggleFavorite: vi.fn(),
    onToggleWatch: vi.fn(),
    onStartTitleEdit: vi.fn(),
  };
  const { container } = render(
    <MemoryRouter>
      <DocumentHeader
        doc={DOC}
        viewMode="read"
        canEdit
        isFavorited={false}
        watching={false}
        {...handlers}
        {...props}
      />
    </MemoryRouter>,
  );
  return { container, ...handlers };
}

describe('the document header', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows the author by name in the faint meta line, never the email', () => {
    const { container } = renderHeader();
    const meta = container.querySelector('.page-header__meta');
    expect(meta).toHaveTextContent('Ada Lovelace');
    expect(container.textContent).not.toContain('ada@example.com');
  });

  it('renders the title as the page h1', () => {
    const { container } = renderHeader();
    expect(container.querySelector('h1.page-header__title')).toHaveTextContent('Q3 plan');
  });

  it('has exactly one primary button in read mode, and it is Edit', async () => {
    const { container, onEdit } = renderHeader();
    const primaries = container.querySelectorAll('.btn-primary');
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toHaveTextContent('Edit');
    await userEvent.click(primaries[0]);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('has no primary button in edit mode, where Save sits in the editor toolbar', () => {
    const { container } = renderHeader({ viewMode: 'edit' });
    expect(container.querySelectorAll('.btn-primary')).toHaveLength(0);
  });

  it('names star and watch as icon buttons, with their state', async () => {
    const { onToggleFavorite, onToggleWatch } = renderHeader();
    const star = screen.getByRole('button', { name: 'Add to favorites' });
    expect(star).toHaveAttribute('aria-pressed', 'false');
    expect(star.querySelector('svg')).not.toBeNull();
    await userEvent.click(star);
    expect(onToggleFavorite).toHaveBeenCalledTimes(1);
    const watch = screen.getByRole('button', { name: 'Watch this document' });
    expect(watch).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(watch);
    expect(onToggleWatch).toHaveBeenCalledTimes(1);
  });

  it('reflects a favorited and watched document in the icon buttons', () => {
    renderHeader({ isFavorited: true, watching: true });
    expect(screen.getByRole('button', { name: 'Remove from favorites' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Stop watching this document' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps the rename-on-click title in edit mode', () => {
    const { container, onStartTitleEdit } = renderHeader({ viewMode: 'edit' });
    const title = container.querySelector('h1.page-header__title .editor-title');
    expect(title).toHaveAttribute('title', 'Click to rename');
    fireEvent.click(title);
    expect(onStartTitleEdit).toHaveBeenCalledTimes(1);
  });
});
