-- A removed invitation stays removed (W6-CDX-9, the membership sync).
--
-- DELETE /api/machine/members expires an open invitation, which only stops it binding a sign-in. Expiry
-- is extended by the next PUT, so a stale admission would re-open it, grants_admin included. revoked_at
-- records the removal; PUT refuses a revoked invitation as account_deactivated unless the request says
-- reactivate: true, which clears it.
--
-- NULL means not revoked, so every existing invitation is unchanged.
-- Not idempotent. To undo it:
--   ALTER TABLE user_invitations DROP COLUMN revoked_at;

ALTER TABLE user_invitations
  ADD COLUMN revoked_at TIMESTAMP NULL DEFAULT NULL;
