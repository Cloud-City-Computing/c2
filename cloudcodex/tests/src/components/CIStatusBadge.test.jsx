/**
 * Cloud Codex — Tests for src/components/CIStatusBadge.jsx
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../src/util.jsx', () => ({
  fetchActionsRuns: vi.fn(),
}));

import { render, screen, waitFor } from '@testing-library/react';
import { fetchActionsRuns } from '../../../src/util.jsx';
import CIStatusBadge from '../../../src/components/CIStatusBadge.jsx';

beforeEach(() => {
  fetchActionsRuns.mockReset();
});

describe('CIStatusBadge', () => {
  it('renders nothing when owner / repo / branch is missing', async () => {
    const { container } = render(<CIStatusBadge owner="" repo="" branch="" />);
    await waitFor(() => {
      expect(container.querySelector('.ci-badge')).toBeNull();
    });
    expect(fetchActionsRuns).not.toHaveBeenCalled();
  });

  it('shows a loading dot while the fetch is in flight', () => {
    fetchActionsRuns.mockReturnValueOnce(new Promise(() => {})); // never resolves
    const { container } = render(<CIStatusBadge owner="o" repo="r" branch="main" />);
    expect(container.querySelector('.ci-badge--loading')).not.toBeNull();
  });

  it('renders nothing when there is no latest run', async () => {
    fetchActionsRuns.mockResolvedValueOnce({ latest: null });
    const { container } = render(<CIStatusBadge owner="o" repo="r" branch="main" />);
    await waitFor(() => {
      expect(container.querySelector('.ci-badge')).toBeNull();
    });
  });

  it('renders a success badge with ✓ icon when the run completed successfully', async () => {
    fetchActionsRuns.mockResolvedValueOnce({
      latest: { status: 'completed', conclusion: 'success', name: 'CI', html_url: 'https://gh/x' },
    });
    render(<CIStatusBadge owner="o" repo="r" branch="main" />);
    await waitFor(() => {
      expect(document.querySelector('.ci-badge--success')).not.toBeNull();
    });
    expect(screen.getByText('✓')).toBeInTheDocument();
  });

  it('links to the workflow run URL when present', async () => {
    fetchActionsRuns.mockResolvedValueOnce({
      latest: { status: 'completed', conclusion: 'failure', html_url: 'https://gh/r/123' },
    });
    render(<CIStatusBadge owner="o" repo="r" branch="main" />);
    await waitFor(() => {
      const a = document.querySelector('a.ci-badge');
      expect(a).not.toBeNull();
      expect(a.getAttribute('href')).toBe('https://gh/r/123');
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    });
  });

  it('renders a span instead of a link when html_url is missing', async () => {
    fetchActionsRuns.mockResolvedValueOnce({
      latest: { status: 'completed', conclusion: 'success' },
    });
    render(<CIStatusBadge owner="o" repo="r" branch="main" />);
    await waitFor(() => {
      expect(document.querySelector('span.ci-badge')).not.toBeNull();
      expect(document.querySelector('a.ci-badge')).toBeNull();
    });
  });

  it('uses status field when not yet completed', async () => {
    fetchActionsRuns.mockResolvedValueOnce({
      latest: { status: 'in_progress' },
    });
    render(<CIStatusBadge owner="o" repo="r" branch="main" />);
    await waitFor(() => {
      expect(document.querySelector('.ci-badge--in_progress')).not.toBeNull();
    });
  });

  it('hides the label in compact mode', async () => {
    fetchActionsRuns.mockResolvedValueOnce({
      latest: { status: 'completed', conclusion: 'success' },
    });
    render(<CIStatusBadge owner="o" repo="r" branch="main" compact />);
    await waitFor(() => {
      expect(document.querySelector('.ci-badge--success')).not.toBeNull();
      expect(document.querySelector('.ci-badge__label')).toBeNull();
    });
  });

  it('renders nothing when fetch errors', async () => {
    fetchActionsRuns.mockRejectedValueOnce(new Error('500'));
    const { container } = render(<CIStatusBadge owner="o" repo="r" branch="main" />);
    await waitFor(() => {
      expect(container.querySelector('.ci-badge--loading')).toBeNull();
      expect(container.querySelector('.ci-badge')).toBeNull();
    });
  });
});
