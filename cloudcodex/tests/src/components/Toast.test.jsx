/**
 * Cloud Codex — Tests for src/components/Toast.jsx
 *
 * Toast has a known timing quirk: showToast invokes mountContainer() on the
 * first call, but addToastFn is only registered in a useEffect that runs on
 * the next React tick — so the very first toast after a fresh module load
 * is silently dropped. The tests below work around this by either calling
 * showToast twice or by waiting a tick before the meaningful call.
 *
 * Each test uses vi.resetModules() so the singleton state doesn't bleed
 * across tests.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import { act, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import userEvent from '@testing-library/user-event';

let showToast, toastError;

beforeEach(async () => {
  document.body.innerHTML = '';
  vi.resetModules();
  ({ showToast, toastError } = await import('../../../src/components/Toast.jsx'));
});

/**
 * Workaround: the first showToast call after a module reset mounts the
 * container synchronously but registers the dispatcher on the next tick.
 * `act` flushes pending React effects so the dispatcher is wired before
 * the real toast call.
 */
async function primeAndShow(...args) {
  await act(async () => {
    showToast('priming-call');
  });
  await act(async () => {
    showToast(...args);
  });
}

describe('Toast — basic rendering', () => {
  it('mounts a #toast-root and renders the message', async () => {
    await primeAndShow('Hello world');
    const root = document.getElementById('toast-root');
    expect(root).not.toBeNull();
    expect(root.textContent).toContain('Hello world');
  });

  it('default type is info; renders the info icon', async () => {
    await primeAndShow('Just info');
    const toast = Array.from(document.querySelectorAll('.toast')).find((t) =>
      t.textContent.includes('Just info')
    );
    expect(toast.className).toMatch(/toast--info/);
    expect(toast.querySelector('.toast__icon svg')).not.toBeNull();
    expect(toast.querySelector('.toast__icon').textContent).toBe('');
  });

  it('renders a success toast with a check icon', async () => {
    await primeAndShow('Saved!', 'success');
    const toast = Array.from(document.querySelectorAll('.toast--success')).find((t) =>
      t.textContent.includes('Saved!')
    );
    expect(toast).toBeDefined();
    expect(toast.querySelector('.toast__icon svg')).not.toBeNull();
    expect(toast.querySelector('.toast__icon').textContent).toBe('');
  });

  it('renders an error toast with a cross icon', async () => {
    await primeAndShow('Boom', 'error');
    const toast = Array.from(document.querySelectorAll('.toast--error')).find((t) =>
      t.textContent.includes('Boom')
    );
    expect(toast).toBeDefined();
    expect(toast.querySelector('.toast__icon svg')).not.toBeNull();
    expect(toast.querySelector('.toast__icon').textContent).toBe('');
  });
});

describe('Toast — toastError formatting', () => {
  it('prefixes 403 errors with "Permission denied:"', async () => {
    await act(async () => { showToast('priming-call'); });
    await act(async () => {
      toastError(Object.assign(new Error('You shall not pass'), { status: 403 }));
    });
    expect(document.body.textContent).toContain('Permission denied: You shall not pass');
  });

  it('uses err.body.message when available', async () => {
    await act(async () => { showToast('priming-call'); });
    await act(async () => {
      toastError({ body: { message: 'Body says no' }, status: 500 });
    });
    expect(document.body.textContent).toContain('Body says no');
  });

  it('falls back to a generic message when given null', async () => {
    await act(async () => { showToast('priming-call'); });
    await act(async () => { toastError(null); });
    expect(document.body.textContent).toContain('An unexpected error occurred');
  });

  it('uses err.message when there is no body', async () => {
    await act(async () => { showToast('priming-call'); });
    await act(async () => { toastError(new Error('Plain error')); });
    expect(document.body.textContent).toContain('Plain error');
  });
});

const toastWith = (text) => Array.from(document.querySelectorAll('.toast'))
  .find((t) => t.textContent.includes(text));

describe('Toast — the dismiss is a real, keyboard-operable button', () => {

  it('renders a button of type "button", named for screen readers, in every toast', async () => {
    await primeAndShow('Named dismiss');
    const button = toastWith('Named dismiss').querySelector('button.toast__dismiss');
    expect(button).not.toBeNull();
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-label')).toBe('Dismiss notification');
    expect(screen.getAllByRole('button', { name: 'Dismiss notification' }).length)
      .toBe(document.querySelectorAll('.toast').length);
  });

  it('is reached by Tab, and Enter dismisses the toast', async () => {
    const user = userEvent.setup();
    await primeAndShow('Keyboard dismiss');
    const button = toastWith('Keyboard dismiss').querySelector('button.toast__dismiss');
    let reached = false;
    for (let i = 0; i < 4 && !reached; i += 1) {
      await user.tab();
      reached = document.activeElement === button;
    }
    expect(reached, 'Tab never reached the dismiss button').toBe(true);
    await user.keyboard('{Enter}');
    expect(toastWith('Keyboard dismiss')).toBeUndefined();
  });

  it('dismisses with Space too, as a native button does', async () => {
    const user = userEvent.setup();
    await primeAndShow('Space dismiss');
    const button = toastWith('Space dismiss').querySelector('button.toast__dismiss');
    await act(async () => { button.focus(); });
    await user.keyboard(' ');
    expect(toastWith('Space dismiss')).toBeUndefined();
  });

  it('no longer dismisses on a click on the body of the toast, only on its button', async () => {
    const user = userEvent.setup();
    await primeAndShow('Stays put');
    await user.click(toastWith('Stays put').querySelector('.toast__message'));
    expect(toastWith('Stays put')).toBeDefined();
  });

  it('gives an error role="alert" and a success or info role="status", with no live region around them', async () => {
    await primeAndShow('Announced', 'error');
    showToastNow('Saved here', 'success');
    showToastNow('Note here', 'info');
    expect(toastWith('Announced').getAttribute('role')).toBe('alert');
    expect(toastWith('Saved here').getAttribute('role')).toBe('status');
    expect(toastWith('Note here').getAttribute('role')).toBe('status');
    // One live mechanism per toast: the container is not a second, nested live region.
    expect(document.querySelector('.toast-container').hasAttribute('aria-live')).toBe(false);
  });
});

