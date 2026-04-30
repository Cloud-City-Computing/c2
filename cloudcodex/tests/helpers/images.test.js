/**
 * Cloud Codex — Tests for routes/helpers/images.js
 *
 * Exercises image extraction from HTML / markdown and inlining for export.
 * sharp and fs/promises are mocked so the tests don't touch real disk or
 * decode real images.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Override the global setup mock for sharp to add toBuffer (used by
// processAndSaveImage but not present in the default mock).
vi.mock('sharp', () => {
  const inst = {};
  inst.resize = vi.fn(() => inst);
  inst.webp = vi.fn(() => inst);
  inst.toFile = vi.fn(async () => ({}));
  inst.toBuffer = vi.fn(async () => Buffer.from('processed-webp-bytes'));
  return { default: vi.fn(() => inst) };
});

// Extend fs/promises mock to provide stat / readFile / writeFile.
vi.mock('fs/promises', () => {
  const api = {
    mkdir: vi.fn(async () => {}),
    unlink: vi.fn(async () => {}),
    stat: vi.fn(async () => { throw Object.assign(new Error('not found'), { code: 'ENOENT' }); }),
    readFile: vi.fn(async () => Buffer.from('file-contents')),
    writeFile: vi.fn(async () => {}),
  };
  return { default: api, ...api };
});

import fs from 'fs/promises';
import sharp from 'sharp';
import {
  processAndSaveImage,
  extractImagesFromHtml,
  inlineImagesForExport,
  inlineImagesForMarkdownExport,
  DOC_IMAGES_DIR,
} from '../../routes/helpers/images.js';

describe('helpers/images', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: stat throws ENOENT (file not found), readFile returns bytes
    fs.stat.mockImplementation(async () => {
      const err = new Error('not found');
      err.code = 'ENOENT';
      throw err;
    });
    fs.readFile.mockResolvedValue(Buffer.from('cached-bytes'));
    fs.writeFile.mockResolvedValue(undefined);
  });

  // ── DOC_IMAGES_DIR ─────────────────────────────────────

  it('exports DOC_IMAGES_DIR pointing into public/doc-images', () => {
    expect(DOC_IMAGES_DIR).toMatch(/public[\\/]doc-images$/);
  });

  // ── processAndSaveImage ────────────────────────────────

  describe('processAndSaveImage', () => {
    it('hashes the buffer and writes a webp file', async () => {
      const result = await processAndSaveImage(Buffer.from('original-png-bytes'));
      expect(result.filename).toMatch(/^[a-f0-9]{16}\.webp$/);
      expect(result.url).toBe(`/doc-images/${result.filename}`);
      expect(sharp).toHaveBeenCalled();
      expect(fs.writeFile).toHaveBeenCalledTimes(1);
      // Same hash for same input
      const repeat = await processAndSaveImage(Buffer.from('original-png-bytes'));
      expect(repeat.filename).toBe(result.filename);
    });

    it('deduplicates: returns existing file size without re-processing when stat succeeds', async () => {
      fs.stat.mockResolvedValueOnce({ size: 4096 });
      const result = await processAndSaveImage(Buffer.from('img'));
      expect(result.size).toBe(4096);
      expect(sharp).not.toHaveBeenCalled();
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('reports the processed size when sharp is invoked', async () => {
      const result = await processAndSaveImage(Buffer.from('img'));
      // Default mock returns Buffer.from('processed-webp-bytes')
      expect(result.size).toBe(Buffer.from('processed-webp-bytes').length);
    });
  });

  // ── extractImagesFromHtml ──────────────────────────────

  describe('extractImagesFromHtml', () => {
    it('returns the input unchanged when null/empty', async () => {
      expect(await extractImagesFromHtml('')).toBe('');
      expect(await extractImagesFromHtml(null)).toBeNull();
      expect(await extractImagesFromHtml(undefined)).toBeUndefined();
    });

    it('returns input unchanged when no data URIs present', async () => {
      const html = '<p>Plain text with <a href="https://x.com">link</a></p>';
      expect(await extractImagesFromHtml(html)).toBe(html);
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('extracts a single data URI and replaces with /doc-images/ URL', async () => {
      const tinyPng = Buffer.from([1, 2, 3, 4]).toString('base64');
      const html = `<img src="data:image/png;base64,${tinyPng}" alt="t">`;

      const result = await extractImagesFromHtml(html);

      expect(result).toMatch(/src="\/doc-images\/[a-f0-9]{16}\.webp"/);
      expect(result).not.toMatch(/data:image\/png/);
      expect(fs.writeFile).toHaveBeenCalledTimes(1);
    });

    it('deduplicates identical data URIs across multiple <img> tags', async () => {
      const tiny = Buffer.from('A').toString('base64');
      const dup = `data:image/png;base64,${tiny}`;
      const html = `<img src="${dup}"><img src="${dup}">`;

      await extractImagesFromHtml(html);

      // Only one disk write for the duplicated URI
      expect(fs.writeFile).toHaveBeenCalledTimes(1);
    });

    it('skips images larger than MAX_RAW_IMAGE_SIZE (10 MB)', async () => {
      // Build a base64 string that decodes to >10 MB
      const huge = Buffer.alloc(11 * 1024 * 1024).toString('base64');
      const html = `<img src="data:image/png;base64,${huge}">`;

      const result = await extractImagesFromHtml(html);

      // Original data URI should still be present (skipped, not replaced)
      expect(result).toContain('data:image/png;base64,');
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('catches and logs sharp errors without aborting the whole document', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      sharp.mockImplementationOnce(() => ({
        resize: () => ({ webp: () => ({ toBuffer: async () => { throw new Error('decode failed'); } }) }),
      }));

      const tiny = Buffer.from('B').toString('base64');
      const html = `<img src="data:image/png;base64,${tiny}">`;
      const result = await extractImagesFromHtml(html);

      // Original URI preserved when sharp fails
      expect(result).toContain('data:image/png;base64,');
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  // ── inlineImagesForExport (HTML) ───────────────────────

  describe('inlineImagesForExport', () => {
    it('returns the input unchanged when null/empty', async () => {
      expect(await inlineImagesForExport('')).toBe('');
      expect(await inlineImagesForExport(null)).toBeNull();
    });

    it('replaces /doc-images/<hash>.webp src with a data: URI', async () => {
      fs.readFile.mockResolvedValueOnce(Buffer.from('ABCDEF'));
      const html = '<img src="/doc-images/abcd1234.webp" alt="t">';
      const result = await inlineImagesForExport(html);
      expect(result).toMatch(/src="data:image\/webp;base64,[A-Za-z0-9+/=]+"/);
      expect(result).not.toContain('/doc-images/');
    });

    it('skips filenames that fail the path-traversal whitelist', async () => {
      const html = '<img src="/doc-images/../etc/passwd">';
      const result = await inlineImagesForExport(html);
      expect(fs.readFile).not.toHaveBeenCalled();
      expect(result).toBe(html);
    });

    it('leaves URL unchanged when the file is missing on disk', async () => {
      fs.readFile.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      const html = '<img src="/doc-images/missing.webp">';
      const result = await inlineImagesForExport(html);
      expect(result).toBe(html);
    });

    it('correctly maps non-webp extensions to a matching mime type', async () => {
      fs.readFile.mockResolvedValueOnce(Buffer.from('PNG-bytes'));
      const html = '<img src="/doc-images/abcd.png">';
      const result = await inlineImagesForExport(html);
      expect(result).toMatch(/data:image\/png;base64,/);
    });
  });

  // ── inlineImagesForMarkdownExport ──────────────────────

  describe('inlineImagesForMarkdownExport', () => {
    it('returns input unchanged when null/empty', async () => {
      expect(await inlineImagesForMarkdownExport('')).toBe('');
      expect(await inlineImagesForMarkdownExport(null)).toBeNull();
    });

    it('replaces ![alt](/doc-images/hash.webp) with a base64 data URI', async () => {
      fs.readFile.mockResolvedValueOnce(Buffer.from('XYZ'));
      const md = 'See ![alt text](/doc-images/abcd1234.webp) here.';
      const result = await inlineImagesForMarkdownExport(md);
      expect(result).toMatch(/!\[alt text\]\(data:image\/webp;base64,[A-Za-z0-9+/=]+\)/);
    });

    it('leaves the URL unchanged when readFile fails', async () => {
      fs.readFile.mockRejectedValueOnce(new Error('ENOENT'));
      const md = '![](/doc-images/gone.webp)';
      const result = await inlineImagesForMarkdownExport(md);
      expect(result).toBe(md);
    });

    it('does not match non-/doc-images/ URLs in markdown', async () => {
      const md = '![ext](https://example.com/cat.png)';
      await inlineImagesForMarkdownExport(md);
      expect(fs.readFile).not.toHaveBeenCalled();
    });
  });
});
