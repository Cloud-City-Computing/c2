-- Fixture for the `/api/users/search` scoping check. Loaded into its own
-- schema, `c2search`, so it cannot interfere with the enumeration fixture.
USE c2search;

INSERT INTO users (id, name, email, is_admin) VALUES
  (1, 'alice', 'alice@example.com', FALSE),   -- owner of W1, in no squad
  (2, 'bob',   'bob@example.com',   FALSE),   -- ordinary member of S1, no flags
  (3, 'erin',  'erin@example.com',  FALSE),   -- SSO auto-provisioned, no squad anywhere
  (4, 'dan',   'dan@example.com',   FALSE),   -- squad admin in S1
  (5, 'frank', 'frank@example.com', FALSE),   -- ordinary member of S2 in W2
  (6, 'grace', 'grace@example.com', FALSE),   -- owner of W2, in no squad
  (7, 'root',  'root@example.com',  TRUE);    -- platform admin

INSERT INTO workspaces (id, name, owner_id) VALUES
  (1, 'W1 Acme',  1),
  (2, 'W2 Other', 6);

INSERT INTO squads (id, workspace_id, name, created_by) VALUES
  (1, 1, 'S1 Core',  1),
  (2, 2, 'S2 Other', 6);

INSERT INTO squad_members (squad_id, user_id, role, can_manage_members) VALUES
  (1, 2, 'member', FALSE),   -- bob: no management standing at all
  (1, 4, 'admin',  FALSE),   -- dan: role admin, so he can invite
  (2, 5, 'member', FALSE);   -- frank: W2 only
