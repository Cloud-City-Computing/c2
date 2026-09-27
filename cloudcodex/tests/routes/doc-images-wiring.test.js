/**
 * Cloud Codex - Tests that every route writing document HTML records its images
 *
 * A doc_images row is what lets a reader see an image, so a write path that
 * stores `/doc-images/` references without recording them hides those images
 * from the document's readers. And export reads image files straight off disk,
 * so an export that did not ask who may see each image would hand out the
 * bytes the /doc-images handler refuses. These pin the wiring: which document,
 * which HTML, which user, and which images that user supplied the bytes for.
 * The helpers themselves are tested in tests/helpers/images.test.js, and the
 * whole path on live MySQL in tests/integration/doc-images.test.js.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { c2_query } from '../../mysql_connect.js';
import { mockAuthenticated, resetMocks, TEST_USER } from '../helpers.js';
import {
  extractImagesFromHtml,
  recordDocImages,
  inlineImagesForExport,
  inlineImagesForMarkdownExport,
} from '../../routes/helpers/images.js';

const SUPPLIED = '5555555555555555';
const STORED = `<p>x</p><img src="/doc-images/${SUPPLIED}.webp">`;

vi.mock('../../routes/helpers/images.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    // Stands in for decoding one pasted data URI: the stored HTML names the
    // image, and the caller's set learns that this write supplied its bytes.
    extractImagesFromHtml: vi.fn(async (_html, saved) => {
      saved?.add('5555555555555555');
      return '<p>x</p><img src="/doc-images/5555555555555555.webp">';
    }),
    recordDocImages: vi.fn(async () => 1),
    inlineImagesForExport: vi.fn(async (html) => html),
    inlineImagesForMarkdownExport: vi.fn(async (md) => md),
  };
});

beforeEach(() => {
  resetMocks();
  extractImagesFromHtml.mockClear();
  recordDocImages.mockClear();
  inlineImagesForExport.mockClear();
  inlineImagesForMarkdownExport.mockClear();
});

/** recordDocImages was called once, for this document and this HTML, as this user, with this write's images. */
function expectRecorded(logId) {
  expect(recordDocImages).toHaveBeenCalledTimes(1);
  const [id, html, user, saved] = recordDocImages.mock.calls[0];
  expect(id).toBe(logId);
  expect(html).toBe(STORED);
  expect(user).toMatchObject({ id: TEST_USER.id });
  expect([...saved]).toEqual([SUPPLIED]);
  // The set handed to extraction is the one handed to recording.
  expect(extractImagesFromHtml.mock.calls.at(-1)[1]).toBe(saved);
}

describe('write paths record the images they store', () => {
  it('POST /api/save-document, after the write', async () => {
    mockAuthenticated();
    c2_query
      .mockResolvedValueOnce([{ id: 9, old_content: '', version: 1, archive_id: 1, title: 'T' }])
      .mockResolvedValueOnce({ affectedRows: 1 });

    const res = await request(app)
      .post('/api/save-document')
      .set('Authorization', 'Bearer t')
      .send({ doc_id: 9, html_content: '<p>x</p>' });

    expect(res.status).toBe(200);
    expectRecorded(9);
    const updateAt = c2_query.mock.invocationCallOrder[1];
    expect(recordDocImages.mock.invocationCallOrder[0]).toBeGreaterThan(updateAt);
  });

  it('POST /api/save-document records nothing when write access is refused', async () => {
    mockAuthenticated();
    c2_query.mockResolvedValueOnce([]);

    const res = await request(app)
      .post('/api/save-document')
      .set('Authorization', 'Bearer t')
      .send({ doc_id: 9, html_content: '<p>x</p>' });

    expect(res.status).toBe(403);
    expect(recordDocImages).not.toHaveBeenCalled();
  });

  it('POST /api/document/:logId/publish', async () => {
    mockAuthenticated();
    c2_query
      .mockResolvedValueOnce([{ id: 9, html_content: '<p>x</p>', version: 1, squad_id: null, archive_creator: TEST_USER.id, title: 'T', archive_id: 1 }])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ insertId: 3 });

    const res = await request(app)
      .post('/api/document/9/publish')
      .set('Authorization', 'Bearer t')
      .send({ title: 'v2' });

    expect(res.status).toBe(200);
    expectRecorded(9);
  });

  it('POST /api/document/:logId/versions/:versionId/restore', async () => {
    mockAuthenticated();
    c2_query
      .mockResolvedValueOnce([{ id: 9, html_content: '<p>now</p>', version: 2, title: 'T', archive_id: 1 }])
      .mockResolvedValueOnce([{ html_content: '<p>then</p>' }])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ insertId: 4 });

    const res = await request(app)
      .post('/api/document/9/versions/4/restore')
      .set('Authorization', 'Bearer t');

    expect(res.status).toBe(200);
    expectRecorded(9);
  });

  it('POST /api/archives/:archiveId/logs/upload, against the new document', async () => {
    mockAuthenticated();
    c2_query
      .mockResolvedValueOnce([{ create_log: true }])
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce({ insertId: 42 });

    const res = await request(app)
      .post('/api/archives/1/logs/upload')
      .set('Authorization', 'Bearer t')
      .attach('file', Buffer.from('<p>x</p>'), 'doc.html');

    expect(res.status).toBe(201);
    expectRecorded(42);
  });
});

describe('export inlines images as the exporting user', () => {
  const exportOnce = async (format) => {
    mockAuthenticated();
    c2_query.mockResolvedValueOnce([{ id: 9, title: 'T', html_content: STORED }]);
    return request(app).get(`/api/document/9/export?format=${format}`).set('Authorization', 'Bearer t');
  };

  it('html', async () => {
    expect((await exportOnce('html')).status).toBe(200);
    expect(inlineImagesForExport).toHaveBeenCalledWith(STORED, expect.objectContaining({ id: TEST_USER.id }));
  });

  it('md', async () => {
    expect((await exportOnce('md')).status).toBe(200);
    const [, user] = inlineImagesForMarkdownExport.mock.calls[0];
    expect(user).toMatchObject({ id: TEST_USER.id });
  });

  it('docx', async () => {
    await exportOnce('docx');
    expect(inlineImagesForExport).toHaveBeenCalledWith(STORED, expect.objectContaining({ id: TEST_USER.id }));
  });
});
