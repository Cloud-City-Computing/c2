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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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
import { c2_query } from '../../mysql_connect.js';
import { readAccessParams } from '../../routes/helpers/ownership.js';
import {
  processAndSaveImage,
  extractImagesFromHtml,
  inlineImagesForExport,
  inlineImagesForMarkdownExport,
  docImageHashes,
  docImagesPublic,
  readableDocImageHashes,
  insertDocImageRows,
  recordDocImages,
  DOC_IMAGES_DIR,
} from '../../routes/helpers/images.js';

const HASH_A = 'aaaaaaaaaaaaaaaa';
const HASH_B = 'bbbbbbbbbbbbbbbb';
const HASH_C = 'cccccccccccccccc';
const WRITER = { id: 7, is_admin: false };

/** Run `fn` with DOC_IMAGES_PUBLIC set to `value` (undefined unsets it), then restore. */
async function withPublicFlag(value, fn) {
  const prior = process.env.DOC_IMAGES_PUBLIC;
  if (value === undefined) delete process.env.DOC_IMAGES_PUBLIC;
  else process.env.DOC_IMAGES_PUBLIC = value;
  try {
    return await fn();
  } finally {
    if (prior === undefined) delete process.env.DOC_IMAGES_PUBLIC;
    else process.env.DOC_IMAGES_PUBLIC = prior;
  }
}

