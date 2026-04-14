-- Add markdown_content column to logs table for lossless markdown storage
ALTER TABLE logs ADD COLUMN markdown_content MEDIUMTEXT DEFAULT NULL AFTER html_content;
