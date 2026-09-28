/**
 * Image extraction and storage utilities for Cloud Codex
 *
 * Handles extracting base64-encoded images from document HTML content,
 * processing them with sharp, storing them on disk, and replacing
 * the data URIs with served URLs. This keeps large binary blobs out
 * of the database and the full-text search index.
 *
 * Also the one definition of who may see a stored image: its uploader, or
 * anyone who can read a document that holds it, recorded in `doc_images`.
 * The /doc-images handler, export and the write paths all ask through
 * readableDocImageHashes, so there is one answer to that question.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { c2_query } from '../../mysql_connect.js';
import { readAccessWhere, readAccessParams } from './ownership.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DOC_IMAGES_DIR = path.join(__dirname, '..', '..', 'public', 'doc-images');

// Ensure directory exists on startup. recursive:true makes "already exists"
// non-erroring; any other error (e.g. EACCES) means image uploads will fail
// later with a useful error, but log the cause now so it's diagnosable.
fs.mkdir(DOC_IMAGES_DIR, { recursive: true }).catch((err) => {
  console.error(`[${new Date().toISOString()}] images: failed to ensure ${DOC_IMAGES_DIR}:`, err);
});

// A stored image's name is the first 16 hex digits of its SHA-256, plus .webp.
const DOC_IMAGE_HASH = /^[0-9a-f]{16}$/;
const DOC_IMAGE_FILE = /^([0-9a-f]{16})\.webp$/;
const DOC_IMAGE_REF = /\/doc-images\/([0-9a-f]{16})\.webp/g;

// Hashes per query. A document can name thousands of images, and one IN list
// per document could pass MySQL's 65,535-placeholder ceiling.
const HASH_BATCH = 500;

const MAX_IMAGE_DIMENSION = 2048;
const MAX_RAW_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB decoded
const WEBP_QUALITY = 85;

/**
 * Process an image buffer: resize if needed, convert to webp,
 * save with a content-hash filename for deduplication.
 * @param {Buffer} buffer - Raw image data
 * @returns {Promise<{hash: string, filename: string, url: string, size: number}>}
 */
export async function processAndSaveImage(buffer) {
  const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  const filename = `${hash}.webp`;
  const filePath = path.join(DOC_IMAGES_DIR, filename);
  const url = `/doc-images/${filename}`;

  // Dedup: if this exact image already exists, skip processing
  try {
    const stat = await fs.stat(filePath);
    return { hash, filename, url, size: stat.size };
  } catch {
    // File doesn't exist yet — process below
  }

  const processed = await sharp(buffer)
    .resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();

  await fs.writeFile(filePath, processed);
  return { hash, filename, url, size: processed.length };
}

/**
 * Extract all base64 data-URI images from HTML, save them to disk,
 * and replace the data URIs with served /doc-images/ URLs.
 *
 * Works by matching `src="data:image/...;base64,..."` attribute values
 * inside any HTML tag (typically <img>).
 *
 * @param {string} html
 * @param {Set<string>} [saved] - when given, receives the hash of every image
 *   this call decoded, which is what tells recordDocImages that the writer
 *   supplied those bytes rather than only naming an existing image
 * @returns {Promise<string>} Cleaned HTML with data URIs replaced by URLs
 */
export async function extractImagesFromHtml(html, saved) {
  if (!html) return html;

  // Match src attributes containing data:image base64 URIs (double or single quoted)
  const DATA_URI_SRC_RE = /\bsrc\s*=\s*"(data:image\/[\w+.-]+;base64,([^"]+))"/gi;

  // Collect unique data URIs and their replacements
  const uriToUrl = new Map();
  let match;
  while ((match = DATA_URI_SRC_RE.exec(html)) !== null) {
    const dataUri = match[1];
    if (uriToUrl.has(dataUri)) continue;

    const base64Data = match[2];
    try {
      const buffer = Buffer.from(base64Data, 'base64');
      if (buffer.length > MAX_RAW_IMAGE_SIZE) continue;

      const result = await processAndSaveImage(buffer);
      uriToUrl.set(dataUri, result.url);
      saved?.add(result.hash);
    } catch (err) {
      console.error('[images] Failed to extract embedded image:', err.message);
    }
  }

  // Replace all occurrences of each data URI with the corresponding URL
  let cleaned = html;
  for (const [dataUri, url] of uriToUrl) {
    // Use split+join for literal string replacement (safe with special chars)
    cleaned = cleaned.split(dataUri).join(url);
  }

  return cleaned;
}

