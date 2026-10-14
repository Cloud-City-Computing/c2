# Pre-1.0 standalone review, 2026-10-14 (CDX-SA-6)

The review that PR 6 of the [standalone plan](../../plans/2026-10-14-standalone-codex.md) asks for, run on
the branch `track/cdx-sa-6-standalone-review` cut from `9080da4` (release 0.15.0). Raw outputs, redacted
config and the screenshots are in [`raw/`](raw/). Nothing here was pushed or opened as a PR.

## Results at a glance

| Check | Result |
|---|---|
| 6.1 The image carries nothing of the suite | Pass. The image grep (spec wording) finds only `env-contract.js` and `services/removed-env.js`, plus a vendored license line (below). |
| 6.2 Clean-clone boot with local accounts | Pass. Invite by copyable link, no SMTP; the member signs in and opens the welcome document; the 7 removed routes answer 404 JSON; two removed variables warn and the app serves. |
| 6.3 Non-default OIDC provider (Keycloak 26.4.7) | Pass for every spec item. The admin-console step was done through the admin REST API (deviation). |
| 6.4 Four caveats, legacy cookie, IS8, IS10 | Caveats closed; legacy premise holds for default TTLs; IS8 open for Kyle (recommendation below); IS10 changed. |
| CI mirror | See "Checks run" below. |

## 6.1 The image

Built from the branch: `docker compose -f docker-compose-prod.yml build app` (image `cdx-sa-6-app`, 735 MB).
`docker run --rm --entrypoint sh <image> -c "grep -rIl -i -E 'suite mode|cloud command|SUITE_COMMAND|machine/members|reader-check|documents/state|zitadel' /app --exclude-dir=node_modules"`
printed `env-contract.js`, `services/removed-env.js` and `vendor/cloud-city-design/NOTICE`. The first two are the
expected `removed` entries. The NOTICE line is the vendored package's trademark notice, which names a private
product (follow-up S3 in `docs/maps/open-questions.md`). A broader grep for `suite` found only the two
`cc_suite_theme` and `cc_suite_accent` cookie names, a stored contract the standalone gate allows
(`src/lib/appearance-prefs.js`, `index.html`) and vendor code. Renaming those cookies would reset every stored
theme, so they stay (see raw/61-*).

## 6.2 Clean clone, local accounts

- Source: a fresh clone of `Cloud-City-Computing/c2` main, which is `9080da4`, the branch's base. The branch had no
  commits of its own at this step, so the clone equals the branch base. Compose project `cdxsa6-clean`.
- First install as `docs/deployment.md` writes it: `.env` from `.env.example` with generated secrets, then
  `up -d --build`, then `run --rm app npm run migrate -- --adopt-fresh-install`. Adoption recorded 28 files.
- Readiness: `/readyz` answered 503 `migrations` before the adoption and 200 after it (the answer is cached for
  ten seconds).
- The boot admin signed in, created an invitation for `member@example.test` with no SMTP (the response says
  `emailed: false` and carries the link). The member created the account from the link, signed in through the UI,
  and opened the seeded welcome document (`shots/03`).
- Seven removed routes, as admin and anonymous: all `404` JSON (`raw/62-removed-routes.txt`).
- `SERVICE_TOKEN=x` and `SUITE_NAME=y` in `.env`, then a restart: one warning line each, and the app served
  (`raw/62-local-accounts-run.txt`).
- Note for the plan: the invitation's link was copied from the database for the first run, because the first
  script read the wrong key from the response. The response itself carries `signup_url`.

## 6.3 Keycloak 26.4.7, a non-default provider

- Image pinned: `quay.io/keycloak/keycloak:26.4@sha256:9409c59bdfb65dbffa20b11e6f18b8abb9281d480c7ca402f51ed3d5977e6007`.
- Names: `keycloak.localhost:8180` (issuer, Keycloak's network alias) and `codex.localhost:3000` (the app's
  `APP_URL` and its network alias), so one name resolves the same from the browser and the containers.
- Realm `codex`: a confidential client with the three URIs, the back-channel logout URL, two users with verified
  email (invitee, stranger) and the boot admin's address. The realm (secrets redacted) is `raw/keycloak-realm-codex.redacted.json`.
- With local sign-in on:
  - the invited address signed in through Keycloak and landed in squad `General` (`shots/04`);
  - the uninvited verified address was refused: "No account found for this sign-in. Ask your administrator for an invitation." (`shots/05`);
  - RP-initiated sign-out ended the Keycloak session (sessions 1 to 0) and the Codex session (`shots/06`);
  - an administrator ended the session at Keycloak: the open tab's socket closed with **4004 "Signed out"**, and the
  next request was refused (`shots/07`).
