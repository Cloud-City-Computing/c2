/**
 * Cloud Codex - focus after a More actions choice opens a dialog (W6-CDX-41, momus round 1)
 *
 * Uses the REAL showModal and openDialog (only the API calls are mocked). Choosing Rename from the row's More actions
 * menu must leave the trigger as the dialog's opener, so Escape closes the dialog and puts focus back on the trigger.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/util.jsx', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    fetchArchives: vi.fn(async () => ({
      archives: [{
        id: 1, name: 'Release Planning', created_by: 'wedge', created_at: '2026-10-11T00:00:00Z',
        squad_id: 7, squad_name: 'General', workspace_id: 3, log_count: 0,
      }],
    })),
    fetchLogs: vi.fn(async () => ({ logs: [] })),
    fetchArchiveAccess: vi.fn(async () => ({ data: null })),
    fetchArchiveRepos: vi.fn(async () => ({ repos: [] })),
  };
});
vi.mock('../../../src/hooks/usePresence', () => ({ default: () => ({ getLogUsers: () => [] }) }));
vi.mock('../../../src/hooks/useGitHubStatus.jsx', () => ({ default: () => ({ connected: false }) }));

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ArchiveBrowser from '../../../src/components/ArchiveBrowser.jsx';

describe('focus after a More actions choice (real showModal)', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div><div id="modal-root"></div><div id="modal-dimmer" style="display:none"></div>';
  });
  afterEach(() => { document.body.innerHTML = ''; });

  it('Enter, ArrowDown, Enter, Escape returns focus to the More actions trigger', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ArchiveBrowser /></MemoryRouter>, { container: document.getElementById('app') });
    const trigger = await screen.findByRole('button', { name: 'More actions for Release Planning' });

    trigger.focus();
    await user.keyboard('{Enter}');
    const menu = await screen.findByRole('menu', { name: 'More actions for Release Planning' });
    expect(within(menu).getByRole('menuitem', { name: 'Go to squad' })).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(within(menu).getByRole('menuitem', { name: 'Rename' })).toHaveFocus();
    await user.keyboard('{Enter}');

    const dialog = await screen.findByRole('dialog', { name: 'Rename Archive' });
    expect(dialog).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger).toHaveFocus();
  });
});
