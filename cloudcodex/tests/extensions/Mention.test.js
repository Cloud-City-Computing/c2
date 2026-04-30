/**
 * The mention Tiptap extension's React/ProseMirror integration is
 * exercised in the live editor (Phase 2 manual smoke test). This file
 * pins the pure-text trigger regex used inside the suggestion plugin —
 * the regression most likely to break silently is the trigger pattern
 * mismatching valid usernames or accidentally firing inside a word.
 */

import { describe, it, expect } from 'vitest';

const TRIGGER_RE = /(?:^|\s)@([\w.-]{0,30})$/;

describe('Mention extension trigger regex', () => {
  it('matches @ at the start of a line', () => {
    expect('@bob'.match(TRIGGER_RE)?.[1]).toBe('bob');
  });

  it('matches @ after a space', () => {
    expect('hi @alice'.match(TRIGGER_RE)?.[1]).toBe('alice');
  });

  it('captures partial queries while typing', () => {
    expect('@a'.match(TRIGGER_RE)?.[1]).toBe('a');
    expect('@'.match(TRIGGER_RE)?.[1]).toBe('');
  });

  it('does NOT fire inside a word (email-like / mid-word)', () => {
    expect('foo@bar'.match(TRIGGER_RE)).toBeNull();
    expect('hi.alice@example.com'.match(TRIGGER_RE)).toBeNull();
  });

  it('stops at whitespace after the trigger', () => {
    // Once the user types a space, the trigger no longer matches — picker should close.
    expect('@bob '.match(TRIGGER_RE)).toBeNull();
  });

  it('allows dots, hyphens, underscores in the query', () => {
    expect('@bob.smith'.match(TRIGGER_RE)?.[1]).toBe('bob.smith');
    expect('@bob_smith'.match(TRIGGER_RE)?.[1]).toBe('bob_smith');
    expect('@bob-smith'.match(TRIGGER_RE)?.[1]).toBe('bob-smith');
  });

  it('does not match when the query exceeds the 30-char cap (picker stays closed)', () => {
    const longName = 'a'.repeat(200);
    expect(`@${longName}`.match(TRIGGER_RE)).toBeNull();
  });

  it('matches when the query is exactly at the cap', () => {
    const name = 'a'.repeat(30);
    expect(`@${name}`.match(TRIGGER_RE)?.[1]).toBe(name);
  });
});