- `AUTH_PROVIDERS=oidc` with the boot admin's username and password blank: the signed-out root bounced to Keycloak
  (`shots/08`), the local routes answered 404, and the boot admin signed in through Keycloak with no password and
  was an admin (`shots/09`). The boot log showed the 10 non-OIDC sessions ended.
- Deviation: the session ending was a `DELETE /admin/realms/codex/sessions/{id}` on the admin REST API, not the
  admin console UI. It is the server action the console uses, but it was not driven through the UI.
- A first run of the back-channel step ended the wrong Keycloak session (sessions were not sorted by start time).
  It proved nothing and is not cited; the rerun is the evidence.
- Findings from following `docs/sign-in.md`'s Keycloak section (fixed in the doc, marked verified):
  - the back-channel URL and "Backchannel logout session required" are under the client's Logout settings in 26.x;
  - the post-logout URI is under Advanced (Valid post logout redirect URIs), not beside the redirect URIs;
  - Keycloak calls the back-channel URL from its own server, so `APP_URL` must resolve from there as well (a
    gap in the doc, now written down).
- Okta and Authentik were not run (Keycloak ran, so the fallback was not needed).

## 6.4 The caveats, and the decisions

1. **Suite mode is absent** (6.1 and the standalone gate, which passes in `npm test`).
2. **Stability promise and breaking changes** are in [`docs/stability.md`](../../stability.md), from the spec's
   "What 1.0 promises". Breaking changes since 0.12.0 are in its table, each with the CHANGELOG section that
   carries its upgrade note. The deployment doc links to it.
3. **Provider-neutral wording.** Fixed in source and docs: `.env.example`'s sample issuer, the sample issuer in
   `docs/security.md`, the sample response in `docs/api/oauth-github.md`, the maps (`request-lifecycle.md`,
   `frontend-architecture.md`, `open-questions.md`), and the comments that named a sibling product (`docker-compose*.yml`,
   `vitest.config.js`, `routes/oidc.js`, `services/return-to.js`). A test fixture named the private product and
   now uses a neutral name. Not changed, on purpose: applied migrations (their comments name a provider or the
   sibling product, and changing a comment changes the checksum that the runner guards) and the dated records.
4. **The plug point.** One issuer per instance is documented (`docs/sign-in.md`). The provider sections exist.
   `OIDC_PROVIDER_NAME` is documented. `OIDC_ACCOUNT_URL` and the machine credential are removed and documented.
   The Keycloak section is verified; Entra is not (see IS8).

### Legacy cookie premise: holds for the default TTL

On the running image over https (`socat` TLS proxy on `127.0.0.1:8443`, self-signed certificate under `/tmp`,
`APP_URL=https://codex.localhost:8443`):

- A browser holding only a `sessionToken` cookie (set to a live session's token) loaded the app, and afterwards held
  only `__Host-sessionToken`. `/api/first-run` answered 200 with the moved session (`shots/10`).
- Expiry: a local session row's `expires_at` is `created_at` + 7 days (168 h), and `touchSession` updates only
  `last_active_at`, so use does not extend it. An OIDC row is `created_at` + `OIDC_SESSION_TTL_HOURS` (24 h by default).
- Conclusion: every pre-0.13.0 session has expired by default. **Caveat for PR 7:** an instance with a long
  `OIDC_SESSION_TTL_HOURS` keeps such rows until their expiry, so the switch's removal needs a TTL check (S2 in
  the open questions map). Recorded in `docs/stability.md`. PR 7 should not remove the switch without that check.

### IS8: the verified-email requirement. Recommendation for Kyle (not built)

- What the code does: `services/oidc.js` refuses any sign-in whose email is not `email_verified: true`
  (`email_not_verified`). Live: an unverified address at Keycloak was refused with the message "Your email address is
  not verified with your sign-in provider." (`shots/11`).
- Why it matters for Entra: Microsoft's optional-claims reference (checked 2026-10-14) lists **no standard
  `email_verified`**. Its verification signal is `xms_edov` ("email domain owner verified"), which needs the `email`
  claim and does not cover every account type. Codex does not read `xms_edov`. So a sign-in from an Entra tenant is
  refused today, and the docs alone do not fix that. Neither the Entra docs nor the code say so before the attempt.
- Docs written: the Entra section of `docs/sign-in.md` now says so, and says the decision is open.
- **Recommendation:** keep the requirement (it is what stops an account being linked by an unverified address).
  Decide between: (a) state Entra as unsupported for 1.0 and say why; (b) read `xms_edov` as the verification
  source when `email_verified` is absent, and only when the `email` claim is present. This is a security decision
  because it decides who may link an account, so it needs a test tenant before it ships. (c) an opt-out setting
  that accepts unverified addresses. I do not recommend (c). I did not build any of them.

