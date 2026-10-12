/**
 * Cloud Codex - the archive list is rows, and its actions live in a More actions menu (W6-CDX-41, Task 4.1)
 *
 * No list renders a per-row danger button (X9): Delete is a menu item, flagged danger, and its confirmation is the
 * destructive-copy archiveDelete sentence. The page header holds the one primary (New Archive). An empty archive list
 * and an empty document tree each render the one empty-state component.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { utilMock } = vi.hoisted(() => ({
  utilMock: {
    fetchArchives: vi.fn(),
    createArchive: vi.fn(),
    updateArchive: vi.fn(),
    deleteArchive: vi.fn(async () => ({})),
    fetchLogs: vi.fn(async () => ({ logs: [] })),
    deleteLog: vi.fn(async () => ({})),
    manageArchiveAccess: vi.fn(),
    manageArchiveSquadAccess: vi.fn(),
    manageArchiveWorkspaceAccess: vi.fn(),
    fetchArchiveAccess: vi.fn(async () => ({ data: null })),
    searchUsers: vi.fn(),
    uploadDocument: vi.fn(),
    exportDocument: vi.fn(),
    fetchDocument: vi.fn(),
    fetchCommentCount: vi.fn(async () => ({ count: 0 })),
    fetchArchiveRepos: vi.fn(async () => ({ repos: [] })),
    linkArchiveRepo: vi.fn(),
    unlinkArchiveRepo: vi.fn(),
    importArchiveRepo: vi.fn(),
    showModal: vi.fn(),
    destroyModal: vi.fn(),
    apiFetch: vi.fn(async () => ({})),
  },
}));

vi.mock('../../../src/util.jsx', () => utilMock);
vi.mock('../../../src/hooks/usePresence', () => ({
  default: () => ({ getLogUsers: () => [] }),
}));
vi.mock('../../../src/hooks/useGitHubStatus.jsx', () => ({
  default: () => ({ connected: false }),
}));

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ArchiveBrowser from '../../../src/components/ArchiveBrowser.jsx';

const ARCHIVES = [
  {
    id: 1, name: 'Release Planning', created_by: 'wedge', created_at: '2026-10-11T00:00:00Z',
    squad_id: 7, squad_name: 'General', workspace_id: 3, log_count: 4,
  },
  {
    id: 2, name: 'Design Notes', created_by: 'ada', created_at: '2026-10-10T00:00:00Z',
    squad_id: null, squad_name: null, workspace_id: null, log_count: 0,
  },
];

function renderList() {
  return render(<MemoryRouter><ArchiveBrowser /></MemoryRouter>);
}

describe('the archive list (X9)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    utilMock.fetchArchives.mockResolvedValue({ archives: ARCHIVES });
  });

  it('renders no per-row danger button: Delete is only a menu item', async () => {
    const { container } = renderList();
    await waitFor(() => expect(screen.getByText('Release Planning')).toBeInTheDocument());
    const rows = container.querySelectorAll('.archive-row');
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.querySelector('.btn-danger')).toBeNull();
  });

  it('gives each row a More actions menu with Rename, Manage access and Delete', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Release Planning')).toBeInTheDocument());
    const [first] = screen.getAllByRole('button', { name: /^More actions for / });
    await userEvent.click(first);
    const menu = screen.getByRole('menu', { name: 'More actions for Release Planning' });
    const names = within(menu).getAllByRole('menuitem').map((i) => i.textContent);
    expect(names).toEqual(['Go to squad', 'Rename', 'Manage access', 'Delete']);
    expect(within(menu).getByRole('menuitem', { name: 'Delete' })).toHaveClass('menu__item--danger');
  });

  it('omits Go to squad for an archive with no squad', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Design Notes')).toBeInTheDocument());
    const buttons = screen.getAllByRole('button', { name: /^More actions for / });
    await userEvent.click(buttons[1]);
    const menu = screen.getByRole('menu', { name: 'More actions for Design Notes' });
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Rename', 'Manage access', 'Delete']);
  });

  it('shows the squad, owner and document count on each row', async () => {
    const { container } = renderList();
    await waitFor(() => expect(screen.getByText('Release Planning')).toBeInTheDocument());
    const row = container.querySelector('.archive-row');
    expect(row.querySelector('.archive-row__squad')).toHaveTextContent('General');
    expect(row.querySelector('.archive-row__owner')).toHaveTextContent('wedge');
    expect(row.querySelector('.archive-row__count')).toHaveTextContent('4 documents');
  });

  it('shows the created date on each row, as the card did', async () => {
    const { container } = renderList();
    await waitFor(() => expect(screen.getByText('Release Planning')).toBeInTheDocument());
    const created = container.querySelector('.archive-row .archive-row__created');
    expect(created).toHaveTextContent(new Date('2026-10-11T00:00:00Z').toLocaleDateString());
  });

  it('says a missing document count is unavailable, never zero', async () => {
    utilMock.fetchArchives.mockResolvedValueOnce({
      archives: [{ id: 3, name: 'Legacy', created_by: 'ada', created_at: '2026-10-01T00:00:00Z', squad_id: null, squad_name: null, workspace_id: null }],
    });
    const { container } = renderList();
    await waitFor(() => expect(screen.getByText('Legacy')).toBeInTheDocument());
    const count = container.querySelector('.archive-row__count');
    expect(count).toHaveTextContent('Count unavailable');
    expect(count).not.toHaveTextContent('0 documents');
  });

  it('is the header primary: exactly one .btn-primary on the page header', async () => {
    const { container } = renderList();
    await waitFor(() => expect(screen.getByText('Release Planning')).toBeInTheDocument());
    const header = container.querySelector('.page-header');
    expect(header).not.toBeNull();
    expect(header.querySelectorAll('.btn-primary')).toHaveLength(1);
    expect(header.querySelector('h1')).toHaveTextContent('Archives');
  });

  it('asks before Delete, with the archiveDelete sentence, and deletes only on confirm', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Release Planning')).toBeInTheDocument());
    await userEvent.click(screen.getAllByRole('button', { name: /^More actions for / })[0]);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(utilMock.deleteArchive).not.toHaveBeenCalled();
    expect(utilMock.showModal).toHaveBeenCalledTimes(1);
    const dialog = utilMock.showModal.mock.calls[0][0];
    expect(dialog.props.title).toBe('Delete archive?');
    expect(dialog.props.message).toContain('"Release Planning" and all its documents');
    await dialog.props.onConfirm();
    expect(utilMock.deleteArchive).toHaveBeenCalledWith(1);
  });

  it('renders the one empty state when there are no archives', async () => {
    utilMock.fetchArchives.mockResolvedValueOnce({ archives: [] });
    const { container } = renderList();
    await waitFor(() => expect(container.querySelector('.empty-state')).not.toBeNull());
    expect(container.querySelector('.empty-state')).toHaveTextContent('No archives yet');
    expect(container.querySelector('.archive-row')).toBeNull();
  });

  it('renders the empty state for an expanded archive with no documents', async () => {
    const { container } = renderList();
    await waitFor(() => expect(screen.getByText('Design Notes')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Design Notes'));
    await waitFor(() => expect(container.querySelector('.log-tree .empty-state')).not.toBeNull());
    expect(container.querySelector('.log-tree .empty-state')).toHaveTextContent('No documents yet');
  });
});
