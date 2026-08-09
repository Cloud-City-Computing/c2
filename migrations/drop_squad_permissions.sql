-- Drop squad_permissions (open-questions A3).
--
-- The table was read and written by GET/PUT /api/squads/:id/permissions and
-- enforced by nothing: requirePermission consults the global `permissions`
-- table and then squad_members.can_create_*, never this. A workspace owner
-- could toggle create_archive/create_log through the API, the value persisted,
-- and no behaviour changed.
--
-- squad_members already carries per-member can_create_log / can_create_archive
-- flags that ARE enforced, so this was a second, redundant answer to the same
-- question. Both routes and their two (uncalled) frontend wrappers are removed
-- alongside this migration.

DROP TABLE IF EXISTS squad_permissions;
