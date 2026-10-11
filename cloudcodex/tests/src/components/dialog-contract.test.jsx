/**
 * Cloud Codex - The dialog contract, keyboard only, for every dialog
 *
 * Each dialog is opened from a real button, Tabbed to and activated with Enter. Then the test
 * asserts the contract: a role dialog with aria-modal and a name, focus inside, Tab wrapping
 * inside, Escape closing it, and focus returning to the opener.
 *
 * Two kinds. Dialogs opened through the imperative helper (showModal) are driven through it, the
 * way the app opens them. Dialogs that render in the page (the GitHub modals and the image crop)
 * are driven through a harness that mounts them on a state flag.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { showModal, destroyModal } from '../../../src/util.jsx';
import ConfirmDialog from '../../../src/components/ConfirmDialog.jsx';
import PublishModal from '../../../src/components/PublishModal.jsx';
import NewLogModal from '../../../src/components/NewLogModal.jsx';
import ImageCropModal from '../../../src/components/ImageCropModal.jsx';
import { CommitPanel, DeleteFileModal, RenameFileModal, NewFileModal, ImportToCodexModal } from '../../../src/pages/GitHubPage.jsx';

vi.mock('../../../src/util.jsx', async (importOriginal) => {
  const actual = await importOriginal();
  const pending = () => new Promise(() => {});
  return { ...actual, apiFetch: vi.fn(pending), serverReq: vi.fn(pending), searchGitHubIssues: vi.fn(pending) };
});

// A button that opens the dialog, and a Tab-able page control after it, so focus can return to
// the opener and the test can see whether it did.
function Harness({ renderDialog }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open dialog</button>
      <button type="button">Page control</button>
      {open && renderDialog(() => setOpen(false))}
    </>
  );
}

const pressKey = (user, key) => user.keyboard(key);

async function openFromKeyboard(user) {
  // Tab from the top of the page to the opener, then Enter: the way a keyboard user gets there.
  for (let i = 0; i < 10; i += 1) {
    if (document.activeElement?.textContent === 'Open dialog') break;
    await user.tab();
  }
  expect(document.activeElement).toHaveTextContent('Open dialog');
  await pressKey(user, '{Enter}');
}

function expectContract(name) {
  const dialog = screen.getByRole('dialog', { name });
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  return dialog;
}

// Repeated Tab must never leave the dialog, however many stops it has.
async function expectTabStaysInside(user, dialog) {
  for (let i = 0; i < 30; i += 1) {
    await user.tab();
    expect(dialog).toContainElement(document.activeElement);
  }
}

const GITHUB_FILE = { owner: 'o', repo: 'r', filePath: 'docs/a.md', fileSha: 'abc', branch: 'main' };

const IN_PAGE = [
  ['DeleteFileModal', (close) => <DeleteFileModal {...GITHUB_FILE} onDeleted={vi.fn()} onClose={close} />, /delete/i],
  ['RenameFileModal', (close) => <RenameFileModal {...GITHUB_FILE} onRenamed={vi.fn()} onClose={close} />, /rename/i],
  ['CommitPanel', (close) => <CommitPanel {...GITHUB_FILE} content="x" onCommitted={vi.fn()} onClose={close} />, /commit/i],
  ['NewFileModal', (close) => <NewFileModal owner="o" repo="r" branch="main" branches={['main']} onCreated={vi.fn()} onClose={close} />, /new file/i],
  ['ImportToCodexModal', (close) => <ImportToCodexModal {...GITHUB_FILE} onImported={vi.fn()} onClose={close} />, /import/i],
];

describe('the dialog contract, for the dialogs that render in the page', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(() => new Promise(() => {}));
  });

  it.each(IN_PAGE)('%s: opens from the keyboard, traps Tab, closes on Escape, and returns focus', async (_name, renderDialog, name) => {
    const user = userEvent.setup();
    render(<MemoryRouter><Harness renderDialog={renderDialog} /></MemoryRouter>);
    await openFromKeyboard(user);
    const dialog = expectContract(name);
    expect(dialog).toContainElement(document.activeElement);
    expect(dialog).toHaveAttribute('aria-labelledby');
    await expectTabStaysInside(user, dialog);

    await pressKey(user, '{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toHaveTextContent('Open dialog');
  });

  it('ImageCropModal: the same contract, with Cancel closing it from the keyboard', async () => {
    const user = userEvent.setup();
    const file = new File(['x'], 'pic.png', { type: 'image/png' });
    const onCancel = vi.fn();
    render(<Harness renderDialog={() => <ImageCropModal file={file} onConfirm={vi.fn()} onCancel={onCancel} />} />);
    await openFromKeyboard(user);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expectTabStaysInside(user, dialog);
    await pressKey(user, '{Escape}');
    expect(onCancel).toHaveBeenCalled();
  });
});

describe('the dialog contract, for the dialogs opened through showModal', () => {
  let modalRoot;
  let dimmer;

  beforeEach(() => {
    modalRoot = document.createElement('div');
    modalRoot.id = 'modal-root';
    dimmer = document.createElement('div');
    dimmer.id = 'modal-dimmer';
    document.body.append(modalRoot, dimmer);
  });

  afterEach(() => {
    destroyModal();
    modalRoot.remove();
    dimmer.remove();
  });

  const VIA_HELPER = [
    ['ConfirmDialog', () => showModal(<ConfirmDialog title="Delete archive?" message="Permanent." onConfirm={vi.fn()} />), /delete archive/i],
    ['PublishModal', () => showModal(<PublishModal onPublish={vi.fn()} onCancel={() => destroyModal()} />), /publish/i],
    ['NewLogModal', () => showModal(<NewLogModal archiveId={1} onCreated={vi.fn()} />), /new log/i],
  ];

  it.each(VIA_HELPER)('%s: focus goes in, Tab wraps, Escape closes, focus returns to the opener', async (_name, open, name) => {
    const user = userEvent.setup();
    const opener = document.createElement('button');
    opener.type = 'button';
    opener.textContent = 'Open dialog';
    opener.addEventListener('click', open);
    document.body.appendChild(opener);
    await user.tab();
    expect(document.activeElement).toBe(opener);
    await pressKey(user, '{Enter}');

    const dialog = expectContract(name);
    expect(dialog).toContainElement(document.activeElement);
    await expectTabStaysInside(user, dialog);

    await pressKey(user, '{Escape}');
    expect(modalRoot.children).toHaveLength(0);
    await waitFor(() => expect(document.activeElement).toBe(opener));
    opener.remove();
  });
});

describe('Escape on a dialog with unsaved work asks before it closes', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(() => new Promise(() => {}));
  });

  it('NewFileModal: Cancel on the discard prompt keeps the dialog and what was typed', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(
      <MemoryRouter>
        <NewFileModal owner="o" repo="r" branch="main" branches={['main']} onCreated={vi.fn()} onClose={onClose} />
      </MemoryRouter>,
    );
    const path = screen.getByPlaceholderText('e.g. docs/guide.md');
    await user.type(path, 'docs/unsaved.md');
    await user.keyboard('{Escape}');
    expect(confirm).toHaveBeenCalledWith('You have unsaved work. Discard and close?');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('e.g. docs/guide.md')).toHaveValue('docs/unsaved.md');
    confirm.mockRestore();
  });

  it('NewFileModal: OK on the discard prompt closes it', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <MemoryRouter>
        <NewFileModal owner="o" repo="r" branch="main" branches={['main']} onCreated={vi.fn()} onClose={onClose} />
      </MemoryRouter>,
    );
    await user.type(screen.getByPlaceholderText('e.g. docs/guide.md'), 'x');
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
  });
});

