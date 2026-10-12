/**
 * The deferred families (editor canvas, comments, GitHub surface) change colour only (K3, W6-CDX-43)
 *
 * tests/design/geometry-fingerprint.json is the digest of every non-colour declaration in those sections, written
 * before this track changed a colour. A change to any of them is a layout change, and belongs to UI-later.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './buckets.js';
import { geometryFingerprint } from './geometry.js';

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const pinned = JSON.parse(read('tests/design/geometry-fingerprint.json'));
const MESSAGE = 'A deferred surface changed geometry. This track may change colour only there (K3); a layout change belongs to UI-later.';

describe('the deferred families change colour only', () => {
  it('reads the same non-colour declarations as the fingerprint written at the start of W6-CDX-43', () => {
    // The definitions of the tokens these rules read come from the three stylesheets the page loads.
    const sources = [read('vendor/cloud-city-design/core.css'), read('src/codex.css'), read('src/index.css')];
    const now = geometryFingerprint(read('src/index.css'), sources);
    expect(now.declarations, MESSAGE).toBe(pinned.declarations);
    expect(now.sha256, MESSAGE).toBe(pinned.sha256);
  });

  it('covers a real surface: the comments, the editor canvas and the GitHub banners are all in scope', () => {
    expect(pinned.declarations).toBeGreaterThan(1000);
  });
});