/** Every c2_query call whose SQL matches `re`. */
const callsMatching = (re) => c2_query.mock.calls.filter(([sql]) => re.test(sql));

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
    // mockReset, not clearAllMocks: a queued mockResolvedValueOnce survives
    // clearAllMocks and would leak into the next test.
    c2_query.mockReset();
    c2_query.mockResolvedValue([]);
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

    it('returns the content hash the file is named after', async () => {
      const result = await processAndSaveImage(Buffer.from('hash-me'));
      expect(result.hash).toMatch(/^[a-f0-9]{16}$/);
      expect(result.filename).toBe(`${result.hash}.webp`);
      // The dedup path reports the same hash without re-processing.
      fs.stat.mockResolvedValueOnce({ size: 1 });
      expect((await processAndSaveImage(Buffer.from('hash-me'))).hash).toBe(result.hash);
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

    it('collects the hash of every image it stored into the optional set', async () => {
      const one = Buffer.from('one').toString('base64');
      const two = Buffer.from('two').toString('base64');
      const html = `<img src="data:image/png;base64,${one}"><img src="data:image/png;base64,${two}">` +
        `<img src="/doc-images/${HASH_A}.webp">`;
      const saved = new Set();

      const result = await extractImagesFromHtml(html, saved);

      // Exactly the two it decoded, never the reference it was handed.
      expect(saved.size).toBe(2);
      expect(saved.has(HASH_A)).toBe(false);
      expect(docImageHashes(result).sort()).toEqual([...saved, HASH_A].sort());
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

  // Today's behaviour, which DOC_IMAGES_PUBLIC=1 keeps: every file on disk
  // that a document names is inlined.
  describe('inlineImagesForExport with DOC_IMAGES_PUBLIC=1', () => {
    let prior;
    beforeEach(() => {
      prior = process.env.DOC_IMAGES_PUBLIC;
      process.env.DOC_IMAGES_PUBLIC = '1';
    });
    afterEach(() => {
      if (prior === undefined) delete process.env.DOC_IMAGES_PUBLIC;
      else process.env.DOC_IMAGES_PUBLIC = prior;
    });

    it('asks the database nothing', async () => {
      fs.readFile.mockResolvedValueOnce(Buffer.from('ABCDEF'));
      await inlineImagesForExport(`<img src="/doc-images/${HASH_A}.webp">`);
      expect(c2_query).not.toHaveBeenCalled();
    });

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

  describe('inlineImagesForMarkdownExport with DOC_IMAGES_PUBLIC=1', () => {
    let prior;
    beforeEach(() => {
      prior = process.env.DOC_IMAGES_PUBLIC;
      process.env.DOC_IMAGES_PUBLIC = '1';
    });
    afterEach(() => {
      if (prior === undefined) delete process.env.DOC_IMAGES_PUBLIC;
      else process.env.DOC_IMAGES_PUBLIC = prior;
    });

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
  // ── Who may see an image ───────────────────────────────

  describe('docImagesPublic', () => {
    it('is true for exactly "1"', async () => {
      await withPublicFlag('1', () => expect(docImagesPublic()).toBe(true));
      for (const value of [undefined, '', '0', 'true', 'yes', ' 1']) {
        await withPublicFlag(value, () => expect(docImagesPublic()).toBe(false));
      }
    });
  });

  describe('docImageHashes', () => {
    it('returns each served image hash once, in order of first appearance', () => {
      const html = `<img src="/doc-images/${HASH_B}.webp"><p>x</p><img src="/doc-images/${HASH_A}.webp">` +
        `<img src="/doc-images/${HASH_B}.webp">`;
      expect(docImageHashes(html)).toEqual([HASH_B, HASH_A]);
    });

    it('reads markdown image references too', () => {
      expect(docImageHashes(`![x](/doc-images/${HASH_C}.webp)`)).toEqual([HASH_C]);
    });

    it('ignores anything that is not a 16-hex-digit .webp name', () => {
      const html = '<img src="/doc-images/abcd1234.webp"><img src="/doc-images/../etc/passwd">' +
        `<img src="/doc-images/${HASH_A.toUpperCase()}.webp"><img src="/doc-images/${HASH_A}.png">`;
      expect(docImageHashes(html)).toEqual([]);
    });

    it('is empty for empty input', () => {
      expect(docImageHashes('')).toEqual([]);
      expect(docImageHashes(null)).toEqual([]);
      expect(docImageHashes(undefined)).toEqual([]);
    });
  });

  describe('readableDocImageHashes', () => {
    it('asks nothing without a user or without a valid hash', async () => {
      expect(await readableDocImageHashes([HASH_A], null)).toEqual([]);
      expect(await readableDocImageHashes(['not-a-hash'], WRITER)).toEqual([]);
      expect(await readableDocImageHashes([], WRITER)).toEqual([]);
      expect(c2_query).not.toHaveBeenCalled();
    });

    it('asks once, as the uploader OR through the archive read fragment, and returns what came back', async () => {
      c2_query.mockResolvedValueOnce([{ hash: HASH_B }]);

      const readable = await readableDocImageHashes([HASH_A, HASH_B, HASH_A], WRITER);

      expect(readable).toEqual([HASH_B]);
      expect(c2_query).toHaveBeenCalledTimes(1);
      const [sql, params] = c2_query.mock.calls[0];
      expect(sql).toMatch(/FROM doc_images di/);
      expect(sql).toMatch(/di\.hash IN \(\?, \?\)/);
      expect(sql).toMatch(/di\.uploaded_by = \? OR/);
      expect(sql).toMatch(/JSON_CONTAINS\(p\.read_access, \?\)/);
      // Hashes first, then the uploader, then exactly the seven read params.
      expect(params).toEqual([HASH_A, HASH_B, WRITER.id, ...readAccessParams(WRITER)]);
    });

    it('asks in batches of 500 so a huge document cannot exceed the placeholder limit', async () => {
      const many = Array.from({ length: 1001 }, (_, i) => i.toString(16).padStart(16, '0'));
      c2_query.mockResolvedValueOnce([{ hash: many[0] }]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ hash: many[1000] }]);

      const readable = await readableDocImageHashes(many, WRITER);

      expect(c2_query).toHaveBeenCalledTimes(3);
      expect(c2_query.mock.calls.map(([, params]) => params.length - 8)).toEqual([500, 500, 1]);
      expect(readable).toEqual([many[0], many[1000]]);
    });
  });

  describe('insertDocImageRows', () => {
    it('writes nothing for no rows', async () => {
      expect(await insertDocImageRows([])).toBe(0);
      expect(c2_query).not.toHaveBeenCalled();
    });

    it('INSERT IGNOREs every row and returns how many were new', async () => {
      c2_query.mockResolvedValueOnce({ affectedRows: 1 });

      const recorded = await insertDocImageRows([[HASH_A, 5, 7], [HASH_B, 5, null]]);

      expect(recorded).toBe(1);
      const [sql, params] = c2_query.mock.calls[0];
      expect(sql).toMatch(/^INSERT IGNORE INTO doc_images \(hash, log_id, uploaded_by\) VALUES \(\?, \?, \?\), \(\?, \?, \?\)$/);
      expect(params).toEqual([HASH_A, 5, 7, HASH_B, 5, null]);
    });

    it('writes in batches of 500', async () => {
      const rows = Array.from({ length: 501 }, (_, i) => [i.toString(16).padStart(16, '0'), 1, null]);
      c2_query.mockResolvedValueOnce({ affectedRows: 500 }).mockResolvedValueOnce({ affectedRows: 1 });
      expect(await insertDocImageRows(rows)).toBe(501);
      expect(c2_query).toHaveBeenCalledTimes(2);
    });
  });

  describe('recordDocImages', () => {
    it('asks nothing for HTML with no served images', async () => {
      expect(await recordDocImages(5, '<p>no images</p>', WRITER)).toBe(0);
      expect(await recordDocImages(5, '', WRITER)).toBe(0);
      expect(c2_query).not.toHaveBeenCalled();
    });

    it('refuses to record without the writing user', async () => {
      await expect(recordDocImages(5, `<img src="/doc-images/${HASH_A}.webp">`, undefined))
        .rejects.toThrow(/user/);
      expect(c2_query).not.toHaveBeenCalled();
    });

    it('records an image whose bytes the writer supplied, as theirs, without asking who can read it', async () => {
      c2_query.mockResolvedValueOnce({ affectedRows: 1 });

      await recordDocImages(5, `<img src="/doc-images/${HASH_A}.webp">`, WRITER, new Set([HASH_A]));

      expect(callsMatching(/FROM doc_images di/)).toHaveLength(0);
      const inserts = callsMatching(/INSERT IGNORE INTO doc_images/);
      expect(inserts).toHaveLength(1);
      expect(inserts[0][1]).toEqual([HASH_A, 5, WRITER.id]);
    });

    it('records a referenced image only when the writer can already see it, and not as its uploader', async () => {
      // HASH_B is readable to the writer; HASH_C is somebody else's.
      c2_query.mockResolvedValueOnce([{ hash: HASH_B }]).mockResolvedValueOnce({ affectedRows: 2 });
      const html = `<img src="/doc-images/${HASH_A}.webp"><img src="/doc-images/${HASH_B}.webp">` +
        `<img src="/doc-images/${HASH_C}.webp">`;

      await recordDocImages(5, html, WRITER, new Set([HASH_A]));

      const [asked] = callsMatching(/FROM doc_images di/);
      expect(asked[1].slice(0, 2)).toEqual([HASH_B, HASH_C]);
      const [insert] = callsMatching(/INSERT IGNORE INTO doc_images/);
      expect(insert[1]).toEqual([HASH_A, 5, WRITER.id, HASH_B, 5, null]);
    });

    it('writes nothing when the writer supplied nothing and can see none of the references', async () => {
      c2_query.mockResolvedValueOnce([]);
      expect(await recordDocImages(5, `<img src="/doc-images/${HASH_C}.webp">`, WRITER)).toBe(0);
      expect(callsMatching(/INSERT/)).toHaveLength(0);
    });
  });

  describe('inlineImagesForExport, authorized (the default)', () => {
    it('inlines only the images the exporting user can see', async () => {
      c2_query.mockResolvedValueOnce([{ hash: HASH_A }]);
      fs.readFile.mockResolvedValueOnce(Buffer.from('mine'));
      const html = `<img src="/doc-images/${HASH_A}.webp"><img src="/doc-images/${HASH_B}.webp">`;

      const result = await inlineImagesForExport(html, WRITER);

      expect(result).toContain(`data:image/webp;base64,${Buffer.from('mine').toString('base64')}`);
      expect(result).toContain(`/doc-images/${HASH_B}.webp`);
      expect(fs.readFile).toHaveBeenCalledTimes(1);
      const [, params] = callsMatching(/FROM doc_images di/)[0];
      expect(params.slice(0, 3)).toEqual([HASH_A, HASH_B, WRITER.id]);
    });

    it('inlines nothing without a user, and never a name that is not a served image', async () => {
      const html = `<img src="/doc-images/${HASH_A}.webp"><img src="/doc-images/abcd.png">`;
      expect(await inlineImagesForExport(html)).toBe(html);
      c2_query.mockResolvedValueOnce([{ hash: HASH_A }]);
      fs.readFile.mockResolvedValueOnce(Buffer.from('x'));
      const result = await inlineImagesForExport(html, WRITER);
      expect(result).toContain('/doc-images/abcd.png');
      expect(fs.readFile).toHaveBeenCalledTimes(1);
    });
  });

  describe('inlineImagesForMarkdownExport, authorized (the default)', () => {
    it('inlines only the images the exporting user can see', async () => {
      c2_query.mockResolvedValueOnce([{ hash: HASH_B }]);
      fs.readFile.mockResolvedValueOnce(Buffer.from('theirs'));
      const md = `![a](/doc-images/${HASH_A}.webp) ![b](/doc-images/${HASH_B}.webp)`;

      const result = await inlineImagesForMarkdownExport(md, WRITER);

      expect(result).toContain(`![a](/doc-images/${HASH_A}.webp)`);
      expect(result).toContain(`![b](data:image/webp;base64,${Buffer.from('theirs').toString('base64')})`);
      expect(fs.readFile).toHaveBeenCalledTimes(1);
    });

    it('inlines nothing without a user', async () => {
      const md = `![a](/doc-images/${HASH_A}.webp)`;
      expect(await inlineImagesForMarkdownExport(md)).toBe(md);
      expect(fs.readFile).not.toHaveBeenCalled();
    });
  });
});
