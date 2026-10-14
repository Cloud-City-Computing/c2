/**
 * Cloud Codex - The Workspaces page is routed for every instance (CDX-SA-2, Task 2.4)
 *
 * The suite gate is gone: /workspaces and /workspaces/:id render the Workspaces page.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// The server answers suite mode on: the removed gate would redirect /workspaces home on that answer.
vi.mock('../../src/util.jsx', () => ({
  apiFetch: vi.fn(async (method, url) => (url === '/api/suite' ? { enabled: true, name: 'Example Suite' } : {})),
}));
vi.mock('../../src/pages/HomePage.jsx', () => ({ default: () => <p>home page</p> }));
vi.mock('../../src/pages/WorkspacesPage.jsx', () => ({ default: () => <p>workspaces page</p> }));

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../../src/App.jsx';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('App routes /workspaces to the Workspaces page', () => {
  it.each(['/workspaces', '/workspaces/7'])('%s renders the Workspaces page even when the server says suite mode is on', async (path) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByText('workspaces page')).toBeTruthy();
    expect(screen.queryByText('home page')).toBeNull();
  });
});
