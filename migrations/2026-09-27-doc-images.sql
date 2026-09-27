-- Who may see a document image (W6-CDX-34).
--
-- /doc-images used to be a public static mount, so an image's only protection
-- was that a stranger did not know its address. The handler that replaces it
-- serves an image to its uploader and to anyone who can read a document that
-- holds it, and this table is how it knows which documents those are: one row
-- per (image, document), written when an image is uploaded into a document
-- and whenever a save stores HTML that shows one.
--
-- hash is the file's name without .webp: the first 16 hex digits of the
-- SHA-256 of the uploaded bytes (routes/helpers/images.js). uploaded_by is set
-- only for a row whose writer supplied the bytes, and it survives the
-- uploader losing access to the document; a row recorded from a reference to
-- an image that already existed carries NULL. Deleting the document deletes
-- its rows, so its readers stop seeing the images through it.
--
-- ── AFTER APPLYING IT ────────────────────────────────────────────────────
--
-- The table starts empty, so every image an existing document shows is hidden
-- from its readers until the backfill records it. Run it once, right after
-- this migration and before starting the new image:
--
--   npm run backfill:doc-images
--
-- It scans logs.html_content and versions.html_content for /doc-images/ and
-- is idempotent. Until it has run, DOC_IMAGES_PUBLIC=1 keeps the old public
-- mount.
--
-- Additive, so neither direction breaks the application, and not idempotent
-- (a second application fails with ER_TABLE_EXISTS_ERROR, which the runner
-- explains). To undo it:
--   DROP TABLE doc_images;

CREATE TABLE doc_images (
  hash CHAR(16) NOT NULL,
  log_id INT NOT NULL,
  uploaded_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (hash, log_id),
  INDEX idx_doc_images_log (log_id),
  FOREIGN KEY (log_id) REFERENCES logs(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;
