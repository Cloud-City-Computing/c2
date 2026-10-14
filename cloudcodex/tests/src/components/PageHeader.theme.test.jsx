/**
 * Cloud Codex - every page header carries the theme toggle, last in its action row (W6-CDX-44)
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';


import PageHeader from '../../../src/components/PageHeader.jsx';

beforeEach(() => {
  document.documentElement.setAttribute('data-theme', 'dark');
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});

describe('PageHeader and the theme toggle', () => {
  it('shows the toggle on a header with no primary action and no toolbar', () => {
    const { container } = render(<PageHeader title="Home" />);
    const actions = container.querySelector('.page-header__actions');
    expect(actions).not.toBeNull();
    expect(actions.querySelector('button')).toBe(screen.getByRole('button', { name: 'Appearance' }));
  });

  it('puts the toggle after the primary action and the toolbar', () => {
    const { container } = render(
      <PageHeader title="Lists" primary={<button type="button">New</button>} toolbar={<button type="button">Sort</button>} />,
    );
    const names = [...container.querySelectorAll('.page-header__actions button')].map((b) => b.textContent || b.getAttribute('aria-label'));
    expect(names).toEqual(['New', 'Sort', 'Appearance']);
  });
});