function showToastNow(...args) {
  act(() => { showToast(...args); });
}

describe('Toast — timers pause while the toast is held, and focus is kept', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const present = (text) => Boolean(toastWith(text));
  const dismissOf = (text) => toastWith(text).querySelector('button.toast__dismiss');

  it('holds a toast while its dismiss has focus, and resumes the time it had left when focus goes', async () => {
    await primeAndShow('Focus holds');
    act(() => { dismissOf('Focus holds').focus(); });
    act(() => { vi.advanceTimersByTime(10000); });
    expect(present('Focus holds'), 'the toast left under focus').toBe(true);
    act(() => { dismissOf('Focus holds').blur(); });
    act(() => { vi.advanceTimersByTime(3500); });
    expect(present('Focus holds'), 'resumed too early').toBe(true);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(present('Focus holds'), 'never resumed').toBe(false);
  });

  it('pauses on hover and resumes with the time it had left', async () => {
    await primeAndShow('Hover holds');
    const toast = toastWith('Hover holds');
    act(() => { toast.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    act(() => { vi.advanceTimersByTime(10000); });
    expect(present('Hover holds'), 'the toast left under the pointer').toBe(true);
    act(() => { toast.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })); });
    act(() => { vi.advanceTimersByTime(3900); });
    expect(present('Hover holds'), 'resumed too early').toBe(true);
    act(() => { vi.advanceTimersByTime(200); });
    expect(present('Hover holds'), 'never resumed').toBe(false);
  });

  it('keeps the pause while focus stays inside the toast, even when the pointer leaves', async () => {
    await primeAndShow('Still held');
    const toast = toastWith('Still held');
    act(() => { dismissOf('Still held').focus(); });
    act(() => { toast.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })); });
    act(() => { vi.advanceTimersByTime(10000); });
    expect(present('Still held')).toBe(true);
  });

  it('moves focus to the toast container when the focused toast is dismissed with the keyboard', async () => {
    await primeAndShow('Dismissed by key');
    act(() => { dismissOf('Dismissed by key').focus(); });
    // A browser fires a button's click on Enter or Space; the keyboard path is pinned above, so click here.
    act(() => { dismissOf('Dismissed by key').click(); });
    expect(present('Dismissed by key')).toBe(false);
    expect(document.activeElement).toBe(document.querySelector('.toast-container'));
  });
});

// X2 and X3 (W6-CDX-39). The first toast after a fresh module load is queued and shown, not dropped,
// and toastError takes a plain string as the message, so a caller can pass a server message through.
describe('Toast — the first call and a string error (X2, X3)', () => {
  it('shows the first toast after a fresh load, with no priming call', async () => {
    vi.resetModules();
    const fresh = await import('../../../src/components/Toast.jsx');
    document.body.innerHTML = '';
    act(() => { fresh.showToast('First', 'info'); });
    expect(await screen.findByText('First')).toBeInTheDocument();
  });

  it('shows a string passed to toastError as the message', async () => {
    await act(async () => { showToast('priming-call'); });
    await act(async () => { toastError('Could not revoke the invitation.'); });
    expect(await screen.findByText('Could not revoke the invitation.')).toBeInTheDocument();
  });

  it('shows the message of an error that carries a server body, as before', async () => {
    await act(async () => { showToast('priming-call'); });
    await act(async () => {
      toastError({ body: { message: 'Could not revoke the invitation. Try again in a moment.' }, status: 500 });
    });
    expect(await screen.findByText('Could not revoke the invitation. Try again in a moment.')).toBeInTheDocument();
  });
});

// X10 and the placement: the stylesheet has a rule for the info toast, the stack is bottom right, and the
// message is the primary text colour with the status on the icon and the edge.
describe('Toast — the stylesheet (X10 and the placement)', () => {
  const css = readFileSync(path.resolve(__dirname, '../../../src/index.css'), 'utf8');
  const rule = (selector) => {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`, 'g');
    let body;
    for (const hit of css.matchAll(m)) body = hit[1];
    return body;
  };

  it('has a .toast--info rule', () => {
    expect(rule('.toast--info'), 'no .toast--info rule').toBeDefined();
  });

  it('stacks the container at the bottom right', () => {
    const body = rule('.toast-container');
    expect(body).toMatch(/bottom:\s*16px/);
    expect(body).toMatch(/right:\s*16px/);
    expect(body).not.toMatch(/top:\s*16px/);
  });

  it('paints the message in the primary text colour, not the status colour', () => {
    expect(rule('.toast')).toMatch(/color:\s*var\(--cx-text-primary\)/);
    expect(rule('.toast--error')).not.toMatch(/(^|;|\s)color:/);
  });
});
