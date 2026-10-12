/**
 * X4 (W6-CDX-38): buttons and native fields inherit the page's typeface, not the browser's default, on the
 * shell. The deferred families (comments, the editor and its toolbars, Markdown, Draw.io, Version History,
 * GitHub) are excluded, so their controls keep the metrics they had (K3: no geometry change there).
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './buckets.js';

const css = readFileSync(path.join(ROOT, 'src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
// Declaration-level, because jsdom does not substitute var(): each rule that names a control and sets font-family: inherit.
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selectors: m[1].split(',').map((s) => s.trim()),
  body: m[2],
}));
const shellRule = rules.find((r) => r.selectors.some((s) => s.startsWith('button:not(')) && /font-family:\s*inherit/.test(r.body));

// The deferred families' containers. Every control inside one keeps the browser font until W6-CDX-43.
const DEFERRED_SCOPES = [
  '.comment-manager *', '.comment-thread *', '.comment-textarea', '.editor-log *', '.editor-with-comments *',
  '.editor-container *', '.tiptap-toolbar *', '.editor-toolbar *', '.markdown-editor *', '.version-history *',
  '.drawio-block *', '.document-readonly *', '[class*="gh-"] *', '[class*="gh-"]',
];

describe('controls inherit the typeface on the shell (X4)', () => {
  it.each(['.btn', 'button', 'input', 'select', 'textarea'])('%s is in the rule that sets font-family: inherit', (selector) => {
    expect(shellRule, 'the font-family: inherit rule').toBeDefined();
    expect(shellRule.selectors.join(' ')).toContain(selector);
  });

  it('excludes every deferred family, so their controls keep their metrics', () => {
    const selector = shellRule.selectors.join(' ');
    for (const scope of DEFERRED_SCOPES) expect(selector, `scope ${scope}`).toContain(scope);
  });
});
