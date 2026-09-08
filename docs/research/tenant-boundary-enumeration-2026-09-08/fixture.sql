USE c2;

INSERT INTO users (id, name, email, is_admin) VALUES
  (1, 'alice',   'alice@example.com',   FALSE),   -- owner of W1
  (2, 'bob',     'bob@example.com',     FALSE),   -- genuine member of W1
  (3, 'mallory', 'mallory@example.com', FALSE),   -- attacker, no relationship to W1
  (4, 'carol',   'carol@example.com',   FALSE),   -- member of W3 only
  (5, 'root',    'root@example.com',    TRUE);    -- platform admin

INSERT INTO workspaces (id, name, owner_id) VALUES
  (1, 'W1 Acme',      1),
  (2, 'W2 Orphaned',  NULL),
  (3, 'W3 Other',     4);

-- squads
INSERT INTO squads (id, workspace_id, name, created_by) VALUES
  (1, 1,    'S1 Core (legit, by owner)',        1),
  (2, 1,    'S2 PLANTED by mallory',            3),  -- attack (a)
  (3, 1,    'S3 PLANTED by mallory, alibi',     3),  -- second plant, alibis the first
  (4, 1,    'S4 Legit, by member bob',          2),
  (5, 3,    'S5 Other workspace, by carol',     4),
  (6, 1,    'S6 By platform admin',             5),
  (7, NULL, 'S7 Orphaned squad, by mallory',    3),
  (8, 2,    'S8 In orphaned workspace, by bob', 2);

-- squad_members: the attack path enrols its own perpetrator as squad owner
INSERT INTO squad_members (squad_id, user_id, role) VALUES
  (1, 1, 'owner'),
  (1, 2, 'member'),   -- bob's genuine membership of W1, via a squad he did not create
  (2, 3, 'owner'),    -- addSquadOwnerMember on the planted squad
  (3, 3, 'owner'),    -- and on the second planted squad
  (4, 2, 'owner'),
  (5, 4, 'owner'),
  (6, 5, 'owner'),
  (8, 2, 'owner');

-- archives
INSERT INTO archives (id, squad_id, name, created_by) VALUES
  (1, 1,    'A1 Core docs (legit, by bob)',        2),
  (2, 1,    'A2 PLANTED by mallory into S1',       3),  -- attack (b)
  (3, 5,    'A3 Other workspace, by carol',        4),
  (4, 1,    'A4 By platform admin',                5),
  (5, NULL, 'A5 System archive (PR session)',      NULL);
UPDATE archives SET `system` = TRUE WHERE id = 5;

-- ACL grants on A1 (workspace W1)
UPDATE archives SET
  read_access         = JSON_ARRAY(2, 1, 5),  -- bob (member), alice (owner), root (admin): all legitimate
  write_access        = JSON_ARRAY(3),        -- attack (c): mallory, outside W1
  read_access_squads  = JSON_ARRAY(5),        -- attack (c): S5, a squad in W3
  write_access_squads = JSON_ARRAY(1)         -- S1, inside W1: legitimate
WHERE id = 1;

-- dave: a pure attacker who planted only an archive and only took a grant,
-- with no squad anywhere in W1. Separates the plain case from mallory's, whose
-- planted squads give her a squad_members row in W1.
INSERT INTO users (id, name, email, is_admin) VALUES (6, 'dave', 'dave@example.com', FALSE);
INSERT INTO archives (id, squad_id, name, created_by) VALUES (6, 1, 'A6 PLANTED by dave into S1', 6);
UPDATE archives SET read_access = JSON_ARRAY(2, 1, 5, 6) WHERE id = 1;
