-- Cloud Codex - Seed Data
--
-- All Rights Reserved to Cloud City Computing, LLC 2026
-- https://cloudcitycomputing.com

DELETE FROM organizations;

-- =========================
-- Organizations
-- =========================
INSERT INTO organizations (name, owner)
VALUES ('Acme Organization', 'owner@acme.com');

SET @org_id = LAST_INSERT_ID();

-- =========================
-- Users
-- =========================
DELETE FROM users;
INSERT INTO users (name, email, password_hash)
VALUES
  ('Alice Admin', 'alice@acme.com', 'hash_alice'),
  ('Bob Builder', 'bob@acme.com', 'hash_bob'),
  ('Carol Editor', 'carol@acme.com', 'hash_carol');

-- Capture user IDs
SELECT
  @alice_id := MIN(id),
  @bob_id   := MIN(id) + 1,
  @carol_id := MIN(id) + 2
FROM users;

-- =========================
-- Teams
-- =========================
DELETE FROM teams;
INSERT INTO teams (organization_id, name, created_by)
VALUES (
  @org_id,
  'Core Team',
  @alice_id
);

SET @team_id = LAST_INSERT_ID();

-- =========================
-- Permissions
-- =========================
DELETE FROM permissions;
INSERT INTO permissions (user_id, create_team, create_project, create_page)
VALUES
  (@alice_id, TRUE, TRUE, TRUE),
  (@bob_id,   FALSE, TRUE, TRUE),
  (@carol_id, FALSE, FALSE, TRUE);

-- =========================
-- Projects
-- =========================
DELETE FROM projects;
INSERT INTO projects (
  team_id,
  name,
  created_by,
  read_access,
  write_access
) VALUES (
  @team_id,
  'Website Redesign',
  @alice_id,
  JSON_ARRAY(@alice_id, @bob_id, @carol_id),
  JSON_ARRAY(@alice_id, @bob_id)
);

SET @project_id = LAST_INSERT_ID();

-- =========================
-- Pages (root page)
-- =========================
DELETE FROM pages;
INSERT INTO pages (
  project_id,
  title,
  html_content,
  created_by,
  read_access,
  write_access
) VALUES (
  @project_id,
  'Home',
  '<h1>Welcome</h1><p>This is the homepage.</p>',
  @alice_id,
  JSON_ARRAY(@alice_id, @bob_id, @carol_id),
  JSON_ARRAY(@alice_id, @bob_id)
);

SET @home_page_id = LAST_INSERT_ID();

-- =========================
-- Pages (child page)
-- =========================
INSERT INTO pages (
  project_id,
  parent_id,
  title,
  html_content,
  created_by
) VALUES (
  @project_id,
  @home_page_id,
  'Getting Started',
  '<p>Here is how to get started.</p>',
  @bob_id
);

SET @child_page_id = LAST_INSERT_ID();

-- =========================
-- Page Versions
-- =========================
DELETE FROM versions;
INSERT INTO versions (
  page_id,
  version,
  html_content,
  created_by,
  read_access
) VALUES
  (
    @home_page_id,
    1,
    '<h1>Welcome</h1><p>Initial version.</p>',
    @alice_id,
    JSON_ARRAY(@alice_id, @bob_id, @carol_id)
  ),
  (
    @child_page_id,
    1,
    '<p>Initial getting started content.</p>',
    @bob_id,
    JSON_ARRAY(@alice_id, @bob_id)
  );

-- =========================
-- Optional update test
-- =========================
UPDATE pages
SET
  html_content = '<h1>Welcome</h1><p>Updated homepage content.</p>',
  updated_by = @carol_id,
  version = version + 1
WHERE id = @home_page_id;
