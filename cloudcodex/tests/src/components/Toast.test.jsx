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

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from '@testing-library/react';

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
    expect(toast.textContent).toContain('ℹ');
  });

  it('renders a success toast with ✓ icon', async () => {
    await primeAndShow('Saved!', 'success');
    const toast = Array.from(document.querySelectorAll('.toast--success')).find((t) =>
      t.textContent.includes('Saved!')
    );
    expect(toast).toBeDefined();
    expect(toast.textContent).toContain('✓');
  });

  it('renders an error toast with ✕ icon', async () => {
    await primeAndShow('Boom', 'error');
    const toast = Array.from(document.querySelectorAll('.toast--error')).find((t) =>
      t.textContent.includes('Boom')
    );
    expect(toast).toBeDefined();
    expect(toast.textContent).toContain('✕');
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
