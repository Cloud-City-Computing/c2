/**
 * Cloud Codex - The suite cluster is a non-modal disclosure with the keyboard contract Cloud Command confirmed
 *
 * A disclosure, not role="menu": a toggle with aria-expanded and aria-controls, a list of links,
 * no arrow keys. Order: this product, the other product, a separator, All workspaces. Escape,
 * an outside click and Tab out close it; the outside click returns focus to the toggle unless the
 * press landed on another focusable control; activating the current product's link returns focus
 * to the toggle; any change of history entry closes it.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import SuiteCluster from '../../../src/components/SuiteCluster.jsx';

const COMMAND = 'https://command.example.test/w/1';
const SUITE = 'Example Suite';

function Harness({ initial = '/' }) {
  const navigate = useNavigate();
  return (
    <>
      <SuiteCluster suiteName={SUITE} commandWorkspaceUrl={COMMAND} />
      <button type="button" onClick={() => navigate('/archives/a')}>go elsewhere</button>
      <button type="button" onClick={() => navigate(-1)}>back</button>
      <button type="button">outside control</button>
      <div data-testid="plain">plain content</div>
      <span>{initial}</span>
    </>
  );
}

function renderCluster(initial = '/') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Harness initial={initial} />
    </MemoryRouter>,
  );
}

const toggle = () => screen.getByRole('button', { name: `Cloud Codex, ${SUITE}: switch app` });
const panel = () => document.getElementById(toggle().getAttribute('aria-controls'));

describe('SuiteCluster: the disclosure', () => {
  it('is a button with aria-expanded and aria-controls, and the name is product, suite, switch app', () => {
    renderCluster();
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(toggle().getAttribute('aria-controls')).toBeTruthy();
    expect(panel()).toBeInTheDocument();
    expect(panel()).toHaveAttribute('hidden');
  });

  it('is not a menu: no role=menu, no menuitem', () => {
    renderCluster();
    expect(document.querySelector('[role="menu"], [role="menuitem"]')).toBeNull();
  });

  it('opens on Enter and on Space, and the panel holds the links in order', async () => {
    const user = userEvent.setup();
    renderCluster();
    toggle().focus();
    await user.keyboard('{Enter}');
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(panel()).not.toHaveAttribute('hidden');
    await user.keyboard('{Escape}');
    await user.keyboard(' ');
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');

    const links = within(panel()).getAllByRole('link');
    expect(links.map((a) => a.textContent)).toEqual(['Cloud Codex', 'Cloud Command', 'All workspaces']);
    expect(links[0]).toHaveAttribute('href', '/');
    expect(links[0]).toHaveAttribute('aria-current', 'true');
    expect(links[1]).toHaveAttribute('href', COMMAND);
    expect(links[1]).not.toHaveAttribute('aria-current');
    expect(links[2]).toHaveAttribute('href', new URL('/?switch=1', COMMAND).href);
    expect(links.some((a) => a.hasAttribute('target'))).toBe(false);
  });

  it('keeps a separator between the products and All workspaces', async () => {
    const user = userEvent.setup();
    renderCluster();
    await user.click(toggle());
    // The separator is aria-hidden, so the role query above skips it; read the list directly.
    const items = [...panel().querySelectorAll('li')];
    expect(items.map((li) => li.className)).toEqual(['', '', 'cc-suite__separator', '']);
    expect(items[2]).toHaveAttribute('aria-hidden', 'true');
    expect(items[2].textContent).toBe('');
  });

  it('ignores the arrow keys', async () => {
    const user = userEvent.setup();
    renderCluster();
    await user.click(toggle());
    const before = document.activeElement;
    await user.keyboard('{ArrowDown}{ArrowUp}');
    expect(document.activeElement).toBe(before);
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('SuiteCluster: closing', () => {
  it('Escape closes it and returns focus to the toggle', async () => {
    const user = userEvent.setup();
    renderCluster();
    await user.click(toggle());
    await user.keyboard('{Escape}');
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(panel()).toHaveAttribute('hidden');
    expect(document.activeElement).toBe(toggle());
  });

  it('an outside press on non-focusable content closes it and returns focus to the toggle', async () => {
    const user = userEvent.setup();
    renderCluster();
    await user.click(toggle());
    await user.click(screen.getByTestId('plain'));
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(toggle());
  });

  it('an outside press on another focusable control closes it and keeps focus on that control', async () => {
    const user = userEvent.setup();
    renderCluster();
    await user.click(toggle());
    const other = screen.getByRole('button', { name: 'outside control' });
    await user.click(other);
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(other);
  });

  it('Tab out of the cluster closes it and leaves focus where Tab put it', async () => {
    const user = userEvent.setup();
    renderCluster();
    await user.click(toggle());
    await user.tab(); // to Cloud Codex
    await user.tab(); // to Cloud Command
    await user.tab(); // to All workspaces
    await user.tab(); // out of the cluster
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'go elsewhere' }));
  });

  it('activating the current product link while on that page closes it and focuses the toggle', async () => {
    const user = userEvent.setup();
    renderCluster('/');
    await user.click(toggle());
    await user.click(within(panel()).getByRole('link', { name: 'Cloud Codex' }));
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(toggle());
  });

  it('a change of history entry closes it, forward or back', async () => {
    const user = userEvent.setup();
    renderCluster('/');
    await user.click(toggle());
    await user.click(screen.getByRole('button', { name: 'go elsewhere' }));
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    await act(async () => { await user.click(screen.getByRole('button', { name: 'back' })); });
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('SuiteCluster: a long suite name', () => {
  const LONG = 'a'.repeat(40);

  it('keeps the full name in the accessible name and in a title on the visible eyebrow', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <SuiteCluster suiteName={LONG} commandWorkspaceUrl={COMMAND} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: `Cloud Codex, ${LONG}: switch app` })).toBeInTheDocument();
    expect(document.querySelector('.cc-suite__eyebrow')).toHaveAttribute('title', LONG);
    expect(document.querySelector('.cc-suite__eyebrow').textContent).toBe(LONG);
  });
});
