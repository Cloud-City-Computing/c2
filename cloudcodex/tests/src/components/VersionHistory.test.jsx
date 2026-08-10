/**
 * Cloud Codex — Tests for src/components/editor/VersionHistory.jsx
 *
 * Extracted from Editor.jsx by E2. Restore and delete are destructive, and
 * neither had any frontend coverage while this lived inside the page.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { utilMock, toastMock } = vi.hoisted(() => ({
  utilMock: {
    fetchVersions: vi.fn(),
    fetchVersion: vi.fn(),
    restoreVersion: vi.fn(),
    deleteVersion: vi.fn(),
    timeAgo: vi.fn(() => '2 days ago'),
  },
  toastMock: { toastError: vi.fn() },
}));

vi.mock('../../../src/util.jsx', () => utilMock);
vi.mock('../../../src/components/Toast.jsx', () => toastMock);

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VersionHistory from '../../../src/components/editor/VersionHistory.jsx';

const VERSIONS = [
  { id: 1, version_number: 2, title: 'Second cut', notes: 'after review', saved_at: '2026-01-02', created_by: 'alice' },
  { id: 2, version_number: 1, saved_at: '2026-01-01' },
];

beforeEach(() => {
  Object.values(utilMock).forEach((fn) => typeof fn?.mockReset === 'function' && fn.mockReset());
  toastMock.toastError.mockReset();
  utilMock.timeAgo.mockReturnValue('2 days ago');
  utilMock.fetchVersions.mockResolvedValue({ versions: VERSIONS });
});

describe('VersionHistory', () => {
  it('shows a loading state, then the versions', async () => {
    utilMock.fetchVersions.mockReturnValueOnce(new Promise(() => {}));
    render(<VersionHistory logId={5} />);
    expect(screen.getByText(/loading history/i)).toBeInTheDocument();
  });

  it('shows the empty state when there are no versions', async () => {
    utilMock.fetchVersions.mockResolvedValueOnce({ versions: [] });
    render(<VersionHistory logId={5} />);
    expect(await screen.findByText(/no previous versions/i)).toBeInTheDocument();
  });

  it('falls back to a numbered label when a version has no title', async () => {
    render(<VersionHistory logId={5} />);
    expect(await screen.findByText('Second cut')).toBeInTheDocument();
    expect(screen.getByText('Version 1')).toBeInTheDocument();
  });

  it('renders the empty state rather than throwing when the fetch fails', async () => {
    utilMock.fetchVersions.mockRejectedValueOnce(new Error('500'));
    render(<VersionHistory logId={5} />);
    expect(await screen.findByText(/no previous versions/i)).toBeInTheDocument();
  });

  it('reloads when versionKey changes, which is how a publish refreshes the list', async () => {
    const { rerender } = render(<VersionHistory logId={5} versionKey={0} />);
    await screen.findByText('Second cut');
    expect(utilMock.fetchVersions).toHaveBeenCalledTimes(1);

    rerender(<VersionHistory logId={5} versionKey={1} />);
    await waitFor(() => expect(utilMock.fetchVersions).toHaveBeenCalledTimes(2));
  });

  it('opens a preview on click and closes it on a second click', async () => {
    utilMock.fetchVersion.mockResolvedValue({
      version: { id: 1, version_number: 2, title: 'Second cut', saved_at: '2026-01-02', html_content: '<p>body</p>' },
    });
    const user = userEvent.setup();
    const { container } = render(<VersionHistory logId={5} />);
    await screen.findByText('Second cut');

    await user.click(container.querySelector('.version-list__info'));
    await waitFor(() => expect(container.querySelector('.version-preview')).not.toBeNull());
    expect(utilMock.fetchVersion).toHaveBeenCalledWith(5, 1);

    await user.click(container.querySelector('.version-list__info'));
    await waitFor(() => expect(container.querySelector('.version-preview')).toBeNull());
  });

  it('sanitizes preview content instead of injecting it raw', async () => {
    utilMock.fetchVersion.mockResolvedValue({
      version: { id: 1, version_number: 2, saved_at: '2026-01-02', html_content: '<p>ok</p><script>alert(1)</script>' },
    });
    const user = userEvent.setup();
    const { container } = render(<VersionHistory logId={5} />);
    await screen.findByText('Second cut');
    await user.click(container.querySelector('.version-list__info'));

    const preview = await waitFor(() => {
      const el = container.querySelector('.version-preview__content');
      expect(el).not.toBeNull();
      return el;
    });
    expect(preview.querySelector('script')).toBeNull();
    expect(preview.textContent).toContain('ok');
  });

  it('restores a version and tells the editor, without opening the preview', async () => {
    utilMock.restoreVersion.mockResolvedValue({});
    const onRestore = vi.fn();
    const user = userEvent.setup();
    render(<VersionHistory logId={5} onRestore={onRestore} />);
    await screen.findByText('Second cut');

    await user.click(screen.getByRole('button', { name: 'Restore Second cut' }));
    await waitFor(() => expect(utilMock.restoreVersion).toHaveBeenCalledWith(5, 1));
    expect(onRestore).toHaveBeenCalled();
    // The row click must not also have fired and opened a preview.
    expect(utilMock.fetchVersion).not.toHaveBeenCalled();
  });

  it('surfaces a failed restore through the toast', async () => {
    utilMock.restoreVersion.mockRejectedValueOnce(new Error('403'));
    const user = userEvent.setup();
    render(<VersionHistory logId={5} />);
    await screen.findByText('Second cut');

    await user.click(screen.getByRole('button', { name: 'Restore Second cut' }));
    await waitFor(() => expect(toastMock.toastError).toHaveBeenCalled());
  });

  it('removes a deleted version from the list and closes its preview', async () => {
    utilMock.fetchVersion.mockResolvedValue({
      version: { id: 1, version_number: 2, title: 'Second cut', saved_at: '2026-01-02', html_content: '' },
    });
    utilMock.deleteVersion.mockResolvedValue({});
    const user = userEvent.setup();
    const { container } = render(<VersionHistory logId={5} />);
    await screen.findByText('Second cut');

    await user.click(container.querySelector('.version-list__info'));
    await waitFor(() => expect(container.querySelector('.version-preview')).not.toBeNull());

    await user.click(screen.getByRole('button', { name: /delete/i }));
    await waitFor(() => expect(utilMock.deleteVersion).toHaveBeenCalledWith(5, 1));
    await waitFor(() => expect(screen.queryByText('Second cut')).toBeNull());
    expect(container.querySelector('.version-preview')).toBeNull();
  });

  it('surfaces a failed delete through the toast and keeps the version', async () => {
    utilMock.fetchVersion.mockResolvedValue({
      version: { id: 1, version_number: 2, title: 'Second cut', saved_at: '2026-01-02', html_content: '' },
    });
    utilMock.deleteVersion.mockRejectedValueOnce(new Error('403'));
    const user = userEvent.setup();
    const { container } = render(<VersionHistory logId={5} />);
    await screen.findByText('Second cut');
    await user.click(container.querySelector('.version-list__info'));
    await waitFor(() => expect(container.querySelector('.version-preview')).not.toBeNull());

    expect(container.querySelectorAll('.version-list__item')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: /delete/i }));
    await waitFor(() => expect(toastMock.toastError).toHaveBeenCalled());
    // The row survives a rejected delete. Counted rather than queried by text:
    // the open preview repeats the title, so getByText would find two.
    expect(container.querySelectorAll('.version-list__item')).toHaveLength(2);
  });

  // The row was a div with role="button" and tabIndex but no key handler, so it
  // was focusable and not activatable; and Restore was nested INSIDE it, so the
  // row's accessible name swallowed that button's label.
  it('previews a version from the keyboard', async () => {
    utilMock.fetchVersion.mockResolvedValue({
      version: { id: 1, version_number: 2, title: 'Second cut', saved_at: '2026-01-02', html_content: '<p>body</p>' },
    });
    const user = userEvent.setup();
    const { container } = render(<VersionHistory logId={5} />);
    await screen.findByText('Second cut');

    const row = container.querySelector('.version-list__info');
    let reached = false;
    for (let i = 0; i < 6 && !reached; i++) {
      await user.tab();
      reached = document.activeElement === row;
    }
    expect(reached).toBe(true);

    await user.keyboard('{Enter}');
    await waitFor(() => expect(utilMock.fetchVersion).toHaveBeenCalledWith(5, 1));
  });

  it('reports whether a version is expanded, and does not nest Restore inside the row control', async () => {
    utilMock.fetchVersion.mockResolvedValue({
      version: { id: 1, version_number: 2, title: 'Second cut', saved_at: '2026-01-02', html_content: '' },
    });
    const user = userEvent.setup();
    const { container } = render(<VersionHistory logId={5} />);
    await screen.findByText('Second cut');

    const row = container.querySelector('.version-list__info');
    expect(row).toHaveAttribute('aria-expanded', 'false');
    // Restore is a sibling of the row control, not a descendant of it.
    expect(row.querySelector('button')).toBeNull();

    await user.click(row);
    await waitFor(() => expect(container.querySelector('.version-list__info'))
      .toHaveAttribute('aria-expanded', 'true'));
  });
});
