/**
 * Cloud Codex - Deleting a log keeps focus on the page
 *
 * The delete control's dialog returns focus to the row's delete button, then the list refreshes
 * and that row is removed. Focus must not fall to <body>: it moves to the next row. Keyboard only,
 * with the real showModal and ConfirmDialog; only the API calls are mocked.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useState } from 'react';

vi.mock('../../../src/util.jsx', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    deleteLog: vi.fn(async () => ({})),
    fetchCommentCount: vi.fn(async () => ({ count: 0 })),
    fetchDocument: vi.fn(async () => ({ document: { html_content: '' } })),
    exportDocument: vi.fn(async () => ({})),
  };
});

import { LogTreeItem } from '../../../src/components/ArchiveBrowser.jsx';

const LOGS = [
  { id: 1, title: 'Alpha' },
  { id: 2, title: 'Beta' },
  { id: 3, title: 'Gamma' },
];

// A list that removes the deleted row on refresh, as the real loadLogs does.
function Tree() {
  const [logs, setLogs] = useState(LOGS);
  return (
    <ul>
      {logs.map((log) => (
        <LogTreeItem
          key={log.id}
          log={log}
          archiveId={1}
          getLogUsers={() => []}
          onLogDeleted={() => setLogs((current) => current.filter((l) => l.id !== log.id))}
        />
      ))}
    </ul>
  );
}

async function tabTo(user, name) {
  for (let i = 0; i < 60; i += 1) {
    if (document.activeElement?.getAttribute('aria-label') === name) return;
    await user.tab();
  }
  throw new Error(`never reached ${name} by Tab`);
}

let modalRoot;
let dimmer;

beforeEach(() => {
  modalRoot = document.createElement('div');
  modalRoot.id = 'modal-root';
  dimmer = document.createElement('div');
  dimmer.id = 'modal-dimmer';
  document.body.append(modalRoot, dimmer);
});

afterEach(async () => {
  const { destroyModal } = await import('../../../src/util.jsx');
  destroyModal();
  modalRoot.remove();
  dimmer.remove();
});

describe('deleting a log', () => {
  it('leaves focus on the next row once the row is removed, not on the body', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><Tree /></MemoryRouter>);
    await tabTo(user, 'Delete Alpha');
    await user.keyboard('{Enter}');

    expect(screen.getByRole('dialog', { name: /delete log/i })).toBeInTheDocument();
    // The dialog starts on Cancel, so one Tab reaches Delete.
    await user.tab();
    expect(document.activeElement).toHaveTextContent('Delete');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.queryByText('Alpha')).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expect(screen.getByText('Beta').closest('li')).toContainElement(document.activeElement);
  });
});
