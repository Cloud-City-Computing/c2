/**
 * Cloud Codex - Tests for the menu primitive (W6-CDX-39, Task 2.3, momus round 1)
 *
 * The trigger is a button with aria-haspopup, aria-expanded and a name that carries the visible choice.
 * The popup is role="menu" of role="menuitemradio" items with aria-checked (every Menu is single-choice).
 * Its own portal node is never toggled by showDropdownMenu, and inside an aria-modal dialog it is portalled
 * into that dialog. Arrow keys wrap, Home and End jump, a letter jumps to the next item starting with it,
 * Escape and Tab close it and return focus to the trigger, and an outside press closes it.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Menu from '../../../src/components/Menu.jsx';
import { openDialog, closeDialog } from '../../../src/lib/dialog.js';

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

beforeEach(() => {
  document.getElementById('dropdown-root')?.remove();
  document.getElementById('menu-root')?.remove();
  const dropdown = document.createElement('div');
  dropdown.id = 'dropdown-root';
  document.body.appendChild(dropdown);
  const dimmer = document.createElement('div');
  dimmer.id = 'modal-dimmer';
  dimmer.style.display = 'none';
  document.body.appendChild(dimmer);
});
afterEach(() => { cleanup(); document.body.innerHTML = ''; });

describe('Menu - the trigger and its name', () => {
  it('is a button with aria-haspopup="menu" and aria-expanded, closed at first', () => {
    const { trigger } = setup();
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.getAttribute('type')).toBe('button');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('names the trigger with the label and the visible choice (WCAG 2.5.3)', () => {
    const { trigger } = setup();
    expect(trigger.getAttribute('aria-label')).toBe('Sort documents: Newest first');
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

describe('Menu - the popup and its items', () => {
  it('lists each option as a menuitemradio, and checks the current one', async () => {
    const user = userEvent.setup();
    const { trigger } = setup();
    await user.click(trigger);
    const items = screen.getAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent)).toEqual(['Newest first', 'Oldest first', 'Title A to Z']);
    expect(items[0].getAttribute('aria-checked')).toBe('true');
    expect(items[1].getAttribute('aria-checked')).toBe('false');
  });

  it('moves focus with the arrow keys, wrapping at both ends', async () => {
    const user = userEvent.setup();
    const { trigger } = setup();
    await user.click(trigger);
    const items = screen.getAllByRole('menuitemradio');
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
    const items = screen.getAllByRole('menuitemradio');
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(items[2]);
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(items[0]);
  });

  it('jumps to the next item starting with a typed letter, and cycles through matches', async () => {
    const user = userEvent.setup();
    const { trigger } = setup({ items: [
      { key: 'a', label: 'Archive' }, { key: 'n', label: 'Newest first' }, { key: 'o', label: 'Oldest first' },
      { key: 'o2', label: 'Owner' },
    ], value: 'a' });
    await user.click(trigger);
    const items = screen.getAllByRole('menuitemradio');
    await user.keyboard('o');
    expect(document.activeElement).toBe(items[2]);
    await user.keyboard('o');
    expect(document.activeElement).toBe(items[3]);
    await user.keyboard('n');
    expect(document.activeElement).toBe(items[1]);
  });

  it('is not a modal: opening it draws no scrim', async () => {
    const user = userEvent.setup();
    const { trigger } = setup();
    await user.click(trigger);
    expect(document.getElementById('modal-dimmer').style.display).toBe('none');
  });
});

describe('Menu - its own portal, not the account panel\'s (momus 1)', () => {
  it('keeps the popup out of #dropdown-root, which showDropdownMenu hides and clears', async () => {
    const user = userEvent.setup();
    const { trigger } = setup();
    await user.click(trigger);
    const popup = screen.getByRole('menu');
    expect(document.getElementById('dropdown-root').contains(popup)).toBe(false);
    expect(popup.closest('[style*="display: none"]')).toBeNull();
  });

  it('still opens with a visible, focused popup after the account panel was dismissed', async () => {
    const { showDropdownMenu } = await import('../../../src/util.jsx');
    const user = userEvent.setup();
    const { trigger } = setup();
    // The account panel: shown over #dropdown-root, then dismissed through its dimmer.
    act(() => { showDropdownMenu(<div className="account-panel-probe">Account</div>); });
    const dimmer = document.getElementById('modal-dimmer');
    act(() => { dimmer?.click?.(); });
    expect(document.getElementById('dropdown-root').style.display).toBe('none');
    await user.click(trigger);
    const popup = screen.getByRole('menu');
    expect(popup.closest('[style*="display: none"]')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Newest first' }));
  });
});

describe('Menu - closing', () => {
  it('Escape closes it and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    const { trigger } = setup();
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('Tab closes it and returns focus to the trigger, rather than moving on past the menu', async () => {
    const user = userEvent.setup();
    const { trigger } = setup();
    await user.click(trigger);
    await user.keyboard('{Tab}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('Shift+Tab closes it too', async () => {
    const user = userEvent.setup();
    const { trigger } = setup();
    await user.click(trigger);
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('an outside pointer press closes it', async () => {
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
    await user.click(screen.getByRole('menuitemradio', { name: 'Title A to Z' }));
    expect(onSelect).toHaveBeenCalledWith('title');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe('Menu - inside an aria-modal dialog (momus 2 and 8c)', () => {
  let wrapper;
  beforeEach(() => {
    wrapper = document.createElement('div');
    wrapper.className = 'modal-content-wrapper';
    document.body.appendChild(wrapper);
  });
  afterEach(() => {
    closeDialog();
    wrapper.remove();
  });

  function openInDialog(props = {}) {
    const onEscape = vi.fn();
    render(<Menu label="Role:" value="member" items={[{ key: 'member', label: 'Member' }, { key: 'owner', label: 'Owner' }]}
      onSelect={vi.fn()} {...props} />, { container: wrapper });
    openDialog(wrapper, { onEscape });
    return { onEscape, trigger: screen.getByRole('button', { name: /Role:/ }) };
  }

  it('portals the popup into the dialog it is opened from, so assistive tech reaches it', async () => {
    const user = userEvent.setup();
    const { trigger } = openInDialog();
    await user.click(trigger);
    const popup = screen.getByRole('menu');
    expect(wrapper.contains(popup)).toBe(true);
    expect(popup.closest('[aria-modal="true"]')).toBe(wrapper);
  });

  it('Tab inside the dialog closes the menu and leaves focus on the trigger, inside the dialog', async () => {
    const user = userEvent.setup();
    const { trigger } = openInDialog();
    await user.click(trigger);
    await user.keyboard('{Tab}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(wrapper.contains(document.activeElement)).toBe(true);
  });

  it('Escape closes the menu but does not also close the dialog', async () => {
    const user = userEvent.setup();
    const { trigger, onEscape } = openInDialog();
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onEscape).not.toHaveBeenCalled();
  });
});

describe('Menu - the popup follows the trigger (momus 3)', () => {
  it('moves with the trigger when the page scrolls or resizes', async () => {
    const user = userEvent.setup();
    const { trigger } = setup();
    let top = 100;
    trigger.getBoundingClientRect = () => ({ top: top - 30, bottom: top, left: 40, right: 200, width: 160, height: 30, x: 40, y: top - 30 });
    await user.click(trigger);
    const popup = screen.getByRole('menu');
    expect(popup.style.top).toBe('104px');
    top = 260;
    act(() => { window.dispatchEvent(new Event('scroll')); });
    expect(popup.style.top).toBe('264px');
    top = 180;
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(popup.style.top).toBe('184px');
  });

  it('follows a scroll of an ancestor, because the listener is on the capture phase', async () => {
    const user = userEvent.setup();
    const { trigger } = setup();
    let top = 100;
    trigger.getBoundingClientRect = () => ({ top: top - 30, bottom: top, left: 40, right: 200, width: 160, height: 30, x: 40, y: top - 30 });
    await user.click(trigger);
    const popup = screen.getByRole('menu');
    top = 220;
    act(() => { trigger.parentElement.dispatchEvent(new Event('scroll')); });
    expect(popup.style.top).toBe('224px');
  });
});

describe('Menu - the choice is named, and a single-choice menu says so (momus 5)', () => {
  it('gives every item aria-checked, and marks only the current one true', async () => {
    const user = userEvent.setup();
    const { trigger } = setup({ value: 'oldest' });
    await user.click(trigger);
    const checked = screen.getAllByRole('menuitemradio').map((i) => i.getAttribute('aria-checked'));
    expect(checked).toEqual(['false', 'true', 'false']);
  });
});
