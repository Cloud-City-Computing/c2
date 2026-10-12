/**
 * Cloud Codex - the Appearance control matches the document header's other icon buttons (W6-CDX-44)
 *
 * In the document header the star and the bell are 30 px borderless icon buttons. The Appearance toggle
 * sits beside them, so it takes the same square, the same padding and no border there.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const css = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/index.css'), 'utf8');

function declarationsOf(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, 'g');
  return [...css.matchAll(match)].map((m) => m[1]).join('\n');
}

describe('the document header keeps the Appearance toggle the size of its icon buttons', () => {
  it('gives .document-header .appearance-toggle a 30 px square, no padding and no border', () => {
    const body = declarationsOf('.document-header .appearance-toggle');
    expect(body, 'add the rule beside .document-header .btn-favorite in src/index.css').not.toBe('');
    expect(body).toMatch(/width:\s*30px/);
    expect(body).toMatch(/height:\s*30px/);
    expect(body).toMatch(/padding:\s*0/);
    expect(body).toMatch(/border-color:\s*transparent/);
  });
});
