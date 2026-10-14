# Stability

What Cloud Codex promises across releases, and where each breaking change is written down. Until 1.0.0
the rules below are proposed, and they take effect when 1.0.0 ships. Before 1.0.0, a minor release may
change anything listed here, but only with an upgrade note in [CHANGELOG.md](../CHANGELOG.md).

## What 1.x promises

- **Configuration.** Every variable in [`cloudcodex/env-contract.js`](../cloudcodex/env-contract.js) keeps its
  name and meaning across 1.x. A variable is removed only in a major release, after at least one minor
  release in which it is a `removed` entry that warns at boot. A new variable is optional or has a default,
  so a 1.x upgrade never requires one.
- **Schema.** From 1.0.0 on, every schema change is a runner migration with its undo written in the file. A
  migration that deletes data says so in the upgrade notes of its release. `init.sql` stays in step with the migrations.
- **HTTP API.** The routes in [`docs/api/`](api/) keep their shape across 1.x. Changes are additive. The
  webhook envelope `codex.event.v1` is stable.
- **Cookies.** The session cookie is `__Host-sessionToken` on https and `sessionToken` on plain http.
- **Upgrade notes.** Every release's CHANGELOG entry has an upgrade section. The 1.0.0 entry states the path
  from 0.13.x, 0.14.x and 0.15.x.

**Not promised:** the UI layout, CSS class names, internal modules and their exports, the vendored design
package's internals, and the test layout.

## The legacy session cookie

`LEGACY_SESSION_COOKIE` (default `1`) lets a browser that holds only the `sessionToken` written before 0.13.0
keep its session on https. The client moves such a session to `__Host-sessionToken` on its first https page
load (`src/util.jsx`). The switch is removed in 1.0.0 only if the premise holds: every such session has
either moved or expired by then.

The premise was measured on 0.15.0 (see the [standalone review record](research/standalone-review-2026-10-14/README.md)):
a browser holding only `sessionToken` was moved to `__Host-sessionToken` on its first https load, and a
session row's `expires_at` is fixed at `created_at` plus its lifetime. Use does not extend it
(`touchSession` updates `last_active_at` only). A local or Google session therefore ends seven days after it
was created, and an OIDC session ends `OIDC_SESSION_TTL_HOURS` after it was created. The premise holds for the
default TTL. An instance that set a long `OIDC_SESSION_TTL_HOURS` keeps such rows until their expiry, so 1.0.0
must check that before the switch is removed, or keep the switch with its default set to `0`.

## Breaking changes since 0.12.0

Each row names the release, what changed for an existing install, and where the upgrade note is.

| Release | What changed | Upgrade note |
|---|---|---|
| 0.12.0 | `TRUST_PROXY` names proxies by address; the app port publishes on `127.0.0.1`; the production networks are pinned; `APP_URL` is required in production | CHANGELOG 0.12.0, "Breaking changes" and the upgrade section of [deployment.md](deployment.md#upgrades) |
| 0.13.0 | Session cookie is `__Host-sessionToken` on https, `LEGACY_SESSION_COOKIE` keeps the older name working; a cookie-authenticated write needs an accepted `Origin`; `AUTH_PROVIDERS` without `local` refuses local sign-in | CHANGELOG 0.13.0, "Breaking changes and upgrade notes" |
| 0.14.0 | Sidebar shell; the top bar, footer and tab bar are gone; the density preference is removed | CHANGELOG 0.14.0, "Breaking changes" |
| 0.15.0 | Suite mode, the machine credential, the environment webhook and the `OIDC_ACCOUNT_URL` link are removed; seven routes answer 404; `user_invitations.grants_admin` and `revoked_at` are dropped by a migration | CHANGELOG 0.15.0, "Removed", and [deployment.md](deployment.md#upgrading-to-0150-the-suite-connection-is-removed) |

Changes after 0.15.0 are listed in the CHANGELOG under the release that ships them. Unreleased, on the standalone
track: a blank `SMTP_FROM` now names the host in `APP_URL` (`Cloud Codex <noreply@<APP_URL host>>`) instead of a
vendor's domain; an install that sends mail from the old default must set `SMTP_FROM` to keep its sender.
