/**
 * Image extraction and storage utilities for Cloud Codex
 *
 * Handles extracting base64-encoded images from document HTML content,
 * processing them with sharp, storing them on disk, and replacing
 * the data URIs with served URLs. This keeps large binary blobs out
 * of the database and the full-text search index.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DOC_IMAGES_DIR = path.join(__dirname, '..', '..', 'public', 'doc-images');

// Ensure directory exists on startup
fs.mkdir(DOC_IMAGES_DIR, { recursive: true }).catch(() => {});

const MAX_IMAGE_DIMENSION = 2048;
const MAX_RAW_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB decoded
const WEBP_QUALITY = 85;

/**
 * Process an image buffer: resize if needed, convert to webp,
 * save with a content-hash filename for deduplication.
 * @param {Buffer} buffer - Raw image data
 * @returns {Promise<{filename: string, url: string, size: number}>}
 */
export async function processAndSaveImage(buffer) {
  const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  const filename = `${hash}.webp`;
  const filePath = path.join(DOC_IMAGES_DIR, filename);
  const url = `/doc-images/${filename}`;

  // Dedup: if this exact image already exists, skip processing
  try {
    const stat = await fs.stat(filePath);
    return { filename, url, size: stat.size };
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
  return { filename, url, size: processed.length };
}

/**
 * Extract all base64 data-URI images from HTML, save them to disk,
 * and replace the data URIs with served /doc-images/ URLs.
 *
 * Works by matching `src="data:image/...;base64,..."` attribute values
 * inside any HTML tag (typically <img>).
 *
 * @param {string} html
 * @returns {Promise<string>} Cleaned HTML with data URIs replaced by URLs
 */
export async function extractImagesFromHtml(html) {
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
 * Inline all /doc-images/ URLs back to base64 data URIs so the exported
 * document is fully self-contained. Reads the webp files from disk and
 * converts them to data:image/webp;base64,... URIs.
 *
 * @param {string} html
 * @returns {Promise<string>} HTML with /doc-images/ URLs replaced by data URIs
 */
export async function inlineImagesForExport(html) {
  if (!html) return html;

  // Match src attributes pointing to /doc-images/ (double-quoted)
  const DOC_IMG_RE = /\bsrc\s*=\s*"(\/doc-images\/([^"]+))"/gi;

  const urlToDataUri = new Map();
  let match;
  while ((match = DOC_IMG_RE.exec(html)) !== null) {
    const url = match[1];
    if (urlToDataUri.has(url)) continue;

    const filename = match[2];
    // Sanitize filename: must be a simple hash.webp, no path traversal
    if (!/^[\w.-]+$/.test(filename)) continue;

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
 * @param {string} markdown
 * @returns {Promise<string>} Markdown with /doc-images/ URLs replaced by data URIs
 */
export async function inlineImagesForMarkdownExport(markdown) {
  if (!markdown) return markdown;

  // Match markdown image syntax: ![alt](/doc-images/filename)
  const MD_IMG_RE = /!\[([^\]]*)\]\((\/doc-images\/([\w.-]+))\)/g;

  const urlToDataUri = new Map();
  let match;
  while ((match = MD_IMG_RE.exec(markdown)) !== null) {
    const url = match[2];
    if (urlToDataUri.has(url)) continue;

    const filename = match[3];
    if (!/^[\w.-]+$/.test(filename)) continue;

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
