/**
 * Cloud Codex — Tests for LogTreeItem (src/components/ArchiveBrowser.jsx)
 *
 * Covers B13: the log title in the archive tree has to be a real link, not a
 * click-only <span>, so a document can be opened without a mouse.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { utilMock } = vi.hoisted(() => ({
  utilMock: {
    fetchCommentCount: vi.fn(async () => ({ count: 0 })),
    exportDocument: vi.fn(async () => ({})),
    fetchDocument: vi.fn(async () => ({ document: { html_content: '' } })),
    deleteLog: vi.fn(async () => ({})),
    showModal: vi.fn(),
    destroyModal: vi.fn(),
    apiFetch: vi.fn(async () => ({})),
    fetchArchives: vi.fn(async () => ({ archives: [] })),
    createArchive: vi.fn(),
    updateArchive: vi.fn(),
    deleteArchive: vi.fn(),
    fetchLogs: vi.fn(async () => ({ logs: [] })),
    manageArchiveAccess: vi.fn(),
    manageArchiveSquadAccess: vi.fn(),
    manageArchiveWorkspaceAccess: vi.fn(),
    fetchArchiveAccess: vi.fn(),
    searchUsers: vi.fn(),
    uploadDocument: vi.fn(),
    fetchArchiveRepos: vi.fn(async () => ({ repos: [] })),
    linkArchiveRepo: vi.fn(),
    unlinkArchiveRepo: vi.fn(),
    importArchiveRepo: vi.fn(),
  },
}));

vi.mock('../../../src/util.jsx', () => utilMock);
vi.mock('../../../src/hooks/usePresence', () => ({
  default: () => ({ getLogUsers: () => [] }),
}));
vi.mock('../../../src/hooks/useGitHubStatus.jsx', () => ({
  default: () => ({ connected: false }),
}));

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LogTreeItem } from '../../../src/components/ArchiveBrowser.jsx';

const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

const renderItem = (log = { id: 12, title: 'Onboarding' }) =>
  wrap(
    <ul>
      <LogTreeItem log={log} archiveId={3} getLogUsers={() => []} />
    </ul>
  );

beforeEach(() => {
  Object.values(utilMock).forEach((fn) => typeof fn?.mockReset === 'function' && fn.mockReset());
  utilMock.fetchCommentCount.mockResolvedValue({ count: 0 });
});

describe('LogTreeItem', () => {
  it('renders the log title as a link to the document', async () => {
    renderItem();
    const link = await screen.findByRole('link', { name: 'Onboarding' });
    expect(link.getAttribute('href')).toBe('/archives/3/doc/12');
  });

  it('the title link is reachable by Tab', async () => {
    const user = userEvent.setup();
    renderItem();
    const link = await screen.findByRole('link', { name: 'Onboarding' });

    // Walk the real tab order; a <span> would never receive focus this way.
    let reached = false;
    for (let i = 0; i < 10 && !reached; i++) {
      await user.tab();
      reached = document.activeElement === link;
    }
    expect(reached).toBe(true);
  });

  it('keeps the GitHub badge as a separate link when the log is linked', async () => {
    renderItem({
      id: 12, title: 'Onboarding',
      gh_owner: 'octocat', gh_repo: 'hello', gh_branch: 'main', gh_path: 'README.md',
    });
    await waitFor(() => expect(screen.getByRole('link', { name: 'Onboarding' })).toBeInTheDocument());
    const badge = screen.getByTitle('octocat/hello/README.md');
    expect(badge.getAttribute('href')).toBe('https://github.com/octocat/hello/blob/main/README.md');
  });

  // B15: add, comments, delete and export all announced as bare glyphs
  // ("+", "💬", "×", "⤓"), repeated once per row, so a screen-reader user
  // could not tell which document any of them belonged to.
  it('names every per-document control after the document', async () => {
    renderItem();
    await screen.findByRole('link', { name: 'Onboarding' });

    expect(screen.getByRole('button', { name: 'Add a sublog under Onboarding' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage comments on Onboarding' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Onboarding' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export Onboarding' })).toBeInTheDocument();

    for (const glyph of ['+', '\u00d7', '\u2913']) {
      expect(screen.queryByRole('button', { name: glyph })).toBeNull();
    }
  });
});
