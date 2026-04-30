/**
 * Cloud Codex — Tests for src/components/GitHubSyncBanner.jsx
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { utilMock, toastMock } = vi.hoisted(() => ({
  utilMock: {
    showModal: vi.fn(),
    destroyModal: vi.fn(),
    fetchActionsRuns: vi.fn(async () => ({ latest: null })),
  },
  toastMock: { showToast: vi.fn(), toastError: vi.fn() },
}));

vi.mock('../../../src/util.jsx', () => utilMock);
vi.mock('../../../src/components/Toast.jsx', () => toastMock);

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GitHubSyncBanner from '../../../src/components/GitHubSyncBanner.jsx';

const baseLink = {
  repo_owner: 'octocat',
  repo_name: 'hello',
  branch: 'main',
  file_path: 'README.md',
};

beforeEach(() => {
  Object.values(utilMock).forEach((fn) => typeof fn?.mockReset === 'function' && fn.mockReset());
  utilMock.fetchActionsRuns.mockResolvedValue({ latest: null });
  Object.values(toastMock).forEach((fn) => fn.mockReset());
});

describe('GitHubSyncBanner', () => {
  it('renders nothing when link is null', () => {
    const { container } = render(<GitHubSyncBanner link={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders "Checking GitHub…" while loading', () => {
    render(<GitHubSyncBanner link={baseLink} status={null} loading />);
    expect(screen.getByText(/checking github/i)).toBeInTheDocument();
  });

  it('renders the "In sync" label for clean status', () => {
    render(<GitHubSyncBanner link={baseLink} status={{ sync_status: 'clean' }} />);
    expect(screen.getByText(/in sync/i)).toBeInTheDocument();
  });

  it('renders the file path link to GitHub', () => {
    const { container } = render(<GitHubSyncBanner link={baseLink} status={{ sync_status: 'clean' }} />);
    const link = container.querySelector('.gh-sync-banner__path a');
    expect(link.getAttribute('href')).toBe('https://github.com/octocat/hello/blob/main/README.md');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('shows Pull button when sync_status is remote_ahead', () => {
    render(<GitHubSyncBanner link={baseLink} status={{ sync_status: 'remote_ahead' }} onPull={vi.fn()} />);
    expect(screen.getByRole('button', { name: /pull/i })).toBeInTheDocument();
  });

  it('shows Push menu trigger when sync_status is local_ahead', () => {
    render(<GitHubSyncBanner link={baseLink} status={{ sync_status: 'local_ahead' }} onPush={vi.fn()} />);
    expect(screen.getByRole('button', { name: /push/i })).toBeInTheDocument();
  });

  it('shows both Pull and Resolve buttons when diverged', () => {
    render(<GitHubSyncBanner link={baseLink} status={{ sync_status: 'diverged' }} onPull={vi.fn()} onPush={vi.fn()} />);
    expect(screen.getByRole('button', { name: /pull/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /resolve/i })).toBeInTheDocument();
  });

  it('clicking Pull invokes onPull("merge") and toasts on success', async () => {
    const onPull = vi.fn().mockResolvedValueOnce({ ok: true });
    const user = userEvent.setup();
    render(<GitHubSyncBanner link={baseLink} status={{ sync_status: 'remote_ahead' }} onPull={onPull} />);
    await user.click(screen.getByRole('button', { name: /pull/i }));
    await waitFor(() => expect(toastMock.showToast).toHaveBeenCalledWith('Pulled from GitHub', 'success'));
    expect(onPull).toHaveBeenCalledWith('merge');
  });

  it('Push menu opens with Direct and PR options', async () => {
    const user = userEvent.setup();
    render(<GitHubSyncBanner link={baseLink} status={{ sync_status: 'local_ahead' }} onPush={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /push/i }));
    expect(screen.getByRole('button', { name: /commit directly/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open pull request/i })).toBeInTheDocument();
  });

  it('falls back to clean styling for unknown sync_status values', () => {
    const { container } = render(<GitHubSyncBanner link={baseLink} status={{ sync_status: 'mystery' }} />);
    expect(container.querySelector('.gh-sync-banner--ok')).not.toBeNull();
  });
});
