/**
 * Cloud Codex - the field primitive is on the search filters, the sort and the Account panels (W6-CDX-39,
 * Task 2.3, momus 4). A field is a `.field` wrapper with a `.field__label`, and its control is `.field__control`.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../src/util.jsx', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    apiFetch: vi.fn(() => Promise.resolve({ success: true, workspaces: [], squads: [], archives: [], documents: [], total: 0, user: { id: 1, name: 'Ada', email: 'ada@example.test' } })),
  };
});

describe('the Account panel\'s fields are the field primitive', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders each Update Info field as .field with a .field__label and a .field__control, and no form-group', async () => {
    const { AccountInfoUpdatePanel } = await import('../../../src/components/AccountMenu.jsx');
    const { container } = render(<MemoryRouter><AccountInfoUpdatePanel /></MemoryRouter>);
    const name = await waitFor(() => {
      const el = document.getElementById('name');
      expect(el).not.toBeNull();
      return el;
    });
    expect(name.classList.contains('field__control')).toBe(true);
    expect(name.closest('.field')).not.toBeNull();
    expect(name.closest('.field').querySelector('label.field__label')).not.toBeNull();
    expect(container.querySelector('.form-group')).toBeNull();
  });
});

describe('the Explore search and sort are the field primitive', () => {
  it('gives the search input and the sort trigger the .field__control class', async () => {
    const { default: ExploreBrowser } = await import('../../../src/components/ExploreBrowser.jsx');
    render(<MemoryRouter><ExploreBrowser /></MemoryRouter>);
    const search = await screen.findByPlaceholderText('Search all documents...');
    expect(search.classList.contains('field__control')).toBe(true);
    const sort = await screen.findByRole('button', { name: /Sort documents/ });
    expect(sort.classList.contains('field__control')).toBe(true);
  });
});