/**
 * Which of `filenames` the exporting user may have inlined.
 *
 * Export reads image files straight off disk, so it has to ask the same
 * question the /doc-images handler asks, or it would hand a document's writer
 * the bytes of any image whose address they typed into it. With
 * DOC_IMAGES_PUBLIC=1 every file is allowed, as it was before.
 * @param {string[]} filenames
 * @param {object} [user]
 * @returns {Promise<(filename: string) => boolean>}
 */
async function exportableFiles(filenames, user) {
  if (docImagesPublic()) return () => true;
  const hashes = filenames.map((name) => DOC_IMAGE_FILE.exec(name)?.[1]).filter(Boolean);
  const readable = new Set(await readableDocImageHashes(hashes, user));
  return (filename) => readable.has(DOC_IMAGE_FILE.exec(filename)?.[1]);
}

/**
 * Inline all /doc-images/ URLs back to base64 data URIs so the exported
 * document is fully self-contained. Reads the webp files from disk and
 * converts them to data:image/webp;base64,... URIs.
 *
 * Only the images `user` may see are inlined; any other reference is left as
 * its URL (see exportableFiles).
 *
 * @param {string} html
 * @param {object} [user] - the exporting user
 * @returns {Promise<string>} HTML with /doc-images/ URLs replaced by data URIs
 */
export async function inlineImagesForExport(html, user) {
  if (!html) return html;

  // Match src attributes pointing to /doc-images/ (double-quoted)
  const DOC_IMG_RE = /\bsrc\s*=\s*"(\/doc-images\/([^"]+))"/gi;

  const allowed = await exportableFiles(Array.from(html.matchAll(DOC_IMG_RE), (m) => m[2]), user);

  const urlToDataUri = new Map();
  let match;
  while ((match = DOC_IMG_RE.exec(html)) !== null) {
    const url = match[1];
    if (urlToDataUri.has(url)) continue;

    const filename = match[2];
    // Sanitize filename: must be a simple hash.webp, no path traversal
    if (!/^[\w.-]+$/.test(filename)) continue;
    if (!allowed(filename)) continue;

    const filePath = path.join(DOC_IMAGES_DIR, filename);
    try {
      const buffer = await fs.readFile(filePath);
      const ext = path.extname(filename).slice(1) || 'webp';
      const mime = ext === 'webp' ? 'image/webp' : `image/${ext}`;
      const dataUri = `data:${mime};base64,${buffer.toString('base64')}`;
      urlToDataUri.set(url, dataUri);
    } catch {
      // File missing on disk — leave the URL as-is
    }
  }

  let result = html;
  for (const [url, dataUri] of urlToDataUri) {
    result = result.split(url).join(dataUri);
  }

  return result;
}

/**
 * Inline /doc-images/ URLs in markdown text. Replaces markdown image
 * references like ![alt](/doc-images/hash.webp) with base64 data URIs.
 *
 * Only the images `user` may see are inlined, as in inlineImagesForExport.
 *
 * @param {string} markdown
 * @param {object} [user] - the exporting user
 * @returns {Promise<string>} Markdown with /doc-images/ URLs replaced by data URIs
 */
export async function inlineImagesForMarkdownExport(markdown, user) {
  if (!markdown) return markdown;

  // Match markdown image syntax: ![alt](/doc-images/filename)
  const MD_IMG_RE = /!\[([^\]]*)\]\((\/doc-images\/([\w.-]+))\)/g;

  const allowed = await exportableFiles(Array.from(markdown.matchAll(MD_IMG_RE), (m) => m[3]), user);

  const urlToDataUri = new Map();
  let match;
  while ((match = MD_IMG_RE.exec(markdown)) !== null) {
    const url = match[2];
    if (urlToDataUri.has(url)) continue;

    const filename = match[3];
    if (!/^[\w.-]+$/.test(filename)) continue;
    if (!allowed(filename)) continue;

    const filePath = path.join(DOC_IMAGES_DIR, filename);
    try {
      const buffer = await fs.readFile(filePath);
      const ext = path.extname(filename).slice(1) || 'webp';
      const mime = ext === 'webp' ? 'image/webp' : `image/${ext}`;
      const dataUri = `data:${mime};base64,${buffer.toString('base64')}`;
      urlToDataUri.set(url, dataUri);
    } catch {
      // File missing — leave as-is
    }
  }

  let result = markdown;
  for (const [url, dataUri] of urlToDataUri) {
    result = result.split(url).join(dataUri);
  }

  return result;
}

// ── Who may see an image ─────────────────────────────────────────────────

/**
 * Whether document images are served publicly, as they were before
 * `doc_images` existed. `DOC_IMAGES_PUBLIC=1` exactly; any other value, or
 * none, means the authorized handler.
 * @returns {boolean}
 */
export function docImagesPublic() {
  return process.env.DOC_IMAGES_PUBLIC === '1';
}

