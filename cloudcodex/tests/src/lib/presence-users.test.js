/**
 * Cloud Codex - tests for src/lib/presence-users.js
 *
 * One entry per user id: a second connection of the same user is dropped, and an entry with no id
 * is never merged with another entry that has no id.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { oneEntryPerUser } from '../../../src/lib/presence-users.js';

describe('oneEntryPerUser', () => {
  it('keeps the first entry for each user id', () => {
    const list = [
      { id: 1, name: 'Ada', color: '#f00' },
      { id: 1, name: 'Ada', color: '#00f' },
      { id: 2, name: 'Bo', color: '#0f0' },
    ];
    expect(oneEntryPerUser(list)).toEqual([list[0], list[2]]);
  });

  it('does not merge entries that have no id', () => {
    const list = [{ name: 'anon-a' }, { name: 'anon-b' }, { id: null, name: 'anon-c' }];
    expect(oneEntryPerUser(list)).toEqual(list);
  });

  it('returns an empty list for no users', () => {
    expect(oneEntryPerUser(undefined)).toEqual([]);
    expect(oneEntryPerUser([])).toEqual([]);
  });
});
