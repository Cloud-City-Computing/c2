-- P3 GitHub publish-to-release + Squad<->Team mapping + CI surfaces
-- Versions get optional GitHub Release tracking. Squads can be bound to a
-- GitHub Team for manual member sync.

ALTER TABLE versions
  ADD COLUMN github_release_id BIGINT DEFAULT NULL,
  ADD COLUMN github_tag_name VARCHAR(255) DEFAULT NULL,
  ADD COLUMN github_target_repo VARCHAR(500) DEFAULT NULL;

ALTER TABLE squads
  ADD COLUMN github_org VARCHAR(255) DEFAULT NULL,
  ADD COLUMN github_team_slug VARCHAR(255) DEFAULT NULL,
  ADD COLUMN team_sync_at TIMESTAMP NULL DEFAULT NULL,
  ADD UNIQUE KEY uq_squad_team (github_org, github_team_slug);