/**
 * The served images `text` shows (HTML or markdown), each hash once, in
 * order of first appearance. Only `/doc-images/<16 hex>.webp` counts, which is
 * the only name processAndSaveImage ever writes.
 * @param {string} text
 * @returns {string[]}
 */
export function docImageHashes(text) {
  if (!text) return [];
  return [...new Set(Array.from(text.matchAll(DOC_IMAGE_REF), (m) => m[1]))];
}

/**
 * The subset of `hashes` that `user` may see: images they uploaded, and
 * images held by a document in an archive they can read (the archive read
 * fragment from ownership.js, so an admin sees every image). No user, or no
 * valid hash, asks nothing and returns nothing.
 * @param {string[]} hashes
 * @param {object} [user]
 * @returns {Promise<string[]>}
 */
export async function readableDocImageHashes(hashes, user) {
  const wanted = [...new Set(hashes)].filter((hash) => DOC_IMAGE_HASH.test(hash));
  if (!user || wanted.length === 0) return [];

  const readable = [];
  for (let i = 0; i < wanted.length; i += HASH_BATCH) {
    const batch = wanted.slice(i, i + HASH_BATCH);
    const rows = await c2_query(
      `SELECT DISTINCT di.hash
         FROM doc_images di
   INNER JOIN logs l ON l.id = di.log_id
   INNER JOIN archives p ON p.id = l.archive_id
        WHERE di.hash IN (${batch.map(() => '?').join(', ')})
          AND (di.uploaded_by = ? OR ${readAccessWhere('p')})`,
      [...batch, user.id, ...readAccessParams(user)]
    );
    for (const row of rows) readable.push(row.hash);
  }
  return readable;
}

/**
 * INSERT IGNORE `(hash, log_id, uploaded_by)` rows, in batches, and return
 * how many were new. This asks nobody anything: the caller has already
 * decided these rows are owed. Route code goes through recordDocImages (or,
 * for an upload, checks write access first); the backfill calls this
 * directly because it records what existing documents already show.
 * @param {Array<[string, number, number|null]>} rows
 * @returns {Promise<number>}
 */
export async function insertDocImageRows(rows) {
  let recorded = 0;
  for (let i = 0; i < rows.length; i += HASH_BATCH) {
    const batch = rows.slice(i, i + HASH_BATCH);
    const result = await c2_query(
      `INSERT IGNORE INTO doc_images (hash, log_id, uploaded_by) VALUES ${batch.map(() => '(?, ?, ?)').join(', ')}`,
      batch.flat()
    );
    recorded += result?.affectedRows ?? 0;
  }
  return recorded;
}

/**
 * Record the images a just-written document's HTML shows, so its readers can
 * see them. Call it for each write of `html_content` (or a version) that went
 * through extractImagesFromHtml, with the same `saved` set.
 *
 * A row is a grant to every reader of the document, so the writer may vouch
 * only for what this write puts there:
 *
 * - an image in `saved` was decoded from bytes this writer supplied, and is
 *   recorded as theirs;
 * - a reference in `introduced` (the ones this write added, from
 *   introducedDocImages, or credited to this writer by a live session) is
 *   recorded, with no uploader, only if the writer can already see it;
 * - every other reference is left alone, however much the writer can see.
 *
 * Without the last rule, a reference somebody planted (knowing an address is
 * enough to type it) would be granted by the next save, publish or restore
 * from anyone who can see the image, an owner fixing a typo or any admin.
 * @param {number} logId
 * @param {string} html - the HTML as stored
 * @param {object} writer
 * @param {{ saved?: Set<string>, introduced?: string[] }} [options]
 * @returns {Promise<number>} rows newly recorded
 */
export async function recordDocImages(logId, html, writer, { saved = new Set(), introduced = [] } = {}) {
  const hashes = docImageHashes(html);
  if (hashes.length === 0) return 0;
  if (!writer) throw new Error('recordDocImages needs the writing user');

  const vouched = new Set(introduced);
  const supplied = hashes.filter((hash) => saved.has(hash));
  const readable = await readableDocImageHashes(
    hashes.filter((hash) => !saved.has(hash) && vouched.has(hash)),
    writer
  );

  return insertDocImageRows([
    ...supplied.map((hash) => [hash, logId, writer.id]),
    ...readable.map((hash) => [hash, logId, null]),
  ]);
}

// ── Live editing sessions ────────────────────────────────
//
// Every client in a live session saves the whole shared document, so the
// client that sends a save is not necessarily the writer who added what it
// carries. DocImageCredits remembers, per open document, which writer's own
// edit first put each reference into the shared document; services/collab.js
// keeps one per open document and records by it.

