-- Widen document content to MEDIUMTEXT (open-questions B2).
--
-- logs.html_content was TEXT (65,535 bytes) while the application's own
-- ceiling is 2 MiB (documents.js MAX_CONTENT_SIZE, collab.js MAX_HTML_SIZE).
-- Under STRICT_TRANS_TABLES, which the shipped MySQL 8 image enables by
-- default, a document between those two limits is rejected by the server
-- with an opaque 500 and the user's edit is lost. Measured 2026-08-09: a
-- 40 KiB save returned 200, a 70 KiB save returned 500.
--
-- plain_content must widen too. It is STORED GENERATED from html_content with
-- the tags stripped, so for prose it is very nearly the same size (40,993
-- bytes of HTML produced 40,986 bytes of plain text). Widening html_content
-- alone would only move the same failure one column over.
--
-- The FULLTEXT index over (title, plain_content) is unaffected: MEDIUMTEXT is
-- indexable the same way, and the generation expression is unchanged.

-- versions.html_content is the third one: publish copies logs.html_content
-- into it verbatim, so leaving it TEXT would move the same 500 from save to
-- publish for exactly the documents this migration just unblocked.

ALTER TABLE logs
  MODIFY html_content MEDIUMTEXT,
  MODIFY plain_content MEDIUMTEXT
    GENERATED ALWAYS AS (REGEXP_REPLACE(html_content, '<[^>]+>', '')) STORED;

ALTER TABLE versions
  MODIFY html_content MEDIUMTEXT;
