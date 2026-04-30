import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  hastNodeToHtml,
  hastToHtml,
  encodeBase64,
  decodeBase64,
  extractSvgFromDataUri,
} from '../../src/editorUtils.js';

describe('editorUtils', () => {
  // ── escapeHtml ─────────────────────────────────────────

  describe('escapeHtml', () => {
    it('escapes ampersands, angle brackets', () => {
      expect(escapeHtml('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d');
    });

    it('returns empty string for empty input', () => {
      expect(escapeHtml('')).toBe('');
    });

    it('leaves safe strings unchanged', () => {
      expect(escapeHtml('hello world')).toBe('hello world');
    });

    it('handles multiple special chars in a row', () => {
      expect(escapeHtml('<<>>')).toBe('&lt;&lt;&gt;&gt;');
    });
  });

  // ── hastNodeToHtml ─────────────────────────────────────

  describe('hastNodeToHtml', () => {
    it('converts a text node', () => {
      expect(hastNodeToHtml({ type: 'text', value: 'hello' })).toBe('hello');
    });

    it('escapes HTML in text nodes', () => {
      expect(hastNodeToHtml({ type: 'text', value: '<script>' })).toBe('&lt;script&gt;');
    });

    it('converts an element node with className', () => {
      const node = {
        type: 'element',
        tagName: 'span',
        properties: { className: ['hljs-keyword'] },
        children: [{ type: 'text', value: 'const' }],
      };
      expect(hastNodeToHtml(node)).toBe('<span class="hljs-keyword">const</span>');
    });

    it('converts an element node without className', () => {
      const node = {
        type: 'element',
        tagName: 'span',
        properties: {},
        children: [{ type: 'text', value: 'x' }],
      };
      expect(hastNodeToHtml(node)).toBe('<span>x</span>');
    });

    it('handles nested elements', () => {
      const node = {
        type: 'element',
        tagName: 'span',
        properties: { className: ['hljs-built_in'] },
        children: [
          { type: 'text', value: 'console' },
          {
            type: 'element',
            tagName: 'span',
            properties: { className: ['hljs-punctuation'] },
            children: [{ type: 'text', value: '.' }],
          },
        ],
      };
      expect(hastNodeToHtml(node)).toBe(
        '<span class="hljs-built_in">console<span class="hljs-punctuation">.</span></span>'
      );
    });

    it('handles multiple className values', () => {
      const node = {
        type: 'element',
        tagName: 'span',
        properties: { className: ['hljs-meta', 'hljs-keyword'] },
        children: [{ type: 'text', value: 'import' }],
      };
      expect(hastNodeToHtml(node)).toBe('<span class="hljs-meta hljs-keyword">import</span>');
    });

    it('returns empty string for unknown node types', () => {
      expect(hastNodeToHtml({ type: 'comment', value: '...' })).toBe('');
    });

    it('defaults tagName to span when missing', () => {
      const node = {
        type: 'element',
        properties: { className: ['test'] },
        children: [{ type: 'text', value: 'x' }],
      };
      expect(hastNodeToHtml(node)).toBe('<span class="test">x</span>');
    });
  });

  // ── hastToHtml ─────────────────────────────────────────

  describe('hastToHtml', () => {
    it('converts a lowlight result tree', () => {
      const tree = {
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: { className: ['hljs-keyword'] },
            children: [{ type: 'text', value: 'const' }],
          },
          { type: 'text', value: ' x = ' },
          {
            type: 'element',
            tagName: 'span',
            properties: { className: ['hljs-number'] },
            children: [{ type: 'text', value: '42' }],
          },
          { type: 'text', value: ';' },
        ],
        data: { language: 'javascript', relevance: 1 },
      };
      expect(hastToHtml(tree)).toBe(
        '<span class="hljs-keyword">const</span> x = <span class="hljs-number">42</span>;'
      );
    });

    it('returns empty string for null tree', () => {
      expect(hastToHtml(null)).toBe('');
    });

    it('returns empty string for tree without children', () => {
      expect(hastToHtml({ type: 'root' })).toBe('');
    });

    it('returns empty string for empty children', () => {
      expect(hastToHtml({ type: 'root', children: [] })).toBe('');
    });
  });

  // ── encodeBase64 / decodeBase64 ────────────────────────

  describe('encodeBase64 / decodeBase64', () => {
    it('round-trips ASCII strings', () => {
      const str = 'Hello, World!';
      expect(decodeBase64(encodeBase64(str))).toBe(str);
    });

    it('round-trips Unicode strings', () => {
      const str = '日本語テスト 🎉 émojis & spëcial';
      expect(decodeBase64(encodeBase64(str))).toBe(str);
    });

    it('round-trips XML content with angle brackets and quotes', () => {
      const xml = '<mxGraphModel dx="1262"><root><mxCell id="0"/></root></mxGraphModel>';
      expect(decodeBase64(encodeBase64(xml))).toBe(xml);
    });

    it('round-trips SVG content', () => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100"><rect x="0" y="0" width="100" height="50" fill="#2ca7db"/><text>Hello</text></svg>';
      expect(decodeBase64(encodeBase64(svg))).toBe(svg);
    });

    it('round-trips empty string', () => {
      expect(decodeBase64(encodeBase64(''))).toBe('');
    });

    it('produces valid base64 output', () => {
      const encoded = encodeBase64('test');
      expect(encoded).toMatch(/^[A-Za-z0-9+/=]+$/);
    });
  });

  // ── extractSvgFromDataUri ──────────────────────────────

  describe('extractSvgFromDataUri', () => {
    it('extracts SVG from a base64 data URI', () => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="100" height="50"/></svg>';
      const dataUri = 'data:image/svg+xml;base64,' + btoa(svg);
      expect(extractSvgFromDataUri(dataUri)).toBe(svg);
    });

    it('extracts SVG with Unicode from a data URI', () => {
      const svg = '<svg><text>Héllo Wörld</text></svg>';
      const b64 = btoa(unescape(encodeURIComponent(svg)));
      const dataUri = 'data:image/svg+xml;base64,' + b64;
      expect(extractSvgFromDataUri(dataUri)).toBe(svg);
    });

    it('returns raw SVG string unchanged if not a data URI', () => {
      const svg = '<svg><rect/></svg>';
      expect(extractSvgFromDataUri(svg)).toBe(svg);
    });

    it('returns empty string for empty input', () => {
      expect(extractSvgFromDataUri('')).toBe('');
    });

    it('returns empty string for null/undefined', () => {
      expect(extractSvgFromDataUri(null)).toBe('');
      expect(extractSvgFromDataUri(undefined)).toBe('');
    });

    it('returns original string for non-base64 data URI', () => {
      const uri = 'data:text/plain,hello';
      expect(extractSvgFromDataUri(uri)).toBe(uri);
    });
  });
});
