/**
 * Cloud Codex — Tests for src/components/PageTree.jsx
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { utilMock, navigateMock } = vi.hoisted(() => ({
  utilMock: { fetchLogs: vi.fn(), showModal: vi.fn() },
  navigateMock: vi.fn(),
}));

vi.mock('../../../src/util.jsx', () => utilMock);
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import PageTree from '../../../src/components/PageTree.jsx';

const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(() => {
  utilMock.fetchLogs.mockReset();
  utilMock.showModal.mockReset();
  navigateMock.mockReset();
});

describe('PageTree', () => {
  it('shows Loading... initially', () => {
    utilMock.fetchLogs.mockReturnValueOnce(new Promise(() => {}));
    wrap(<PageTree archiveId={1} archiveName="A" onSelect={vi.fn()} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows the empty state when there are no logs', async () => {
    utilMock.fetchLogs.mockResolvedValueOnce({ logs: [] });
    wrap(<PageTree archiveId={1} archiveName="A" onSelect={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/no pages yet/i)).toBeInTheDocument());
  });

  it('renders nested logs with toggle controls', async () => {
    utilMock.fetchLogs.mockResolvedValueOnce({
      logs: [
        { id: 1, title: 'Parent', children: [{ id: 2, title: 'Child', children: [] }] },
      ],
    });

    wrap(<PageTree archiveId={1} archiveName="A" onSelect={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Parent')).toBeInTheDocument());
    expect(screen.getByText('Child')).toBeInTheDocument();
  });

  it('clicking a row calls onSelect with the log id', async () => {
    utilMock.fetchLogs.mockResolvedValueOnce({
      logs: [{ id: 7, title: 'Hello', children: [] }],
    });
    const onSelect = vi.fn();
    const user = userEvent.setup();
    wrap(<PageTree archiveId={1} archiveName="A" onSelect={onSelect} />);
    await waitFor(() => expect(screen.getByText('Hello')).toBeInTheDocument());
    await user.click(screen.getByText('Hello'));
    expect(onSelect).toHaveBeenCalledWith(7);
  });

  // B13: the title used to be a plain <span>, so a document could only be
  // opened with a mouse. These two fail against that version.
  it('exposes the page title as an actionable node named after the document', async () => {
    utilMock.fetchLogs.mockResolvedValueOnce({
      logs: [{ id: 7, title: 'Hello', children: [] }],
    });
    wrap(<PageTree archiveId={1} archiveName="A" onSelect={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Hello' })).toBeInTheDocument();
  });

  it('the page title is reachable by Tab and opens the page on Enter', async () => {
    utilMock.fetchLogs.mockResolvedValueOnce({
      logs: [{ id: 7, title: 'Hello', children: [] }],
    });
    const onSelect = vi.fn();
    const user = userEvent.setup();
    wrap(<PageTree archiveId={1} archiveName="A" onSelect={onSelect} />);
    const title = await screen.findByRole('button', { name: 'Hello' });

    // Walk the real tab order rather than calling .focus(), so a non-tabbable
    // element (the old <span>) cannot pass this.
    let reached = false;
    for (let i = 0; i < 10 && !reached; i++) {
      await user.tab();
      reached = document.activeElement === title;
    }
    expect(reached).toBe(true);

    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(7);
  });

  it('activating the title selects the page exactly once', async () => {
    utilMock.fetchLogs.mockResolvedValueOnce({
      logs: [{ id: 7, title: 'Hello', children: [] }],
    });
    const onSelect = vi.fn();
    const user = userEvent.setup();
    wrap(<PageTree archiveId={1} archiveName="A" onSelect={onSelect} />);
    await user.click(await screen.findByRole('button', { name: 'Hello' }));
    // The row keeps its own onClick for mouse users; the title button stops
    // propagation so the click is not counted twice.
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('marks the active log with the active class', async () => {
    utilMock.fetchLogs.mockResolvedValueOnce({
      logs: [{ id: 5, title: 'Active', children: [] }],
    });
    const { container } = wrap(<PageTree archiveId={1} archiveName="A" activeLogId={5} onSelect={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Active')).toBeInTheDocument());
    expect(container.querySelector('.page-tree-row--active')).not.toBeNull();
  });

  it('toggle button collapses children', async () => {
    utilMock.fetchLogs.mockResolvedValueOnce({
      logs: [{ id: 1, title: 'Parent', children: [{ id: 2, title: 'Hidden', children: [] }] }],
    });
    const user = userEvent.setup();
    wrap(<PageTree archiveId={1} archiveName="A" onSelect={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Hidden')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '▾' }));
    expect(screen.queryByText('Hidden')).toBeNull();
  });

  it('back button navigates to /archives/:id', async () => {
    utilMock.fetchLogs.mockResolvedValueOnce({ logs: [] });
    const user = userEvent.setup();
    wrap(<PageTree archiveId={3} archiveName="A" onSelect={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/no pages yet/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '←' }));
    expect(navigateMock).toHaveBeenCalledWith('/archives/3');
  });

  it('back URL preserves squad and workspace context when archive belongs to a squad', async () => {
    utilMock.fetchLogs.mockResolvedValueOnce({ logs: [] });
    const user = userEvent.setup();
    wrap(<PageTree
      archiveId={3}
      archiveName="A"
      archiveMeta={{ squadId: 9, workspaceId: 4 }}
      onSelect={vi.fn()}
    />);
    await waitFor(() => expect(screen.getByText(/no pages yet/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '←' }));
    expect(navigateMock).toHaveBeenCalledWith('/archives/3?squad=9&workspace=4');
  });

  it('"+" button opens the new-log modal via showModal', async () => {
    utilMock.fetchLogs.mockResolvedValueOnce({ logs: [] });
    const user = userEvent.setup();
    wrap(<PageTree archiveId={1} archiveName="A" onSelect={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/no pages yet/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '+' }));
    expect(utilMock.showModal).toHaveBeenCalled();
  });

  it('renders a GitHub badge for logs linked to a repo file', async () => {
    utilMock.fetchLogs.mockResolvedValueOnce({
      logs: [{
        id: 1,
        title: 'Linked',
        children: [],
        gh_owner: 'octocat',
        gh_repo: 'hello',
        gh_branch: 'main',
        gh_path: 'README.md',
      }],
    });
    const { container } = wrap(<PageTree archiveId={1} archiveName="A" onSelect={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Linked')).toBeInTheDocument());
    const badge = container.querySelector('.gh-doc-badge');
    expect(badge.getAttribute('href')).toBe('https://github.com/octocat/hello/blob/main/README.md');
  });

  it('Collapse button is shown when onCollapse is provided', async () => {
    utilMock.fetchLogs.mockResolvedValueOnce({ logs: [] });
    const onCollapse = vi.fn();
    const user = userEvent.setup();
    wrap(<PageTree archiveId={1} archiveName="A" onSelect={vi.fn()} onCollapse={onCollapse} />);
    await waitFor(() => expect(screen.getByText(/no pages yet/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '◂' }));
    expect(onCollapse).toHaveBeenCalled();
  });
});
