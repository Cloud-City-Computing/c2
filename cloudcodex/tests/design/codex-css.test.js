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
    // color-scheme is the one plain property allowed: it tells native controls and scrollbars to paint dark (X11).
    const declarations = blocks(codex).flatMap((b) => b.body.split(';'))
      .map((d) => d.trim()).filter(Boolean);
    expect(declarations.length).toBe(declaredNames(codex).length + 1);
    expect(declarations.filter((d) => !/^--cx-[\w-]+\s*:/.test(d))).toEqual(['color-scheme: dark']);
  });

  it('declares under exactly [data-theme] and [data-theme=\'dark\'], and nothing on :root', () => {
    const selectors = blocks(codex).map((b) => b.selector);
    expect(selectors).toEqual(['[data-theme]', "[data-theme='dark']"]);
  });

  it('declares no radius, no third or fourth surface step (W6-CDX-38: the hover fills retire)', () => {
    const names = declaredNames(codex);
    expect(names.filter((n) => /^--cx-radius-/.test(n))).toEqual([]);
    expect(names.filter((n) => /^--cx-surface-[34]$/.test(n))).toEqual([]);
  });

  it('sets color-scheme dark on the dark block, where native controls read it', () => {
    const dark = blocks(codex).find((b) => b.selector === "[data-theme='dark']");
    expect(dark.body).toMatch(/color-scheme:\s*dark/);
  });

  it('never redeclares a core.css primitive', () => {
    expect(coreNames.size).toBe(61);
    expect(declaredNames(codex).filter((name) => coreNames.has(name))).toEqual([]);
  });
});

describe('index.css and core.css', () => {
  it('overlap only on the legacy names W6-CDX-22 repoints', () => {
    // index.css loads after core.css and redeclares these on :root, so its
    // values win (--brand-blue is the same #2ca7db in both). The list may only shrink.
    // W6-CDX-38: the radius names are no longer redeclared, so core's 6, 10 and 14px apply.
    const LEGACY = ['--brand-blue'];
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
