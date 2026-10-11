/**
 * Cloud Codex - Tests for the close control of every dialog
 *
 * Each of the 22 former `<span onClick>×</span>` close controls is a real button named "Close".
 * Keyboard only: the test Tabs from the top of the document until it reaches the control, then
 * presses Enter, and asserts that the dialog's close handler ran once.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const closed = vi.hoisted(() => vi.fn());

vi.mock('../../../src/util.jsx', async (importOriginal) => {
  const actual = await importOriginal();
  const pending = () => new Promise(() => {});
  return {
    ...actual,
    destroyModal: (...args) => closed(...args),
    apiFetch: vi.fn(pending),
    serverReq: vi.fn(pending),
    searchGitHubIssues: vi.fn(pending),
    // The permissions dialog draws its close control once the permissions have loaded.
    fetchAdminUserPermissions: vi.fn(async () => ({ permissions: { create_squad: false, create_archive: false, create_log: true } })),
  };
});

import PublishModal from '../../../src/components/PublishModal.jsx';
import GitHubMergeDialog from '../../../src/components/GitHubMergeDialog.jsx';
import NewLogModal from '../../../src/components/NewLogModal.jsx';
import IssuePickerModal from '../../../src/components/github/IssuePickerModal.jsx';
import CodeEmbedPickerModal from '../../../src/components/github/CodeEmbedPickerModal.jsx';
import ConfirmDialog from '../../../src/components/ConfirmDialog.jsx';
import Login from '../../../src/components/Login.jsx';
import { DocumentPreviewModal } from '../../../src/components/SearchResultItem.jsx';
import { ManageArchiveAccessModal } from '../../../src/components/ArchiveBrowser.jsx';
import {
  NewArchiveModal, RenameArchiveModal, UploadDocumentModal, LinkRepoModal,
} from '../../../src/components/ArchiveBrowser.jsx';
import {
  NewWorkspaceModal, InviteUserModal, UserPermissionsModal, EditMemberModal,
} from '../../../src/pages/AdminPage.jsx';
import {
  NewOrgModal, RenameOrgModal, NewSquadModal, RenameSquadModal, InviteMemberModal,
} from '../../../src/pages/WorkspacesPage.jsx';

// Each case renders the dialog with its close handler wired to `closed`, either as its onCancel
// prop or, where the component closes through destroyModal, through the mocked util.
const CASES = [
  ['PublishModal', () => <PublishModal onPublish={vi.fn()} onCancel={closed} />],
  ['GitHubMergeDialog', () => <GitHubMergeDialog conflict={{ ours: 'a', theirs: 'b', merged_with_markers: 'x' }} link={{}} onCancel={closed} onResolved={vi.fn()} />],
  ['NewLogModal', () => <NewLogModal archiveId={1} onCreated={vi.fn()} />],
  ['IssuePickerModal', () => <IssuePickerModal onInsert={vi.fn()} onCancel={closed} />],
  ['CodeEmbedPickerModal', () => <CodeEmbedPickerModal onInsert={vi.fn()} onCancel={closed} />],
  ['ConfirmDialog', () => <ConfirmDialog title="Delete?" message="Permanent." onConfirm={vi.fn()} onCancel={closed} />],
  ['Login', () => <MemoryRouter><Login /></MemoryRouter>],
  ['DocumentPreviewModal', () => <DocumentPreviewModal doc={{ id: 1, title: 'Doc', excerpt: '' }} onOpen={vi.fn()} />],
  ['ManageArchiveAccessModal', () => <ManageArchiveAccessModal archive={{ id: 1, name: 'A' }} onAccessUpdated={vi.fn()} onAccessSaved={vi.fn()} />],
  ['NewArchiveModal', () => <NewArchiveModal onCreated={vi.fn()} squadId={1} />],
  ['RenameArchiveModal', () => <RenameArchiveModal archive={{ id: 1, name: 'A' }} onRenamed={vi.fn()} />],
  ['UploadDocumentModal', () => <UploadDocumentModal archiveId={1} parentId={null} onUploaded={vi.fn()} />],
  ['LinkRepoModal', () => <LinkRepoModal archiveId={1} onLinked={vi.fn()} />],
  ['NewWorkspaceModal', () => <NewWorkspaceModal onCreated={vi.fn()} />],
  ['InviteUserModal', () => <InviteUserModal onInvited={vi.fn()} />],
  ['UserPermissionsModal', () => <UserPermissionsModal user={{ id: 2, name: 'U' }} onUpdated={vi.fn()} />],
  ['EditMemberModal', () => <EditMemberModal squadId={1} member={{ user_id: 2, name: 'M', role: 'member' }} onUpdated={vi.fn()} />],
  ['NewOrgModal', () => <NewOrgModal onCreated={vi.fn()} />],
  ['RenameOrgModal', () => <RenameOrgModal workspace={{ id: 1, name: 'W' }} onRenamed={vi.fn()} />],
  ['NewSquadModal', () => <NewSquadModal workspaceId={1} onCreated={vi.fn()} />],
  ['RenameSquadModal', () => <RenameSquadModal squad={{ id: 1, name: 'S' }} onRenamed={vi.fn()} />],
  ['InviteMemberModal', () => <InviteMemberModal squadId={1} onInvited={vi.fn()} />],
];

// Tab from the top of the page until the close control has focus. Bounded, so a close control
// that cannot be reached by keyboard fails rather than hangs.
async function tabToClose(user) {
  for (let i = 0; i < 40; i += 1) {
    if (document.activeElement?.getAttribute('aria-label') === 'Close') return document.activeElement;
    await user.tab();
  }
  throw new Error('the Close control was never reached by Tab');
}

beforeEach(() => {
  closed.mockClear();
  globalThis.fetch = vi.fn(() => new Promise(() => {}));
});

describe('every dialog close control', () => {
  it.each(CASES)('%s: its Close is a button, named Close, that Enter activates', async (_name, build) => {
    const user = userEvent.setup();
    render(build());
    const close = await tabToClose(user);
    expect(close.tagName).toBe('BUTTON');
    expect(close).toHaveAttribute('type', 'button');
    expect(screen.getByRole('button', { name: 'Close' })).toBe(close);
    await user.keyboard('{Enter}');
    expect(closed).toHaveBeenCalledTimes(1);
  });
});
