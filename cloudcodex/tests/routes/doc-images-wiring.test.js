/**
 * Cloud Codex - Tests that every route writing document HTML records its images
 *
 * A doc_images row is what lets a reader see an image, so a write path that
 * stores `/doc-images/` references without recording them hides those images
 * from the document's readers. And export reads image files straight off disk,
 * so an export that did not ask who may see each image would hand out the
 * bytes the /doc-images handler refuses. These pin the wiring: which document,
 * which HTML, which user, which images that user supplied the bytes for, and
 * which references the write may vouch for (only the ones it added: a
 * reference somebody else put there is not the next writer's to grant).
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
  openDocImageCredits,
  closeDocImageCredits,
} from '../../routes/helpers/images.js';

/** Decoded from a data URI in this write, so its bytes are the writer's. */
const SUPPLIED = '5555555555555555';
/** A reference this write adds that the previous HTML did not show. */
const ADDED = '6666666666666666';
/** A reference the previous HTML already showed. */
const KEPT = '7777777777777777';
const ref = (hash) => `<img src="/doc-images/${hash}.webp">`;
const STORED = `<p>x</p>${ref(SUPPLIED)}${ref(ADDED)}${ref(KEPT)}`;

vi.mock('../../routes/helpers/images.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    // Stands in for decoding one pasted data URI: the stored HTML names the
    // image, and the caller's set learns that this write supplied its bytes.
    extractImagesFromHtml: vi.fn(async (_html, saved) => {
      saved?.add('5555555555555555');
      return '<p>x</p><img src="/doc-images/5555555555555555.webp">' +
        '<img src="/doc-images/6666666666666666.webp"><img src="/doc-images/7777777777777777.webp">';
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

/**
 * recordDocImages was called once, for this document and this HTML, as this
 * user, with this write's decoded images and exactly `introduced` as the
 * references it may vouch for.
 */
function expectRecorded(logId, introduced) {
  expect(recordDocImages).toHaveBeenCalledTimes(1);
  const [id, html, user, options] = recordDocImages.mock.calls[0];
  expect(id).toBe(logId);
  expect(html).toBe(STORED);
  expect(user).toMatchObject({ id: TEST_USER.id });
  expect([...options.saved]).toEqual([SUPPLIED]);
  // The set handed to extraction is the one handed to recording.
  expect(extractImagesFromHtml.mock.calls.at(-1)[1]).toBe(options.saved);
  expect(options.introduced ?? []).toEqual(introduced);
}

/** recordDocImages ran before the c2_query call whose SQL matches `re`. */
function expectRecordedBefore(re) {
  const index = c2_query.mock.calls.findIndex(([sql]) => re.test(sql));
  expect(index).toBeGreaterThanOrEqual(0);
  expect(recordDocImages.mock.invocationCallOrder[0]).toBeLessThan(c2_query.mock.invocationCallOrder[index]);
}

const saveDocument = () => request(app)
  .post('/api/save-document')
  .set('Authorization', 'Bearer t')
  .send({ doc_id: 9, html_content: '<p>x</p>' });

describe('write paths record the images they store', () => {
  it('POST /api/save-document vouches only for what this save added, and records before the write', async () => {
    mockAuthenticated();
    c2_query
      .mockResolvedValueOnce([{ id: 9, old_content: `<p>before</p>${ref(KEPT)}`, version: 1, archive_id: 1, title: 'T' }])
      .mockResolvedValueOnce({ affectedRows: 1 });

    const res = await saveDocument();

    expect(res.status).toBe(200);
    expectRecorded(9, [SUPPLIED, ADDED]);
    // Before the write, so a failure to record fails the save and a retry,
    // whose previous HTML is unchanged, can still record what it adds.
    expectRecordedBefore(/UPDATE logs SET html_content/);
  });

  it('POST /api/save-document, with a live editing session open, vouches only for what that session credits to this writer', async () => {
    const credits = openDocImageCredits(9);
    try {
      // ADDED went into the shared document from somebody else's editor.
      credits.noteMessage({ id: TEST_USER.id + 1 }, [ADDED], [], [ADDED]);
      mockAuthenticated();
      c2_query
        .mockResolvedValueOnce([{ id: 9, old_content: '', version: 1, archive_id: 1, title: 'T' }])
        .mockResolvedValueOnce({ affectedRows: 1 });

      expect((await saveDocument()).status).toBe(200);
      expectRecorded(9, []);
    } finally {
      closeDocImageCredits(9, credits);
    }
  });

  it('POST /api/save-document checks write access before it decodes or records anything', async () => {
    mockAuthenticated();
    c2_query.mockResolvedValueOnce([]);

    const res = await saveDocument();

    expect(res.status).toBe(403);
    expect(extractImagesFromHtml).not.toHaveBeenCalled();
    expect(recordDocImages).not.toHaveBeenCalled();
  });

  it('POST /api/document/:logId/publish vouches for no reference, and records before the write', async () => {
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
    expectRecorded(9, []);
    expectRecordedBefore(/UPDATE logs SET version/);
  });

  it('POST /api/document/:logId/versions/:versionId/restore vouches for no reference, records before the write, and tells a live session', async () => {
    const credits = openDocImageCredits(9);
    try {
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
      expectRecorded(9, []);
      // Before the logs UPDATE, so a failure leaves no bumped version without its snapshot.
      expectRecordedBefore(/UPDATE logs SET html_content/);
      // The restoring editor then pushes the restored content into the live
      // session; none of it is theirs to vouch for.
      credits.noteMessage({ id: TEST_USER.id }, [ADDED], [], [ADDED]);
      expect(credits.creditedTo(ADDED)).toBeNull();
    } finally {
      closeDocImageCredits(9, credits);
    }
  });

  it('POST /api/archives/:archiveId/logs/upload vouches for every reference, since the document is new', async () => {
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
    expectRecorded(42, [SUPPLIED, ADDED, KEPT]);
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
