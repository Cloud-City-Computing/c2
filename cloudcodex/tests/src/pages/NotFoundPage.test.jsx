/**
 * Cloud Codex - the not-found page is a standalone card (W6-CDX-42, A5)
 *
 * One card: the product mark, a title, one line of text and one primary action back home. No 404 numeral
 * in the accent colour.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import NotFoundPage from '../../../src/pages/NotFoundPage.jsx';

describe('NotFoundPage', () => {
  it('is one card with the product mark, a title and one line', () => {
    const { container } = render(<NotFoundPage />);
    expect(container.querySelector('.not-found-page__card')).not.toBeNull();
    expect(container.querySelector('.not-found-page__card svg.product-mark')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByText('That address does not match a page in Cloud Codex.')).toBeInTheDocument();
  });

  it('offers one primary action, back to home', () => {
    render(<NotFoundPage />);
    const action = screen.getByRole('link', { name: 'Go home' });
    expect(action).toHaveAttribute('href', '/');
    expect(action).toHaveClass('btn', 'btn-primary');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows no 404 numeral as the heading', () => {
    render(<NotFoundPage />);
    expect(screen.queryByText('404')).toBeNull();
  });
});
