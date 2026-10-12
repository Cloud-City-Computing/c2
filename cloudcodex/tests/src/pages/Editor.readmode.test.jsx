/**
 * Cloud Codex - read mode has one Edit control on the page (W6-CDX-41, momus round 1)
 *
 * The document header's Edit is the page's primary. The editor toolbar in read mode no longer repeats it.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/util.jsx', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    fetchDocument: vi.fn(async () => ({
      document: {
        id: 5, title: 'Q3 plan', name: 'Ada Lovelace', email: 'ada@example.com', version: 3,
        created_at: '2026-10-01T10:00:00Z', archive_id: 1, archive_name: 'Release Planning', html_content: '<p>Hi</p>',
      },
    })),
    checkFavorite: vi.fn(async () => ({ favorited: false })),
    checkWatch: vi.fn(async () => ({ watching: false })),
    fetchComments: vi.fn(async () => ({ comments: [] })),
  };
});
vi.mock('../../../src/page_layouts/Std_Layout.jsx', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('../../../src/hooks/useCollab', () => ({
  default: () => ({
    ydoc: null, synced: false, collabUsers: [], collabConnected: false, remoteCursors: [],
    sendCursor: vi.fn(), sendSave: vi.fn(), sendPublish: vi.fn(), sendTitle: vi.fn(), sendCommentEvent: vi.fn(),
  }),
}));
vi.mock('../../../src/hooks/usePresence', () => ({ default: () => ({ getLogUsers: () => [] }) }));
vi.mock('../../../src/hooks/useGitHubStatus.jsx', () => ({ default: () => ({ connected: false, loading: false }) }));
vi.mock('../../../src/hooks/useGitHubLink', () => ({
  default: () => ({ link: null, status: null, loading: false, conflict: null, pull: vi.fn(), push: vi.fn(), resolve: vi.fn(), clearConflict: vi.fn() }),
}));
vi.mock('@tiptap/react', () => ({ useEditor: () => null, EditorContent: () => null }));

import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

describe('the document page in read mode', () => {
  beforeEach(() => {
    window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  });

  it('has exactly one control named Edit on the page', async () => {
    const { default: Editor } = await import('../../../src/pages/Editor.jsx');
    const { container } = render(
      <MemoryRouter initialEntries={['/archives/1/doc/5']}>
        <Routes><Route path="/archives/:archiveId/doc/:logId" element={<Editor embedded />} /></Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(container.querySelector('.document-header')).not.toBeNull());
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Q3 plan'));
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveClass('btn-primary');
  });
});
