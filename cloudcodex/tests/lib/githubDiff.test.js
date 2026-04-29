/**
 * Cloud Codex - Tests for src/lib/githubDiff.js
 *
 * Pure-function tests: no DB, no fetch, no React.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { parsePatch, splitLines, lcsIndices, diff3Merge } from '../../src/lib/githubDiff.js';

describe('parsePatch', () => {
  it('returns empty array for empty input', () => {
    expect(parsePatch('')).toEqual([]);
    expect(parsePatch(null)).toEqual([]);
  });

  it('parses a single hunk with adds, deletes, and context', () => {
    const patch = [
      '@@ -1,3 +1,4 @@',
      ' line1',
      '-line2',
      '+line2-changed',
      '+line2-extra',
      ' line3',
    ].join('\n');
    const hunks = parsePatch(patch);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].oldStart).toBe(1);
    expect(hunks[0].newStart).toBe(1);
    expect(hunks[0].lines).toHaveLength(5);
    expect(hunks[0].lines[0]).toEqual({ type: 'ctx', oldNum: 1, newNum: 1, content: 'line1' });
    expect(hunks[0].lines[1]).toEqual({ type: 'del', oldNum: 2, newNum: null, content: 'line2' });
    expect(hunks[0].lines[2].type).toBe('add');
    expect(hunks[0].lines[2].newNum).toBe(2);
  });

  it('parses multiple hunks', () => {
    const patch = [
      '@@ -1,1 +1,1 @@',
      '-old',
      '+new',
      '@@ -10,1 +10,1 @@',
      '-foo',
      '+bar',
    ].join('\n');
    expect(parsePatch(patch)).toHaveLength(2);
  });

  it('skips "\\ No newline" markers', () => {
    const patch = '@@ -1,1 +1,1 @@\n-x\n+y\n\\ No newline at end of file';
    const [hunk] = parsePatch(patch);
    expect(hunk.lines).toHaveLength(2);
    expect(hunk.lines[0].type).toBe('del');
    expect(hunk.lines[1].type).toBe('add');
  });
});

describe('splitLines', () => {
  it('returns empty array for empty input', () => {
    expect(splitLines('')).toEqual([]);
    expect(splitLines(null)).toEqual([]);
    expect(splitLines(undefined)).toEqual([]);
  });

  it('splits on \\n preserving empty trailing line', () => {
    expect(splitLines('a\nb')).toEqual(['a', 'b']);
    expect(splitLines('a\nb\n')).toEqual(['a', 'b', '']);
  });
});

describe('lcsIndices', () => {
  it('returns [] for empty inputs', () => {
    expect(lcsIndices([], ['a'])).toEqual([]);
    expect(lcsIndices(['a'], [])).toEqual([]);
  });

  it('finds the LCS of two simple sequences', () => {
    const out = lcsIndices(['a', 'b', 'c'], ['a', 'x', 'c']);
    expect(out).toEqual([[0, 0], [2, 2]]);
  });

  it('handles full match', () => {
    const out = lcsIndices(['a', 'b'], ['a', 'b']);
    expect(out).toEqual([[0, 0], [1, 1]]);
  });

  it('handles no match', () => {
    expect(lcsIndices(['a'], ['b'])).toEqual([]);
  });
});

describe('diff3Merge', () => {
  it('returns the unchanged base when neither side modified anything', () => {
    const base = 'a\nb\nc';
    const result = diff3Merge(base, base, base);
    expect(result.hasConflict).toBe(false);
    expect(result.merged).toBe(base);
  });

  it('takes our change when only ours differs from base', () => {
    const base = 'a\nb\nc';
    const ours = 'a\nb-changed\nc';
    const theirs = base;
    const result = diff3Merge(ours, base, theirs);
    expect(result.hasConflict).toBe(false);
    expect(result.merged).toBe('a\nb-changed\nc');
  });

  it('takes their change when only theirs differs from base', () => {
    const base = 'a\nb\nc';
    const ours = base;
    const theirs = 'a\nb-changed\nc';
    const result = diff3Merge(ours, base, theirs);
    expect(result.hasConflict).toBe(false);
    expect(result.merged).toBe('a\nb-changed\nc');
  });

  it('keeps both edits when they touch different non-overlapping hunks', () => {
    const base = 'line1\nline2\nline3';
    const ours = 'line1-mine\nline2\nline3';
    const theirs = 'line1\nline2\nline3-theirs';
    const result = diff3Merge(ours, base, theirs);
    expect(result.hasConflict).toBe(false);
    expect(result.merged).toContain('line1-mine');
    expect(result.merged).toContain('line3-theirs');
  });

  it('reports a conflict when both sides edit the same hunk differently', () => {
    const base = 'line1\nshared\nline3';
    const ours = 'line1\nlocal change\nline3';
    const theirs = 'line1\nremote change\nline3';
    const result = diff3Merge(ours, base, theirs);
    expect(result.hasConflict).toBe(true);
    expect(result.conflicts).toHaveLength(1);
    expect(result.merged).toContain('<<<<<<< ours');
    expect(result.merged).toContain('=======');
    expect(result.merged).toContain('>>>>>>> theirs');
    expect(result.merged).toContain('local change');
    expect(result.merged).toContain('remote change');
  });

  it('does not flag a conflict when both sides made the same change', () => {
    const base = 'line1\nshared\nline3';
    const ours = 'line1\nidentical change\nline3';
    const theirs = 'line1\nidentical change\nline3';
    const result = diff3Merge(ours, base, theirs);
    expect(result.hasConflict).toBe(false);
    expect(result.merged).toContain('identical change');
  });

  it('handles purely additive changes on both sides', () => {
    const base = 'a\nb';
    const ours = 'a\nlocal-add\nb';
    const theirs = 'a\nb\ntheirs-add';
    const result = diff3Merge(ours, base, theirs);
    expect(result.hasConflict).toBe(false);
    expect(result.merged).toContain('local-add');
    expect(result.merged).toContain('theirs-add');
  });
});
