/**
 * Cloud Codex - the action mode of the menu primitive (W6-CDX-41, Task 4.1)
 *
 * An action menu (the "More actions" button on a list row) is the same popup as the radio menu, with three
 * differences: its trigger names the menu and shows no choice, its items are role="menuitem" with no aria-checked,
 * and an item may be flagged danger (a text colour, not a solid button). Keyboard and placement are shared with the
 * radio mode, so these tests pin only what differs, plus the shared close paths.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Menu from '../../../src/components/Menu.jsx';

const ACTIONS = [
  { key: 'rename', label: 'Rename' },
  { key: 'access', label: 'Manage access' },
  { key: 'delete', label: 'Delete', danger: true },
];

function setup() {
  const onSelect = vi.fn();
  render(<Menu mode="actions" label="More actions" items={ACTIONS} onSelect={onSelect} />);
  return { onSelect, trigger: screen.getByRole('button', { name: 'More actions' }) };
}

describe('Menu in actions mode', () => {
  afterEach(() => cleanup());

  it('names its trigger for the menu and shows no choice', () => {
    const { trigger } = setup();
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger.querySelector('.menu-trigger__value')?.textContent ?? '').toBe('');
  });

  it('lists its items as menuitems with no aria-checked, and flags the danger one', async () => {
    const { trigger } = setup();
    await userEvent.click(trigger);
    const items = screen.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Rename', 'Manage access', 'Delete']);
    for (const item of items) expect(item).not.toHaveAttribute('aria-checked');
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveClass('menu__item--danger');
    expect(screen.getByRole('menuitem', { name: 'Rename' })).not.toHaveClass('menu__item--danger');
  });

  it('calls onSelect once with the key, and closes', async () => {
    const { trigger, onSelect } = setup();
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Manage access' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('access');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('restores focus to the trigger before onSelect runs, so a dialog it opens records the trigger', async () => {
    const seen = [];
    const onSelect = vi.fn(() => seen.push(document.activeElement));
    render(<Menu mode="actions" label="More actions for Row" items={ACTIONS} onSelect={onSelect} />);
    const trigger = screen.getByRole('button', { name: 'More actions for Row' });
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(seen).toEqual([trigger]);
  });

  it('moves between items with the arrow keys and closes on Escape, returning focus to the trigger', async () => {
    const { trigger, onSelect } = setup();
    await userEvent.click(trigger);
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Manage access' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'End' });
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('closes on an outside press without choosing anything', async () => {
    const { trigger, onSelect } = setup();
    await userEvent.click(trigger);
    await userEvent.click(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('keeps the radio mode unchanged when no mode is given', async () => {
    const onSelect = vi.fn();
    render(<Menu label="Sort" value="a" items={[{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }]} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sort: A' }));
    expect(screen.getByRole('menuitemradio', { name: 'A' })).toHaveAttribute('aria-checked', 'true');
  });
});
