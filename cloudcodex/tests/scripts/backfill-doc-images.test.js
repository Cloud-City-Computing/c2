/**
 * Cloud Codex - Tests for scripts/backfill-doc-images.js
 *
 * The one-time backfill that gives every image an existing document already
 * shows a doc_images row, so turning on authorized image serving does not
 * hide those images from the document's readers. c2_query is the global mock
 * from tests/setup.js; the live-MySQL run is tests/integration/doc-images.test.js.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { c2_query } from '../../mysql_connect.js';
import { backfillDocImages, main, BATCH_SIZE } from '../../scripts/backfill-doc-images.js';

const A = 'aaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbb';
const img = (hash) => `<img src="/doc-images/${hash}.webp">`;

/** Answer SELECTs from the given tables and count INSERT rows, like a tiny database. */
function fakeDatabase({ logs = [], versions = [] }) {
  const inserted = new Set();
  c2_query.mockImplementation(async (sql, params) => {
    if (/FROM logs/.test(sql)) {
      return logs.filter((row) => row.id > params[0]).slice(0, BATCH_SIZE);
    }
    if (/FROM versions/.test(sql)) {
      return versions.filter((row) => row.id > params[0]).slice(0, BATCH_SIZE);
    }
    if (/INSERT IGNORE INTO doc_images/.test(sql)) {
      let affectedRows = 0;
      for (let i = 0; i < params.length; i += 3) {
        const key = `${params[i]}:${params[i + 1]}`;
        if (!inserted.has(key)) {
          inserted.add(key);
          affectedRows++;
        }
      }
      return { affectedRows };
    }
    throw new Error(`unexpected query: ${sql}`);
  });
  return inserted;
}

const insertCalls = () => c2_query.mock.calls.filter(([sql]) => /INSERT IGNORE INTO doc_images/.test(sql));

beforeEach(() => {
  c2_query.mockReset();
});

describe('backfillDocImages', () => {
  it('records every image a document or one of its versions shows, against that document, with no uploader', async () => {
    const inserted = fakeDatabase({
      logs: [
        { id: 1, html_content: `${img(A)}<p>text</p>${img(B)}` },
        { id: 2, html_content: img(A) },
      ],
      versions: [{ id: 10, log_id: 2, html_content: img(B) }],
    });

    const result = await backfillDocImages();

    expect(result).toEqual({ documents: 2, versions: 1, recorded: 4 });
    expect([...inserted].sort()).toEqual([`${A}:1`, `${A}:2`, `${B}:1`, `${B}:2`]);
    for (const [, params] of insertCalls()) {
      for (let i = 2; i < params.length; i += 3) expect(params[i]).toBeNull();
    }
  });

  it('only reads rows that mention /doc-images/, versions only with a document', async () => {
    fakeDatabase({});
    await backfillDocImages();
    const selects = c2_query.mock.calls.filter(([sql]) => /^\s*SELECT/.test(sql));
    expect(selects).toHaveLength(2);
    for (const [sql] of selects) expect(sql).toMatch(/html_content LIKE '%\/doc-images\/%'/);
    expect(selects[1][0]).toMatch(/log_id IS NOT NULL/);
  });

  it('is idempotent: a second run records nothing new', async () => {
    fakeDatabase({ logs: [{ id: 1, html_content: img(A) }] });
    expect((await backfillDocImages()).recorded).toBe(1);
    expect((await backfillDocImages()).recorded).toBe(0);
  });

  it('walks the tables in id-ordered batches until one comes back short', async () => {
    const logs = Array.from({ length: BATCH_SIZE + 3 }, (_, i) => ({ id: i + 1, html_content: img(A) }));
    fakeDatabase({ logs });

    const result = await backfillDocImages();

    expect(result.documents).toBe(BATCH_SIZE + 3);
    const logSelects = c2_query.mock.calls.filter(([sql]) => /FROM logs/.test(sql));
    expect(logSelects.map(([, params]) => params[0])).toEqual([0, BATCH_SIZE]);
    for (const [sql] of logSelects) expect(sql).toMatch(/ORDER BY id LIMIT 500/);
  });

  it('skips a row whose mention is not a served image, and counts nothing for it', async () => {
    fakeDatabase({ logs: [{ id: 1, html_content: '<a href="/doc-images/readme">not an image</a>' }] });
    expect(await backfillDocImages()).toEqual({ documents: 0, versions: 0, recorded: 0 });
    expect(insertCalls()).toHaveLength(0);
  });
});

describe('main', () => {
  it('prints one line saying what it recorded, and returns the counts', async () => {
    fakeDatabase({ logs: [{ id: 1, html_content: img(A) }] });
    const lines = [];

    const result = await main({ log: (line) => lines.push(line) });

    expect(result).toEqual({ documents: 1, versions: 0, recorded: 1 });
    expect(lines).toEqual(['backfill-doc-images: recorded 1 image reference(s) from 1 document(s) and 0 version(s)']);
  });
});
