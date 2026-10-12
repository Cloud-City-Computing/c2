/**
 * Cloud Codex - The pre-paint theme script is pinned by its hash (W6-CDX-44)
 *
 * index.html carries one inline script that sets the theme and accent before first paint. The
 * production Content-Security-Policy allows it by SHA-256 (theme-boot-hash.js), not by a nonce or
 * 'unsafe-inline'. These tests hold the three copies to one set of bytes: the script in index.html,
 * the constant, and the script Vite writes into the built dist/index.html.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { THEME_BOOT_HASH } from '../theme-boot-hash.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRIFT = 'Update all three together: the inline script in index.html, its SHA-256 in '
  + 'cloudcodex/theme-boot-hash.js (the value app.js puts in script-src), and nothing else.';

// The inline script's exact bytes: the text between its <script> and </script>, as a browser hashes it.
function inlineScript(html) {
  const match = /<script>([\s\S]*?)<\/script>/.exec(html);
  if (!match) throw new Error('index.html has no inline <script>');
  return match[1];
}

function hashOf(text) {
  return `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
}

describe('the pre-paint script hash', () => {
  const indexHtml = readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  it('matches the SHA-256 of the inline script in index.html', () => {
    expect(hashOf(inlineScript(indexHtml)), DRIFT).toBe(THEME_BOOT_HASH);
  });

  it('is a single-quoted sha256 source, ready for script-src', () => {
    expect(THEME_BOOT_HASH).toMatch(/^'sha256-[A-Za-z0-9+/]+=*'$/);
  });

  it('is the only inline script in index.html (the module script has a src)', () => {
    const inline = [...indexHtml.matchAll(/<script(?![^>]*\ssrc=)[^>]*>/g)];
    expect(inline).toHaveLength(1);
  });

  it('is the same bytes in the built dist/index.html', async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'codex-theme-boot-'));
    try {
      await build({ root: ROOT, configFile: path.join(ROOT, 'vite.config.js'), logLevel: 'silent',
        build: { outDir, emptyOutDir: true } });
      const dist = readFileSync(path.join(outDir, 'index.html'), 'utf8');
      const built = inlineScript(dist);
      expect(built, DRIFT).toBe(inlineScript(indexHtml));
      expect(hashOf(built), DRIFT).toBe(THEME_BOOT_HASH);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 180_000);
});
