/**
 * Cloud Codex - The unsaved-changes registry the layout and the unload guard read (momus item 1)
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setUnsaved,
  hasUnsavedChanges,
  unsavedCopyText,
  __resetUnsaved,
} from '../../../src/lib/unsaved-changes.js';

function unloadPrevented() {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

beforeEach(() => {
  __resetUnsaved();
});

describe('the unsaved-changes registry', () => {
  it('reports no unsaved changes until an editor marks one', () => {
    expect(hasUnsavedChanges()).toBe(false);
    setUnsaved('editor', true, () => 'draft');
    expect(hasUnsavedChanges()).toBe(true);
    expect(unsavedCopyText()).toBe('draft');
    setUnsaved('editor', false);
    expect(hasUnsavedChanges()).toBe(false);
    expect(unsavedCopyText()).toBe('');
  });
});

describe('the beforeunload guard', () => {
  it('asks before the page goes while an editor is dirty, and not otherwise', () => {
    expect(unloadPrevented()).toBe(false);
    setUnsaved('editor', true, () => 'draft');
    expect(unloadPrevented()).toBe(true);
    setUnsaved('editor', false);
    expect(unloadPrevented()).toBe(false);
  });
});