/**
 * Credits kept per open document. An honest document does not name this many
 * images, so past it a session credits nothing more (fails closed) rather
 * than let a client grow the map without bound.
 */
export const MAX_DOC_IMAGE_CREDITS = 5000;

export class DocImageCredits {
  constructor() {
    /** The references the document's stored HTML shows: nobody's to claim. */
    this.stored = new Set();
    /** hash -> the writer whose own edit first put it in the shared document */
    this.credits = new Map();
  }

  /**
   * The document now stores `texts` (its HTML, and at load the shared
   * document itself). Replaces the previous set, so an image removed, saved
   * and then pasted back counts as the paster's.
   * @param {...string} texts
   */
  setStored(...texts) {
    this.stored = new Set(texts.flatMap((text) => docImageHashes(text)));
  }

  /**
   * One edit from `writer` changed the shared document. A reference is
   * credited to them when the edit's own bytes named it (`named`), it was not
   * in the shared document before (`before`) and is after (`after`), the
   * stored document does not already show it, and nobody has the credit yet.
   * So re-sending something already there (the first client filling the
   * document from its HTML, or an edit that recreates a node) claims nothing,
   * and neither does a reference typed a character at a time.
   * @param {object} writer
   * @param {string[]} named
   * @param {string[]} before
   * @param {string[]} after
   */
  noteMessage(writer, named, before, after) {
    const was = new Set(before);
    const is = new Set(after);
    for (const hash of named) {
      if (this.credits.size >= MAX_DOC_IMAGE_CREDITS) return;
      if (!is.has(hash) || was.has(hash) || this.stored.has(hash) || this.credits.has(hash)) continue;
      this.credits.set(hash, writer);
    }
  }

  /**
   * @param {string} hash
   * @returns {object|null} the writer credited with it
   */
  creditedTo(hash) {
    return this.credits.get(hash) ?? null;
  }

  /**
   * The references `html` shows that someone is credited with, grouped by
   * that writer, in order of first appearance.
   * @param {string} html
   * @returns {Array<[object, string[]]>}
   */
  byUser(html) {
    const groups = new Map();
    for (const hash of docImageHashes(html)) {
      const writer = this.credits.get(hash);
      if (!writer) continue;
      if (!groups.has(writer)) groups.set(writer, []);
      groups.get(writer).push(hash);
    }
    return [...groups];
  }
}

/** logId -> the DocImageCredits of that document's live session. */
const liveCredits = new Map();

/**
 * A live session opened on `logId`: start its credits and register them, so
 * a REST save of the same document can ask them.
 * @param {number} logId
 * @returns {DocImageCredits}
 */
export function openDocImageCredits(logId) {
  const credits = new DocImageCredits();
  liveCredits.set(logId, credits);
  return credits;
}

/**
 * The session holding `credits` closed. Leaves a newer session's alone.
 * @param {number} logId
 * @param {DocImageCredits} credits
 */
export function closeDocImageCredits(logId, credits) {
  if (liveCredits.get(logId) === credits) liveCredits.delete(logId);
}

/**
 * @param {number} logId
 * @returns {DocImageCredits|null}
 */
export function liveDocImageCredits(logId) {
  return liveCredits.get(logId) ?? null;
}

/**
 * A REST write stored `html` for `logId`: tell its live session, if any, so
 * what the restoring or saving editor then pushes into the shared document is
 * not credited to it.
 * @param {number} logId
 * @param {string} html
 */
export function noteStoredDocImages(logId, html) {
  liveCredits.get(logId)?.setStored(html);
}

/**
 * The references a write of `html` over `previousHtml` may vouch for: the
 * ones it adds. With a live session open on the document, only those the
 * session credits to `writer`, since an editor's REST save carries the shared
 * document too, other writers' edits included.
 * @param {number} logId
 * @param {string} html
 * @param {string|null} previousHtml
 * @param {object} writer
 * @returns {string[]}
 */
export function introducedDocImages(logId, html, previousHtml, writer) {
  const before = new Set(docImageHashes(previousHtml));
  const added = docImageHashes(html).filter((hash) => !before.has(hash));
  const live = liveCredits.get(logId);
  if (!live) return added;
  return added.filter((hash) => live.creditedTo(hash)?.id === writer.id);
}

/**
 * Record the references `html` shows that `credits` gives someone, each only
 * if the writer credited with it can see it.
 * @param {number} logId
 * @param {string} html
 * @param {DocImageCredits} credits
 * @returns {Promise<number>} rows newly recorded
 */
export async function recordCreditedDocImages(logId, html, credits) {
  let recorded = 0;
  for (const [writer, introduced] of credits.byUser(html)) {
    recorded += await recordDocImages(logId, html, writer, { introduced });
  }
  return recorded;
}
