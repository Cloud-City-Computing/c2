/**
 * Diff and 3-way merge helpers for GitHub bidirectional sync.
 *
 * Pure-function library (no React, no DOM, no fetch) so it is reusable from
 * the merge dialog, the PR diff viewer, and Vitest unit tests. All algorithms
 * are line-based and operate on `\n`-delimited strings.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

/**
 * Parse a unified diff patch string into structured hunks.
 * Each hunk: { header, oldStart, oldLines, newStart, newLines, context, lines[] }
 * Each line: { type: 'add'|'del'|'ctx', oldNum, newNum, content }
 */
export function parsePatch(patch) {
  if (!patch) return [];
  const rawLines = patch.split('\n');
  const hunks = [];
  let current = null;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of rawLines) {
    const hunkMatch = raw.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)/);
    if (hunkMatch) {
      current = {
        header: raw,
        oldStart: parseInt(hunkMatch[1], 10),
        oldLines: hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1,
        newStart: parseInt(hunkMatch[3], 10),
        newLines: hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1,
        context: hunkMatch[5] || '',
        lines: [],
      };
      hunks.push(current);
      oldLine = current.oldStart;
      newLine = current.newStart;
      continue;
    }
    if (!current) continue;
    if (raw.startsWith('+')) {
      current.lines.push({ type: 'add', oldNum: null, newNum: newLine, content: raw.slice(1) });
      newLine++;
    } else if (raw.startsWith('-')) {
      current.lines.push({ type: 'del', oldNum: oldLine, newNum: null, content: raw.slice(1) });
      oldLine++;
    } else if (raw.startsWith('\\')) {
      continue;
    } else {
      current.lines.push({ type: 'ctx', oldNum: oldLine, newNum: newLine, content: raw.startsWith(' ') ? raw.slice(1) : raw });
      oldLine++;
      newLine++;
    }
  }
  return hunks;
}

/**
 * Split a string into lines preserving the trailing-newline distinction.
 * Empty input returns [].
 */
export function splitLines(text) {
  if (text === null || text === undefined) return [];
  const s = String(text);
  if (s === '') return [];
  return s.split('\n');
}

/**
 * Compute the longest common subsequence between two arrays.
 * Returns an array of [aIndex, bIndex] pairs, sorted by aIndex.
 * O(m*n) time and space — fine for documents up to a few thousand lines.
 */
export function lcsIndices(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return [];

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const out = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      out.push([i - 1, j - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  return out.reverse();
}

/**
 * Three-way line-based merge.
 *
 * Inspired by the classic diff3 algorithm: we find the LCS of (base, ours)
 * and (base, theirs), walk through base, and emit chunks as either
 * unchanged, our-side-changed, their-side-changed, both-side-same-change,
 * or conflict.
 *
 * @param {string} ours    - the local content (winning side preference on ties)
 * @param {string} base    - the merge-base content (last common ancestor)
 * @param {string} theirs  - the remote content
 * @returns {{ merged: string, hasConflict: boolean, conflicts: Array<{ ours: string[], base: string[], theirs: string[] }>, hunks: Array<MergeChunk> }}
 *
 * MergeChunk = { type: 'stable'|'ours'|'theirs'|'both'|'conflict', lines: string[], ours?: string[], theirs?: string[], base?: string[] }
 */
export function diff3Merge(ours, base, theirs) {
  const a = splitLines(ours);
  const o = splitLines(base);
  const b = splitLines(theirs);

  const matchAO = lcsIndices(a, o);
  const matchBO = lcsIndices(b, o);

  // Build per-o-line maps to a-index and b-index where that o-line matches.
  // Keep the first match in case of duplicate lines.
  const oToA = new Map();
  for (const [ai, oi] of matchAO) {
    if (!oToA.has(oi)) oToA.set(oi, ai);
  }
  const oToB = new Map();
  for (const [bi, oi] of matchBO) {
    if (!oToB.has(oi)) oToB.set(oi, bi);
  }

  // Sync points: o-indices that appear in BOTH LCSs (i.e. both sides preserved).
  const syncOIndices = [];
  for (let oi = 0; oi < o.length; oi++) {
    if (oToA.has(oi) && oToB.has(oi)) syncOIndices.push(oi);
  }

  const chunks = [];
  let aCursor = 0;
  let oCursor = 0;
  let bCursor = 0;

  function pushOursTheirsChunk(aSlice, oSlice, bSlice) {
    const aText = aSlice.join('\n');
    const oText = oSlice.join('\n');
    const bText = bSlice.join('\n');
    if (aText === oText && bText === oText) {
      // No change on either side
      if (aSlice.length) chunks.push({ type: 'stable', lines: aSlice });
    } else if (aText === oText) {
      // Only theirs changed → take theirs
      if (bSlice.length) chunks.push({ type: 'theirs', lines: bSlice });
    } else if (bText === oText) {
      // Only ours changed → take ours
      if (aSlice.length) chunks.push({ type: 'ours', lines: aSlice });
    } else if (aText === bText) {
      // Both made the same change → take it
      if (aSlice.length) chunks.push({ type: 'both', lines: aSlice });
    } else {
      // Conflict
      chunks.push({ type: 'conflict', ours: aSlice, base: oSlice, theirs: bSlice });
    }
  }

  for (const syncOi of syncOIndices) {
    const aSyncIdx = oToA.get(syncOi);
    const bSyncIdx = oToB.get(syncOi);

    // Slices BEFORE this sync point, on each axis
    const aSlice = a.slice(aCursor, aSyncIdx);
    const oSlice = o.slice(oCursor, syncOi);
    const bSlice = b.slice(bCursor, bSyncIdx);

    pushOursTheirsChunk(aSlice, oSlice, bSlice);

    // Stable line itself
    chunks.push({ type: 'stable', lines: [o[syncOi]] });

    aCursor = aSyncIdx + 1;
    oCursor = syncOi + 1;
    bCursor = bSyncIdx + 1;
  }

  // Trailing slices after the last sync point
  const aTail = a.slice(aCursor);
  const oTail = o.slice(oCursor);
  const bTail = b.slice(bCursor);
  pushOursTheirsChunk(aTail, oTail, bTail);

  // Coalesce adjacent same-type chunks for cleaner conflict markers
  const coalesced = [];
  for (const ch of chunks) {
    const last = coalesced[coalesced.length - 1];
    if (last && last.type === ch.type && ch.type !== 'conflict') {
      last.lines = last.lines.concat(ch.lines);
    } else {
      coalesced.push(ch);
    }
  }

  // Render merged output. Conflicts get standard <<<<<<< / ======= / >>>>>>> markers.
  const conflicts = [];
  const out = [];
  for (const ch of coalesced) {
    if (ch.type === 'conflict') {
      conflicts.push({ ours: ch.ours, base: ch.base, theirs: ch.theirs });
      out.push('<<<<<<< ours');
      out.push(...ch.ours);
      out.push('=======');
      out.push(...ch.theirs);
      out.push('>>>>>>> theirs');
    } else {
      out.push(...ch.lines);
    }
  }

  return {
    merged: out.join('\n'),
    hasConflict: conflicts.length > 0,
    conflicts,
    hunks: coalesced,
  };
}

/**
 * Compare two strings line-by-line and report whether they differ.
 * Used for cheap "local has changed since baseline" checks.
 */
export function contentEqual(a, b) {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a) === String(b);
}
