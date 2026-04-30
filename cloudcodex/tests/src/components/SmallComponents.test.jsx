/**
 * Cloud Codex — Tests for the under-80-LOC reusable components:
 *   AccountPanel, WelcomeSetup, SearchResultItem, NewLogModal, ExportMenu,
 *   CollabPresence
 *
 * Each component gets a focused render + interaction smoke test rather than
 * a per-file test file. They're intentionally small in coverage scope.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { utilMock, ghStatus } = vi.hoisted(() => ({
  utilMock: {
    apiFetch: vi.fn(async () => ({})),
    createLog: vi.fn(async () => ({ logId: 99 })),
    destroyModal: vi.fn(),
    showModal: vi.fn(),
    removeSessStorage: vi.fn(),
    docUrl: vi.fn((doc) => `/editor/${doc.id}`),
  },
  ghStatus: { connected: true },
}));

vi.mock('../../../src/util.jsx', () => utilMock);
vi.mock('../../../src/hooks/useGitHubStatus.jsx', () => ({
  default: () => ghStatus,
}));

import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AccountPanel from '../../../src/components/AccountPanel.jsx';
import WelcomeSetup from '../../../src/components/WelcomeSetup.jsx';
import SearchResultItem from '../../../src/components/SearchResultItem.jsx';
import NewLogModal from '../../../src/components/NewLogModal.jsx';
import ExportMenu from '../../../src/components/ExportMenu.jsx';
import CollabPresence from '../../../src/components/CollabPresence.jsx';

const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(() => {
  Object.values(utilMock).forEach((fn) => typeof fn?.mockReset === 'function' && fn.mockReset());
  utilMock.apiFetch.mockResolvedValue({});
  utilMock.createLog.mockResolvedValue({ logId: 99 });
  utilMock.docUrl.mockImplementation((doc) => `/editor/${doc.id}`);
  ghStatus.connected = true;
});

describe('AccountPanel', () => {
  it('renders name and email', () => {
    render(<AccountPanel name="Alice" email="a@b.c" />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText(/a@b\.c/)).toBeInTheDocument();
  });

  it('renders Account Settings and Logout buttons', () => {
    render(<AccountPanel name="A" email="a@b" />);
    expect(screen.getByRole('button', { name: /account settings/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /logout/i })).toBeInTheDocument();
  });
});

describe('WelcomeSetup', () => {
  it('renders the welcome heading and Get Started button', () => {
    render(<WelcomeSetup onComplete={vi.fn()} />);
    expect(screen.getByRole('heading', { name: /welcome to cloud codex/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /get started/i })).toBeInTheDocument();
  });

  it('clicking Get Started calls destroyModal then onComplete', async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();
    render(<WelcomeSetup onComplete={onComplete} />);
    await user.click(screen.getByRole('button', { name: /get started/i }));
    expect(utilMock.destroyModal).toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalled();
  });

  it('does not throw when onComplete is undefined', async () => {
    const user = userEvent.setup();
    render(<WelcomeSetup />);
    await user.click(screen.getByRole('button', { name: /get started/i }));
    expect(utilMock.destroyModal).toHaveBeenCalled();
  });
});

describe('SearchResultItem', () => {
  it('renders title and archive name', () => {
    wrap(<SearchResultItem doc={{ id: 1, title: 'Hello', archive_name: 'Inbox' }} />);
    expect(screen.getByRole('heading', { name: /hello/i })).toBeInTheDocument();
    expect(screen.getByText('Inbox')).toBeInTheDocument();
  });

  it('clicking the row opens a preview modal via showModal', async () => {
    const user = userEvent.setup();
    const doc = { id: 1, title: 'Doc', author: 'Alice', created_at: new Date().toISOString() };
    const { container } = wrap(<SearchResultItem doc={doc} />);
    await user.click(container.querySelector('.search-result-item'));
    expect(utilMock.showModal).toHaveBeenCalled();
  });
});

describe('NewLogModal', () => {
  it('rejects empty title with a form-error', async () => {
    const user = userEvent.setup();
    render(<NewLogModal archiveId={1} />);
    await user.click(screen.getByRole('button', { name: /create/i }));
    expect(screen.getByText(/title is required/i)).toBeInTheDocument();
    expect(utilMock.createLog).not.toHaveBeenCalled();
  });

  it('submits via createLog, calls onCreated with the new id, and destroys the modal', async () => {
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<NewLogModal archiveId={5} parentId={9} onCreated={onCreated} />);
    await user.type(screen.getByLabelText(/log title/i), 'Hello');
    await user.click(screen.getByRole('button', { name: /create/i }));
    expect(utilMock.createLog).toHaveBeenCalledWith(5, 'Hello', 9);
    expect(utilMock.destroyModal).toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalledWith(99);
  });

  it('shows server-side error message on failure', async () => {
    utilMock.createLog.mockRejectedValueOnce({ body: { message: 'No write access' } });
    const user = userEvent.setup();
    render(<NewLogModal archiveId={1} />);
    await user.type(screen.getByLabelText(/log title/i), 'X');
    await user.click(screen.getByRole('button', { name: /create/i }));
    expect(await screen.findByText(/no write access/i)).toBeInTheDocument();
  });

  it('Enter key submits the form', async () => {
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<NewLogModal archiveId={1} onCreated={onCreated} />);
    const input = screen.getByLabelText(/log title/i);
    await user.type(input, 'Hi');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(utilMock.createLog).toHaveBeenCalled();
  });

  it('renders custom heading and label when provided', () => {
    render(<NewLogModal archiveId={1} heading="New Page" label="Page Title:" />);
    expect(screen.getByRole('heading', { name: /new page/i })).toBeInTheDocument();
    expect(screen.getByText(/page title:/i)).toBeInTheDocument();
  });
});

describe('ExportMenu', () => {
  it('renders the trigger button and opens the menu on click', async () => {
    const user = userEvent.setup();
    render(<ExportMenu onExport={vi.fn()} />);
    expect(screen.queryByText(/HTML \(\.html\)/)).toBeNull();

    await user.click(screen.getByRole('button', { name: /export/i }));
    expect(screen.getByText(/HTML \(\.html\)/)).toBeInTheDocument();
    expect(screen.getByText(/Markdown \(\.md\)/)).toBeInTheDocument();
  });

  it('clicking a format calls onExport(fmt) and closes the menu', async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();
    render(<ExportMenu onExport={onExport} />);
    await user.click(screen.getByRole('button', { name: /export/i }));
    await user.click(screen.getByRole('button', { name: /HTML \(\.html\)/ }));
    expect(onExport).toHaveBeenCalledWith('html');
    expect(screen.queryByText(/PDF \(\.pdf\)/)).toBeNull();
  });

  it('hides the GitHub option when github is not connected', async () => {
    ghStatus.connected = false;
    const user = userEvent.setup();
    render(<ExportMenu onExport={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /export/i }));
    expect(screen.queryByText(/Push to GitHub/)).toBeNull();
  });

  it('shows the GitHub option when connected', async () => {
    ghStatus.connected = true;
    const user = userEvent.setup();
    render(<ExportMenu onExport={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /export/i }));
    expect(screen.getByText(/Push to GitHub/)).toBeInTheDocument();
  });
});

describe('CollabPresence', () => {
  it('renders the offline indicator when not connected', () => {
    const { container } = render(<CollabPresence users={[]} connected={false} />);
    expect(container.querySelector('.collab-presence--disconnected')).not.toBeNull();
    expect(screen.getByText(/offline/i)).toBeInTheDocument();
  });

  it('renders an online dot and avatars when connected', () => {
    const { container } = render(<CollabPresence
      users={[{ id: 1, name: 'Alice', color: '#fff' }]}
      connected
    />);
    expect(container.querySelector('.collab-status-dot--online')).not.toBeNull();
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('toggles the user list on click', async () => {
    const user = userEvent.setup();
    const { container } = render(<CollabPresence
      users={[{ id: 1, name: 'Alice', color: '#fff' }]}
      connected
    />);
    expect(container.querySelector('.collab-user-list')).toBeNull();
    await user.click(container.querySelector('.collab-presence'));
    expect(container.querySelector('.collab-user-list')).not.toBeNull();
  });

  it('renders an avatar img when avatar_url is set', () => {
    const { container } = render(<CollabPresence
      users={[{ id: 1, name: 'Alice', avatar_url: 'https://x/a.png', color: '#fff' }]}
      connected
    />);
    const img = container.querySelector('.collab-avatar img');
    expect(img.getAttribute('src')).toBe('https://x/a.png');
  });

  it('falls back to "?" when name is missing', () => {
    render(<CollabPresence users={[{ id: 1, color: '#fff' }]} connected />);
    expect(screen.getByText('?')).toBeInTheDocument();
  });
});
