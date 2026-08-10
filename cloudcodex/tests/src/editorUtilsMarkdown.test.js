/**
 * Cloud Codex — Tests for the markdown/sanitize helpers in src/editorUtils.js
 *
 * These lived inside Editor.jsx and so were never covered: the page is out of
 * unit-test scope by policy. They are the conversion path behind markdown mode
 * and GitHub round-tripping.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { sanitizeHtml, htmlToMarkdown, markdownToHtml } from '../../src/editorUtils.js';

describe('sanitizeHtml', () => {
  it('returns empty string for falsy input', () => {
    expect(sanitizeHtml('')).toBe('');
    expect(sanitizeHtml(null)).toBe('');
    expect(sanitizeHtml(undefined)).toBe('');
  });

  it('strips script tags', () => {
    expect(sanitizeHtml('<p>hi</p><script>alert(1)</script>')).toBe('<p>hi</p>');
  });

  it('strips inline event handlers', () => {
    expect(sanitizeHtml('<img src="x" onerror="alert(1)">')).not.toContain('onerror');
  });

  it('strips javascript: URIs but keeps http, mailto and tel', () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript:');
    expect(sanitizeHtml('<a href="https://example.com">x</a>')).toContain('https://example.com');
    expect(sanitizeHtml('<a href="mailto:a@b.c">x</a>')).toContain('mailto:a@b.c');
    expect(sanitizeHtml('<a href="tel:+1234">x</a>')).toContain('tel:+1234');
  });

  it('keeps ordinary formatting markup', () => {
    const html = '<h2>Title</h2><p><strong>bold</strong> and <em>italic</em></p>';
    expect(sanitizeHtml(html)).toBe(html);
  });
});

describe('htmlToMarkdown', () => {
  it('returns empty string for falsy input', () => {
    expect(htmlToMarkdown('')).toBe('');
    expect(htmlToMarkdown(null)).toBe('');
  });

  it('uses ATX headings, as configured', () => {
    expect(htmlToMarkdown('<h2>Title</h2>')).toBe('## Title');
  });

  it('uses fenced code blocks, as configured', () => {
    const md = htmlToMarkdown('<pre><code>const a = 1;</code></pre>');
    expect(md).toContain('```');
    expect(md).toContain('const a = 1;');
  });

  it('converts emphasis and links', () => {
    expect(htmlToMarkdown('<p><strong>bold</strong></p>')).toBe('**bold**');
    expect(htmlToMarkdown('<p><a href="https://e.com">x</a></p>')).toBe('[x](https://e.com)');
  });
});

describe('markdownToHtml', () => {
  it('returns empty string for falsy input', () => {
    expect(markdownToHtml('')).toBe('');
    expect(markdownToHtml(null)).toBe('');
  });

  it('renders headings and emphasis', () => {
    expect(markdownToHtml('## Title')).toContain('<h2');
    expect(markdownToHtml('**bold**')).toContain('<strong>bold</strong>');
  });

  // The `breaks: true` option moved out of Editor.jsx with this extraction.
  // Without it a single newline renders as a space, not a <br>.
  it('honours the breaks option, so a single newline becomes a <br>', () => {
    expect(markdownToHtml('one\ntwo')).toContain('<br>');
  });

  it('honours the gfm option, so tables render', () => {
    const html = markdownToHtml('| a | b |\n| - | - |\n| 1 | 2 |');
    expect(html).toContain('<table>');
  });

  // markdown may carry raw HTML, so the output has to be sanitized too.
  it('sanitizes embedded HTML rather than trusting it', () => {
    expect(markdownToHtml('text <script>alert(1)</script>')).not.toContain('<script>');
  });
});

describe('round trip', () => {
  it('preserves headings, emphasis and links through html -> md -> html', () => {
    const html = markdownToHtml(htmlToMarkdown(
      '<h2>Title</h2><p><strong>bold</strong> <a href="https://e.com">link</a></p>'
    ));
    expect(html).toContain('<h2');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('https://e.com');
  });
});
