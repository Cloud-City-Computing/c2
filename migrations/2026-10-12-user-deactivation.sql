-- A deactivated user keeps their authorship and loses their access (W6-CDX-8).
--
-- NULL means active, so every existing user stays active. A deactivated user is refused by
-- validateAndAutoLogin (their sessions end), by resolveIdentity (account_deactivated, on every rung),
-- and by local password login. Nothing in this release sets it: an operator does, by hand, until
-- the membership sync (W6-CDX-9) and an admin control arrive.
--
-- Additive and not idempotent. To undo it:
--   ALTER TABLE users DROP COLUMN deactivated_at;

ALTER TABLE users
  ADD COLUMN deactivated_at TIMESTAMP NULL DEFAULT NULL;
