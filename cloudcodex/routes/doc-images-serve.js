/**
 * The /doc-images mount: document images, served only to the people who can read them
 *
 * An image goes to its uploader and to anyone who can read a document that
 * holds it (readableDocImageHashes in routes/helpers/images.js, over the
 * doc_images table). Everyone else gets the same empty 404, whether they are
 * anonymous, signed in without access, asking for a file that does not exist,
 * or asking for a name that is not an image at all, so the answer never says
 * which. A served image is cached privately for a day: a shared cache must not
 * keep it, and a browser may.
 *
 * DOC_IMAGES_PUBLIC=1 mounts the public static handler this replaced, for an
 * install that has not run `npm run backfill:doc-images` yet.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import { extractSessionToken } from '../middleware/auth.js';
import { validateAndAutoLogin } from '../mysql_connect.js';
import { asyncHandler, errorHandler } from './helpers/shared.js';
import { DOC_IMAGES_DIR, docImagesPublic, readableDocImageHashes } from './helpers/images.js';

const IMAGE_FILE = /^([0-9a-f]{16})\.webp$/;

/** The one refusal: empty, uncacheable, and the same for every reason. */
function notFound(res) {
  res.status(404).set('Cache-Control', 'no-store').end();
}

/**
 * The handler app.js mounts at /doc-images. Which one is decided once, when
 * it is built, from DOC_IMAGES_PUBLIC.
 * @param {{ dir?: string }} [options] - the image directory (tests pass a temporary one)
 * @returns {import('express').RequestHandler}
 */
export function docImagesHandler({ dir = DOC_IMAGES_DIR } = {}) {
  if (docImagesPublic()) {
    console.error(
      `[${new Date().toISOString()}] doc-images: DOC_IMAGES_PUBLIC=1, so document images are served to anyone ` +
        'who has the address. Unset it once `npm run backfill:doc-images` has run.'
    );
    return express.static(dir, { maxAge: '30d', immutable: true });
  }

  const router = express.Router();

  router.get('/:file', asyncHandler(async (req, res, next) => {
    const match = IMAGE_FILE.exec(req.params.file);
    const token = match ? extractSessionToken(req) : null;
    // No touchSession: an image load is not activity, and a page of images
    // would otherwise be a page of session writes.
    const user = token ? await validateAndAutoLogin(token) : null;
    if (!user) return notFound(res);

    const [readable] = await readableDocImageHashes([match[1]], user);
    if (!readable) return notFound(res);

    res.sendFile(`${match[1]}.webp`, {
      root: dir,
      cacheControl: false,
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      },
    }, (err) => {
      if (!err || res.headersSent) return;
      // A recorded image whose file is gone is refused like any other.
      if (err.status === 404) return notFound(res);
      next(err);
    });
  }));

  // Anything else under /doc-images (a nested path, another method) ends here
  // too, rather than falling through to the SPA.
  router.use((_req, res) => notFound(res));
  router.use(errorHandler);

  return router;
}
