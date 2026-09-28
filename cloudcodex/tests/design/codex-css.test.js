/**
 * Pins how the page loads the shared primitives and Codex's own bindings
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { declaredNames } from '../../vendor/cloud-city-design/gates/dangling.mjs';
import { maskComments } from '../../vendor/cloud-city-design/gates/token-discipline.mjs';
import { ROOT } from './buckets.js';
import viteConfig from '../../vite.config.js';

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const coreNames = new Set(declaredNames(read('vendor/cloud-city-design/core.css')));
const codex = read('src/codex.css');

/** Every `selector { body }` block, comments masked. */
const blocks = (css) => [...maskComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((m) => ({ selector: m[1].trim(), body: m[2] }));

describe('src/codex.css', () => {
  it('declares only --cx- names', () => {
    const names = declaredNames(codex);
    expect(names.length).toBeGreaterThanOrEqual(19);
    expect(names.filter((name) => !name.startsWith('--cx-'))).toEqual([]);
  });

  it('declares custom properties and nothing else', () => {
    // A plain property here would paint the page from the one file whose
    // custom-property literals the token-discipline ledger reads as definitions.
    const declarations = blocks(codex).flatMap((b) => b.body.split(';'))
      .map((d) => d.trim()).filter(Boolean);
    expect(declarations.length).toBe(declaredNames(codex).length);
    expect(declarations.filter((d) => !/^--cx-[\w-]+\s*:/.test(d))).toEqual([]);
  });

  it('declares everything under the dark theme attribute, and nothing on :root', () => {
    const selectors = blocks(codex).map((b) => b.selector);
    expect(selectors).toEqual(["[data-theme='dark']"]);
  });

  it('never redeclares a core.css primitive', () => {
    expect(coreNames.size).toBe(61);
    expect(declaredNames(codex).filter((name) => coreNames.has(name))).toEqual([]);
  });
});

describe('index.css and core.css', () => {
  it('overlap only on the legacy names W6-CDX-22 repoints', () => {
    // index.css loads after core.css and redeclares these on :root, so its
    // values win (Codex's radii are 4, 8 and 12px, core's 6, 10 and 14px;
    // --brand-blue is the same #2ca7db in both). The list may only shrink.
    const LEGACY = ['--brand-blue', '--radius-lg', '--radius-md', '--radius-sm'];
    const overlap = [...new Set(declaredNames(read('src/index.css')))].filter((name) => coreNames.has(name)).sort();
    expect(overlap).toEqual(LEGACY);
  });
});

describe('the page', () => {
  it('pins the dark theme on the root element', () => {
    expect(read('index.html')).toMatch(/<html lang="en" data-theme="dark">/);
  });

  it('imports core, fonts and codex.css, in that order, before index.css', () => {
    const imports = [...read('src/main.jsx').matchAll(/^import\s+['"]([^'"]+\.css)['"]/gm)].map((m) => m[1]);
    expect(imports).toEqual([
      '../vendor/cloud-city-design/core.css',
      '../vendor/cloud-city-design/fonts.css',
      './codex.css',
      './index.css',
    ]);
  });

  it('keeps core.css\'s licence notice through the minifier', () => {
    expect(read('vendor/cloud-city-design/core.css').startsWith('/*! cloud-city-design core.css')).toBe(true);
    // Vite's default is 'none', which strips it from the built stylesheet.
    expect(viteConfig.esbuild?.legalComments).toBe('inline');
  });

  it('keeps the fonts out of public/, which the uploads volume shadows', () => {
    const inPublic = readdirSync(path.join(ROOT, 'public'), { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.woff2'));
    expect(inPublic).toEqual([]);
  });
});