### IS10: the default From address. Chosen: derive from APP_URL

- Option chosen: a blank `SMTP_FROM` sends as `Cloud Codex <noreply@<host of APP_URL>>`. It names the instance's own
  host, not a vendor's domain, and it does not add a boot refusal for existing installs.
- Rejected: requiring `SMTP_FROM` whenever SMTP is on (a boot refusal for every installation that relies on the
  default). An `APP_URL` on an IPv6 address falls back to `localhost`; that case is tested.
- Tests first (`ce86408`): the default names the APP_URL host, IPv6 falls back, the vendor domain is never named.
- Upgrade note: `CHANGELOG.md` `[Unreleased]`, Changed. Setting `SMTP_FROM` keeps the old behaviour for the sender.

## Other findings

| # | Finding | Fix or follow-up |
|---|---|---|
| F1 | Default From named the vendor's domain (IS10) | Fixed (APP_URL host), tests first, upgrade note |
| F2 | `--adopt-fresh-install` printed a dropped column as "already in the schema" (confusing, found live in 6.2) | Fixed, test first (`migrate.test.js`), the adoption behaviour is unchanged |
| F3 | Provider and sibling-product names in source, samples and maps (see 6.4 item 3) | Fixed, except applied migrations and dated records (immutable, see S4) |
| F4 | Entra sends no standard `email_verified` (IS8) | Open for Kyle; docs state it; recommendation above |
| F5 | Keycloak doc gaps (field locations, post-logout URI, `APP_URL` reachability from Keycloak) | Fixed in `docs/sign-in.md`, marked verified 2026-10-14 |
| F6 | The vendored `cloud-city-design` NOTICE names a private product | Follow-up S3: fix upstream; the vendor copy is pinned and not edited |
| F7 | The `cc_suite_theme` and `cc_suite_accent` cookie names | Accepted: a stored contract, allowed by the gate; renaming resets stored themes |
| F8 | Legacy switch premise depends on the OIDC TTL | Caveat recorded in `docs/stability.md` and S2 for PR 7 |

## Checks run

Host, from `cloudcodex/` on the branch after the fixes:

- `npm ci` (clean install).
- `npm audit --omit=dev --audit-level=moderate`: 0 vulnerabilities.
- `npm run lint`: 0 errors, 18 warnings, all pre-existing in files and lines this branch does not touch.
- `npm test`: 205 files and 4546 tests passed (includes the design and standalone gates).
- `npm run test:coverage`: passed.
- `npm run build`: passed.
- `npm run test:integration`: **289 tests, 268 passed, 21 failed**; the 21 are all in `tests/integration/backup-restore.test.js`
  (26 of 27 files passed). Run against a throwaway `mysql:8.4.11` container on a private Docker network with no host
  port, from a `node:22-slim` container on that network (`IT_DB_HOST` set to the container name). The integration
  project connects on the mysql2 default port 3306, so a host port would have meant 3306 on the box; the private network avoids that.
  The 21 failures are the backup and restore tests. In that container there is no `mysqldump` at all, so this is an
  environment gap, not evidence about the scripts. The box's own `mysqldump` is MariaDB's, which the brief already names as a
  local failure. Neither run is a clean MySQL 8 dump run, so `backup-restore.test.js` is **not verified** here.

## Could not verify

- Entra, Okta and Authentik: not run live. Entra's refusal is documented from Microsoft's optional-claims reference,
  not from a test tenant.
- The admin console UI (the session ending was through the REST API).
- The OIDC TTL premise for a long TTL (only the default was measured).
- Screenshots were read by eye, not compared with a baseline.
- A full clean-clone re-run on the final commit. The clean clone ran the 0.15.0 base (`9080da4`). The final branch image was
  built and checked for the From default and the IPv6 fallback; the adoption wording is covered by its unit test only.
- `backup-restore.test.js` (21 tests): not verified, see the integration note under Checks run.

## Cleanup

Done after the last run. Compose project `cdxsa6-clean` taken down with its volumes (`down -v --rmi local`), which
removed the MySQL and app containers, the Keycloak container, the named volumes, the network and the built image. The
throwaway integration MySQL container, its anonymous volume and its private network were removed. The Keycloak and
app images built or pulled for this review were removed; the `mysql:8.4.11` and `node:22-slim` base images were
already on the box and are kept. The TLS proxy was stopped by PID. Scratch files under `/tmp` (the clone, the
driver scripts, the throwaway secrets and certificates) were deleted. No Chrome process of this review remains.
`docker ps -a` and `docker network ls` show nothing from this review.
