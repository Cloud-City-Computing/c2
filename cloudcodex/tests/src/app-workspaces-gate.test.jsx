/**
 * Cloud Codex - The Workspaces gate where App wires it (W6-CDX-40 review, item 3)
 *
 * Renders App with the real router and routes. Only the two pages are stubbed, so the test shows what the route
 * table renders for /workspaces and /workspaces/:id in each mode: suite on redirects home, suite off renders.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/util.jsx', () => ({
  apiFetch: vi.fn(),
}));
vi.mock('../../src/pages/HomePage.jsx', () => ({ default: () => <p>home page</p> }));
vi.mock('../../src/pages/WorkspacesPage.jsx', () => ({ default: () => <p>workspaces page</p> }));

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { apiFetch } from '../../src/util.jsx';
import App from '../../src/App.jsx';
import { __resetSuiteCache } from '../../src/hooks/useSuite.js';

function serveSuite(enabled) {
  apiFetch.mockImplementation((method, url) => Promise.resolve(
    url === '/api/suite' ? { enabled, name: 'Example Suite' } : {},
  ));
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  __resetSuiteCache();
  apiFetch.mockReset();
});

describe('App routes /workspaces to the gate', () => {
  it.each(['/workspaces', '/workspaces/7'])('suite on: %s redirects to the home page', async (path) => {
    serveSuite(true);
    renderAt(path);
    expect(await screen.findByText('home page')).toBeTruthy();
    expect(screen.queryByText('workspaces page')).toBeNull();
  });

  it.each(['/workspaces', '/workspaces/7'])('suite off: %s renders the Workspaces page', async (path) => {
    serveSuite(false);
    renderAt(path);
    expect(await screen.findByText('workspaces page')).toBeTruthy();
    expect(screen.queryByText('home page')).toBeNull();
  });
});
