/**
 * Cloud Codex — Tests for src/hooks/useClickOutside.js
 *
 * Frontend project (jsdom). Drives the hook with renderHook and simulates
 * pointerdown events on / outside of the ref'd element to verify the
 * onClose callback fires only on outside clicks.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRef } from 'react';
import useClickOutside from '../../../src/hooks/useClickOutside.js';

describe('useClickOutside', () => {
  it('calls onClose when a pointerdown happens outside the ref element', () => {
    const inside = document.createElement('div');
    const outside = document.createElement('div');
    document.body.appendChild(inside);
    document.body.appendChild(outside);

    const onClose = vi.fn();
    renderHook(() => {
      const ref = useRef(inside);
      useClickOutside(ref, true, onClose);
    });

    outside.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);

    inside.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1); // unchanged
  });

  it('does NOT attach a listener when active is false', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const onClose = vi.fn();

    renderHook(() => {
      const ref = useRef(el);
      useClickOutside(ref, false, onClose);
    });

    document.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('removes the listener on unmount', () => {
    const inside = document.createElement('div');
    const outside = document.createElement('div');
    document.body.appendChild(inside);
    document.body.appendChild(outside);

    const onClose = vi.fn();
    const { unmount } = renderHook(() => {
      const ref = useRef(inside);
      useClickOutside(ref, true, onClose);
    });

    unmount();

    outside.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does nothing when ref.current is null', () => {
    const onClose = vi.fn();
    renderHook(() => {
      const ref = useRef(null);
      useClickOutside(ref, true, onClose);
    });

    document.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    // ref.current is null so the contains-check short-circuits.
    expect(onClose).not.toHaveBeenCalled();
  });
});
