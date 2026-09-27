/**
 * Cloud Codex - one-time backfill of doc_images from the HTML documents already show
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

/*
 * The /doc-images handler serves an image only to its uploader and to readers
 * of a document that holds it, and it knows which documents those are from
 * the doc_images table. The migration that creates the table
 * (migrations/2026-09-27-doc-images.sql) leaves it empty, so on an install
 * that already has documents with images, every one of those images is hidden
 * from its readers until this runs.
 *
 * It records a row, with no uploader, for every `/doc-images/<hash>.webp` that
 * a document's `html_content` or any of its versions shows (a version counts
 * because restoring it puts its images back in the document). It trusts what
 * is already stored: before this release the images were public, so anyone
 * who could read the document could already see them. Idempotent (INSERT
 * IGNORE), batched by id, and it prints how many rows it recorded.
 *
 *   npm run backfill:doc-images
 *
 * In containers, like the migration runner:
 *   docker compose -f docker-compose-release.yml run --rm app npm run backfill:doc-images
 */

import { c2_query } from '../mysql_connect.js';
import { docImageHashes, insertDocImageRows } from '../routes/helpers/images.js';
import { isDirectRun } from './migrate.js';

/** Rows read per query. */
export const BATCH_SIZE = 500;

/** Default progress sink. Informational output goes to stdout, as the migration runner's does. */
const defaultLog = (message) => process.stdout.write(`${message}\n`);

/**
 * Walk the rows `sql` selects in id order, BATCH_SIZE at a time, and record the images
 * each row shows against its document.
 * @param {string} sql - selects `id` and `html_content` (and whatever `docIdOf` reads) for rows with `id > ?`
 * @param {(row: object) => number} docIdOf - the document a row's images belong to
 * @returns {Promise<{ rows: number, recorded: number }>}
 */
async function backfillFrom(sql, docIdOf) {
  let lastId = 0;
  let rows = 0;
  let recorded = 0;

  for (;;) {
    const batch = await c2_query(sql, [lastId]);
    for (const row of batch) {
      const hashes = docImageHashes(row.html_content);
      if (hashes.length === 0) continue;
      rows++;
      recorded += await insertDocImageRows(hashes.map((hash) => [hash, docIdOf(row), null]));
    }
    if (batch.length < BATCH_SIZE) break;
    lastId = batch[batch.length - 1].id;
  }

  return { rows, recorded };
}

/**
 * Record every image existing documents and versions show.
 * @returns {Promise<{ documents: number, versions: number, recorded: number }>}
 */
export async function backfillDocImages() {
  // The LIMIT is a constant, not a bound parameter: mysql2's prepared
  // statements reject a numeric LIMIT placeholder on MySQL 8.0.22 and later.
  const documents = await backfillFrom(
    `SELECT id, html_content FROM logs
      WHERE id > ? AND html_content LIKE '%/doc-images/%'
      ORDER BY id LIMIT ${BATCH_SIZE}`,
    (row) => row.id
  );
  const versions = await backfillFrom(
    `SELECT id, log_id, html_content FROM versions
      WHERE id > ? AND log_id IS NOT NULL AND html_content LIKE '%/doc-images/%'
      ORDER BY id LIMIT ${BATCH_SIZE}`,
    (row) => row.log_id
  );

  return {
    documents: documents.rows,
    versions: versions.rows,
    recorded: documents.recorded + versions.recorded,
  };
}

/**
 * The CLI: run the backfill and say what it did.
 * @param {{ log?: (line: string) => void }} [options]
 * @returns {Promise<{ documents: number, versions: number, recorded: number }>}
 */
export async function main({ log = defaultLog } = {}) {
  const result = await backfillDocImages();
  log(
    `backfill-doc-images: recorded ${result.recorded} image reference(s) from ` +
      `${result.documents} document(s) and ${result.versions} version(s)`
  );
  return result;
}

if (isDirectRun(import.meta.url)) {
  try {
    await main();
    // The shared pool in mysql_connect.js keeps the process alive otherwise.
    process.exit(0);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] backfill-doc-images failed:\n${err.message}`);
    process.exit(1);
  }
}
