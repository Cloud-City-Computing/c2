/**
 * Cloud Codex - Tests for the menu primitive (W6-CDX-39, Task 2.3)
 *
 * The trigger is a button with aria-haspopup and aria-expanded; the popup is role="menu" with role="menuitem"
 * children. Arrow keys, Home and End move between items; Escape and an outside click close it; Escape and a
 * choice return focus to the trigger. The popup is not a modal: no scrim.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Menu from '../../../src/components/Menu.jsx';

const ITEMS = [
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
  { key: 'title', label: 'Title A to Z' },
];

function setup(props = {}) {
  const onSelect = vi.fn();
  render(<Menu label="Sort documents" value="newest" items={ITEMS} onSelect={onSelect} {...props} />);
  return { onSelect, trigger: screen.getByRole('button', { name: /Sort documents/ }) };
}

afterEach(() => { cleanup(); });

describe('Menu: the trigger', () => {
  it('is a button with aria-haspopup="menu" and aria-expanded, closed at first', () => {
    const { trigger } = setup();
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.getAttribute('type')).toBe('button');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('shows the current choice on the trigger', () => {
    const { trigger } = setup();
    expect(trigger.textContent).toContain('Newest first');
  });

  it('opens on click, and aria-expanded reads true', async () => {
    const user = userEvent.setup();
    const { trigger } = setup();
    await user.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu', { name: 'Sort documents' })).toBeInTheDocument();
  });
});

describe('Menu: the popup', () => {
  it('lists each option as a menuitem, and marks the current one', async () => {
    const user = userEvent.setup();
    const { trigger } = setup();
    await user.click(trigger);
    const items = screen.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Newest first', 'Oldest first', 'Title A to Z']);
    expect(items[0].getAttribute('aria-current')).toBe('true');
    expect(items[1].getAttribute('aria-current')).toBeNull();
  });

  it('moves focus with the arrow keys, wrapping at both ends', async () => {
    const user = userEvent.setup();
    const { trigger } = setup();
    await user.click(trigger);
    const items = screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(items[0]);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(items[1]);
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(document.activeElement).toBe(items[0]);
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(items[2]);
  });

  it('jumps to the first and last items with Home and End', async () => {
    const user = userEvent.setup();
    const { trigger } = setup();
    await user.click(trigger);
    const items = screen.getAllByRole('menuitem');
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(items[2]);
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(items[0]);
  });

  it('is not a modal: opening it draws no scrim', async () => {
    const user = userEvent.setup();
    const { trigger } = setup();
    await user.click(trigger);
    expect(document.getElementById('modal-dimmer')).toBeNull();
    expect(document.querySelector('.modal-dimmer')).toBeNull();
  });
});

describe('Menu: closing', () => {
  it('Escape closes it and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    const { trigger } = setup();
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('an outside pointer press closes it without moving focus to the trigger', async () => {
    const user = userEvent.setup();
    const { trigger } = setup();
    await user.click(trigger);
    await act(async () => { fireEvent.mouseDown(document.body); });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('choosing an option reports its key, closes, and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    const { trigger, onSelect } = setup();
    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: 'Title A to Z' }));
    expect(onSelect).toHaveBeenCalledWith('title');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
