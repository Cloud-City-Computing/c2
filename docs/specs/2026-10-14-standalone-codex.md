# Standalone track: Cloud Codex as a complete product on its own, toward 1.0

Agreed 2026-10-14. Every `file:line` claim below was re-derived against `origin/main` `d54cb78` (the
0.14.0 release plus the roadmap entry of #105). Every PR in this track re-derives the anchors it
touches at the then-current `main` before editing; anchor on the named function, route, column or
variable, never on the `:line`.

- **Track:** CDX-SA, the standalone track. Sessions CDX-SA-1 to CDX-SA-7, one PR each. This
  document and its plan are CDX-SA-1.
- **Plan:** [`../plans/2026-10-14-standalone-codex.md`](../plans/2026-10-14-standalone-codex.md)
- **Roadmap:** the row "SA" in [`roadmap.md`](roadmap.md), and the "Pre-1.0 standalone review" row,
  which this track's PR 6 carries out.

## Why this spec exists

**Codex becomes a standalone product; the suite integration is removed.** Wave 6 (track W in the
roadmap) added a suite mode, a machine connection to a sibling product, and behaviour shaped around one
identity provider. Each piece was built off by default, so an install that sets none of it behaves as a
standalone product today. But "dormant unless configured" is not the same as "absent": the public image
still ships routes, middleware, environment variables, schema columns and interface code that exist only
for that sibling, and a self-hoster reading the configuration reference meets variables that make no sense
outside it.

This track removes them, keeps everything a self-hoster can use with any OIDC provider or with local
accounts alone, and then takes the product to 1.0 through the pre-1.0 standalone review that roadmap
entry #105 recorded.

## Goals

1. **Codex is a complete product on its own.** Every feature works on a single instance with local
   accounts and no other service except MySQL (and SMTP, which stays optional).
2. **Nothing in the public image assumes a sibling product or a specific identity provider.** No route,
   variable, column, component or comment exists only to serve another product. OIDC works with any
   compliant provider; nothing names or special-cases one.
3. **A path to 1.0.** 0.15.0 ships the removals and the cleanup. 1.0.0 ships after the standalone
   review, with a written promise about configuration, schema, HTTP API and cookie stability.
4. **No self-hoster is surprised.** Every removed variable warns at boot for at least one minor release,
   every schema change is a runner migration with a written undo, and the upgrade notes say exactly what
   stops working and what to do instead.

## Non-goals

- **No new features.** A scoped API token for scripts, an admin control for deactivation, several
  issuers per instance and a multi-workspace switcher are all out of scope. Where removing a suite piece
  leaves a gap a self-hoster might want filled, it is listed under "Deferred" below, never built here.
- **No change to the generic OIDC relying party's behaviour** beyond what the review in PR 6 finds
  wrong. Sign-in, the identity ladder, RP-initiated and back-channel logout, OIDC-only mode and
  invitation binding on a verified email all stay.
- **No change to the design system or the shell layout.** The sidebar shell, the light theme, the
  accent picker and the vendored `cloud-city-design` package stay. Only the suite-mode branches inside
  them go.
- **No rewrite of history.** `docs/research/` folders, the CHANGELOG entries of shipped releases and
  the roadmap's track W record stay as written. They are dated records, not instructions
  (`cloudcodex/tests/docs-first-install.test.js:16-21` already treats them that way).
- **No change to UI-later** (the deferred editor, comments and GitHub surface; roadmap row UI-later).
- **Nothing outside this repository.** The sibling product removes its side of the integration in its
  own repository, on its own schedule; nothing here waits for it.

## Who is affected: could an existing install have used any of this?

Each removed piece was off unless its variables were set, so an install is affected only if it set them:

| Piece | Only installs configured with | Shipped in |
|---|---|---|
| Suite mode (shell cluster, Linked tasks, the front-door and sign-out copy, Workspaces hidden, issuer-managed accounts) | `SUITE_COMMAND_WORKSPACE_URL` (and so `SUITE_NAME`) | 0.14.0 |
| The shared theme cookie | `SUITE_PREFERENCE_DOMAIN`, honoured only with suite mode on | 0.14.0 |
| The issuer's account-page link | `OIDC_ACCOUNT_URL`, shown only for an issuer-managed account in suite mode | 0.14.0 |
| The static machine credential (search, browse, the reconciliation read, the reader check) | `SERVICE_TOKEN` and `SERVICE_TOKEN_USER` | 0.10.0 |
| Machine JWTs | `OIDC_ISSUER_URL`, `MACHINE_OIDC_AUDIENCE` and `MACHINE_OIDC_SUBJECTS` (with `SERVICE_TOKEN_USER`) | 0.14.0 |
| The membership sync | either machine credential above | 0.14.0 |
| The env-declared webhook subscription | `WEBHOOK_URL` and `WEBHOOK_SECRET` (`WEBHOOK_WORKSPACE_ID` optional) | 0.14.0 |
| `GET /api/documents/state` with a human session | nothing: any signed-in user could call it, so a script might | 0.12.0 |

Everything else in this document is either kept, or wording.

## Inventory

**Generic** means a self-hoster can use it with local accounts or any OIDC provider and it stays.
**Suite-only** means it exists only for the sibling product or for one identity provider, and it goes.
**Mixed** means a generic half stays and a suite half goes. The PR column is the plan's PR that does it.

### Suite mode

| # | Item | Files | Class | Decision | PR |
|---|---|---|---|---|---|
| SM1 | Suite mode switch: `SUITE_COMMAND_WORKSPACE_URL`, `SUITE_NAME`, validated at boot | `cloudcodex/services/suite.js:17` `readSuiteConfig`; `cloudcodex/server.js:237-246`; `cloudcodex/env-contract.js:132-136` | suite-only | Remove the service, the boot check and both entries | 2 |
| SM2 | `GET /api/suite` (public) and `GET /api/suite/links` (session) | `cloudcodex/routes/suite.js:20-29`; mounted at `cloudcodex/app.js:39`, `:470` | suite-only | Remove both routes and the mount | 2 |
| SM3 | The suite cluster: the app switcher at the top of the sidebar | `cloudcodex/src/components/SuiteCluster.jsx:35`; `Sidebar.jsx:84-126` (`showCluster`, "This workspace"); `src/index.css` "Suite cluster" section (`.cc-suite*`, from `:549`) and its phone-strip rules (from `:5629`) | suite-only | Remove; the sidebar always shows the product mark and Workspaces | 2 |
| SM4 | "Linked tasks", a link from a document to the sibling product | `src/components/SuiteDocLink.jsx:18`; `src/lib/suite-doc-href.js:27`; `DocumentHeader.jsx:91` (`suiteArchiveId`); `Editor.jsx:1129`; `.suite-doc-link` in `src/index.css` (from `:4708`) | suite-only | Remove | 2 |
| SM5 | Workspaces hidden in suite mode | `src/components/WorkspacesGate.jsx:16`; the Workspaces nav item in `Sidebar.jsx` | suite-only | Remove the gate; Workspaces is always offered | 2 |
| SM6 | The front door's suite branches: the bounce with local login on, the SSO link leading, "You're signed out of <name>." | `src/hooks/useSignedOutTarget.js:54`, `:73`, `:107`, `:183` (`suiteOn`); `src/components/Login.jsx:47-48`, `:238-239` (`oidcLeads`); `src/page_layouts/Std_Layout.jsx:25-36`, `:86-87`, `:274`; `src/lib/sign-out.js:51` | suite-only | Remove the `suiteOn` input and the suite copy; the OIDC-only bounce, the kept target and `?signedOut=1` stay | 2 |
| SM7 | The OIDC button named after the suite | `cloudcodex/routes/oauth.js:187-193` (`oidcButtonName`) | mixed | `OIDC_PROVIDER_NAME`, else `SSO`, stays; the suite branch goes | 2 |
| SM8 | The shared theme cookie: `SUITE_PREFERENCE_DOMAIN` and the parent-domain write | `services/suite.js:56` `readPreferenceDomain`; `src/hooks/useSuite.js:54` `suitePreferenceDomain`; `src/lib/suite-prefs.js:103-160` (`domainInUse`, `knowDomain`, `whenDomainKnown`, the domain branch of `writeChoice` and `expireChoice`) | suite-only | Remove the sharing; every write is host-only | 2 |
| SM9 | The theme and accent preference itself, the pre-paint script and its CSP hash | `src/lib/suite-prefs.js` (read, write, apply, `watch`, `migrateLegacy`); `cloudcodex/index.html:15-58`; `cloudcodex/theme-boot-hash.js`; `app.js:312` | generic | Keep. The storage names `cc_suite_theme` and `cc_suite_accent` stay, so nobody's choice resets; the module is renamed in PR 5 | 2, 5 |
| SM10 | Issuer-managed accounts: read-only name, email, password and 2FA, "Managed by" copy, and the server's `managed_by_issuer` refusals | `services/identity.js:310-330` (`isIssuerManaged`, `isManagedByIssuerHere`); `middleware/auth.js:172-194` (`ISSUER_MANAGED_REFUSAL`, `refuseIssuerManaged`); `routes/auth.js:370-372`, `:510`, `:603-607`, `:1050-1052`, `:1129-1131`, `:1236`, `:1328`, `:1383`, `:1441`, `:1491-1494`; `routes/admin.js:438-440`; `src/components/AccountMenu.jsx:21-28`, `:168-197`, `:378-404`, `:492-497` | suite-only | Remove. They are reachable only with suite mode on, so they leave with it. The `managed_by: 'oidc'` answer (an OIDC session governs sign-in) is generic and stays | 2 |
| SM11 | `OIDC_ACCOUNT_URL`, the issuer's account page linked from SM10 | `services/oidc.js:77-93` `readAccountUrl`, `:146`, `:171`; `routes/oauth.js:212-213` (`accountUrl`); `env-contract.js:103-105` | suite-only | Remove; its only reader is SM10 | 2 |
| SM12 | The Admin console's workspace and squad dialogs | `src/pages/AdminPage.jsx:40-42` | generic | Keep. They render in every mode; only the comment that justifies them by suite mode changes | 2 |
| SM13 | The theme table the colour gates compare against | `cloudcodex/tests/design/suite-theme.json`, `suite-theme.test.js`; comments in `src/codex.css` | generic | Keep; it is Codex's own theme. Renamed in PR 5 | 5 |
| SM14 | The gate that no source spells the suite's name | `cloudcodex/tests/design/suite-name.test.js` | generic | Keep, and widen into the standalone gate (no source names a sibling product, a suite or an identity provider) | 5 |

### The connection to the sibling product

| # | Item | Files | Class | Decision | PR |
|---|---|---|---|---|---|
| SC1 | The static machine credential: `SERVICE_TOKEN`, `SERVICE_TOKEN_USER` | `cloudcodex/services/machine-auth.js:155` `verifyMachineCredential`; `env-contract.js:119-124` | suite-only | Remove (see "Deferred": a scoped API token, if wanted, is a new feature) | 3 |
| SC2 | Machine JWTs: `MACHINE_OIDC_AUDIENCE`, `MACHINE_OIDC_SUBJECTS` | `services/machine-auth.js` (the JWT path, `resetMachineJwtCache` at `:388`); `env-contract.js:125-130` | suite-only | Remove; `services/machine-auth.js` is deleted whole | 3 |
| SC3 | `machineOrAuth` on `GET /api/search` and `GET /api/browse` | `middleware/auth.js:104`; `routes/search.js:106`, `:227` | mixed | Both routes stay, on bare `requireAuth`; the machine half goes | 3 |
| SC4 | `requireMachine` | `middleware/auth.js:142` | suite-only | Remove | 3 |
| SC5 | The reader check, `GET /api/workspaces/:workspaceId/reader-check` | `routes/workspaces.js:160-261`; its `authLimiter` mount at `app.js:395-397` | suite-only | Remove the route and the mount | 3 |
| SC6 | The reconciliation read, `GET /api/documents/state` | `routes/documents.js:640-692`; `stateLimiter` at `app.js:414-422`; `docs/api/documents.md:50` | suite-only | Remove; a script reads a document with `GET /api/document?doc_id=` | 3 |
| SC7 | The membership sync, `PUT /api/machine/members`, `DELETE /api/machine/members` and `DELETE /api/machine/members/:email` | `cloudcodex/routes/machine-members.js`; `app.js:31`, `:424-436` (`machineMembersLimiter`), `:460`; `docs/api/machine-members.md` | suite-only | Remove the router, the limiter and the API page | 3 |
| SC8 | The invitation columns the sync wrote: `user_invitations.grants_admin`, `user_invitations.revoked_at` | `init.sql:216-219`; `migrations/2026-10-15-invitation-grants-admin.sql`, `2026-10-16-invitation-revoked.sql`; `services/identity.js:193`, `:245-247`; `services/release-schema.js:18-19` | suite-only | Drop both columns with a reversible migration (below) | 3 |
| SC9 | The env-declared webhook subscription: `WEBHOOK_URL`, `WEBHOOK_SECRET`, `WEBHOOK_WORKSPACE_ID`, rows with `source = 'env'` | `services/webhooks.js:139-262` (`reconcileEnvSubscription`); `server.js:226`; `services/webhook-worker.js:202`; `routes/webhooks.js:69`, `:102`, `:181`, `:202`, `:230`, `:307`; the managed rows in `src/components/WebhooksPanel.jsx`; `env-contract.js:140-150` | suite-only | Remove; existing `env` rows are deleted by the migration. A self-hoster creates the same subscription in Admin, Webhooks | 3 |
| SC10 | Admin-created webhooks: envelope v1, the SSRF guard, the delivery worker, the console, `WEBHOOK_ALLOW_PRIVATE_TARGETS` | `services/webhooks.js` (`emitEvent`, `loadSubscriptions`), `services/webhook-target.js`, `services/webhook-worker.js`, `routes/webhooks.js`, `WebhooksPanel.jsx`, `docs/api/webhooks.md` | generic | Keep | none |
| SC11 | `users.deactivated_at` and its refusal on every sign-in path | `init.sql:61`; `validateAndAutoLogin` (`cloudcodex/mysql_connect.js`); `services/identity.js` (`account_deactivated`) | generic | Keep. A member the sync removed stays removed; an operator can still set it by hand | none |
| SC12 | `user_identities.email_at_last_signin` | written at `services/identity.js:128`, `:165`, `:272`; read only by `routes/machine-members.js:92` | generic | Keep. The sign-in still records it, and an operator relinking an identity reads it | none |
| SC13 | The contract's `perInstance` field and "a paired product pins a copy of this file" | `env-contract.js:8-18` and every entry | suite-only | Remove the field and the header; the file stays data only | 5 |
| SC14 | The `returnTo` corpus, a copy kept in step with the sibling | `cloudcodex/tests/fixtures/return-to-corpus.json`; `tests/services/return-to.test.js:4-9` | mixed | `services/return-to.js` and every case stay; the corpus becomes this repository's own fixture, no longer synced | 4 |

### Issuer-specific behaviour, and the generic OIDC that stays

| # | Item | Files | Class | Decision | PR |
|---|---|---|---|---|---|
| IS1 | The OIDC relying party: `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_PROVIDER_NAME`, `OIDC_LINK_BY_VERIFIED_EMAIL`, `OIDC_SESSION_TTL_HOURS`; discovery, PKCE, nonce, the signed flow cookie; `user_identities` and the ladder | `services/oidc.js:108` `getOidcConfig`, `:308` `beginLogin`, `:346` `completeLogin`; `routes/oidc.js`; `services/identity.js:72` `resolveIdentity` | generic | Keep | none |
| IS2 | RP-initiated logout with the sealed ID token as `id_token_hint` | `services/id-token-seal.js`; `services/sign-out.js`; `sessions.oidc_id_token` | generic | Keep; PR 4 proves a provider without `end_session_endpoint` degrades to a local sign-out | 4 |
| IS3 | Back-channel logout | `services/backchannel-logout.js`; `POST /api/auth/oidc/backchannel-logout` in `routes/oidc.js` | generic | Keep. It is OIDC Back-Channel Logout 1.0, inert when the provider never calls it | none |
| IS4 | OIDC-only mode (`AUTH_PROVIDERS` without `local`), the provider-aware boot admin, invitation binding on a verified email, the boot purge of non-OIDC sessions | `services/auth-providers.js:76` `localSignInEnabled`; `middleware/auth.js` `requireLocalSignIn`; `services/sessions-oidc-only.js`; `routes/admin.js` `ensureAdminUser` | generic | Keep. "Hosted mode" is renamed "OIDC-only mode" in code, logs and docs; behaviour unchanged | 4 |
| IS5 | Wording that names one provider, or cites research that is not in this repository | `services/machine-auth.js:14` (deleted with SC2); `env-contract.js:126` (deleted with SC2); `services/oidc.js:16-17` (cites a research folder that is not in this repository); `tests/integration/oidc-ladder.test.js`, `tests/routes/oidc-callback.real-issuer.test.js` | mixed | Rationale restated in standard terms (OIDC Core says identity claims come from userinfo). A test may name a provider only where it records that provider's measured behaviour | 4 |
| IS6 | `__Host-sessionToken` on https, `__Secure-` flow cookies, Origin-required cookie writes | `services/session-cookie.js:20-72`; `app.js:346-358` `requireOriginForCookieWrites` | generic | Keep. The rationale is any other host under the same registrable domain, not a sibling product; comments say so | 4 |
| IS7 | `LEGACY_SESSION_COOKIE` and the client's one-time move off `sessionToken` | `services/session-cookie.js:44` `legacyCookieAllowed`; `src/util.jsx:712-807` | generic | Keep through 0.15.0; removed in 1.0.0 if PR 6 confirms its premise (see "What 1.0 promises") | 6, 7 |
| IS8 | The verified-email requirement | `services/oidc.js:394` (`email_verified !== true` refuses) | generic | Keep for now. Some providers (Microsoft Entra ID) send no `email_verified` claim, so PR 6 decides whether the setup docs suffice or a documented setting is needed | 6 |
| IS9 | One issuer per instance | `services/oidc.js:108` `getOidcConfig` | generic | Keep for 1.0, documented as a limit | 4 |
| IS10 | The default From address names the vendor's domain | `env-contract.js:82`; `services/email.js:45` | generic | Reviewed in PR 6: a self-hoster's mail sent as another company's domain fails SPF and DMARC | 6 |
| IS11 | The 24-hour OIDC session with silent renewal | `OIDC_SESSION_TTL_HOURS`; the front door's once-per-tab bounce | generic | Keep | none |

**Counts.** 39 rows: **18 suite-only and removed** (SM1 to SM6, SM8, SM10, SM11, SC1, SC2, SC4 to SC9
and SC13), **17 generic and kept** (SM9, SM12 to SM14, SC10 to SC12, and IS1 to IS4 and IS6 to IS11, of
which IS7, IS8 and IS10 are decided in PR 6), and **4 mixed**, where the generic half stays and the suite
half goes (SM7, SC3, SC14 and IS5).

### The riskiest removals

1. **SC8, the column drop.** The migration runner's `--adopt-fresh-install` proves each post-baseline
   file against the live schema by the tables, columns and keys the file adds
   (`cloudcodex/scripts/migrate.js:386` `schemaClaims`, `:452` `assertSchemaAlreadyHas`). A fresh 0.15.0
   database built by `init.sql` has no `grants_admin`, so adopting `2026-10-15-invitation-grants-admin.sql`
   would be **refused** as "the change is missing", and a drop-only file declares no claim at all, which
   is refused too (`migrate.js:452-462`). The runner must learn drop claims and fold claims in file order
   (a later drop cancels an earlier add) before the drop ships. MySQL DDL is not transactional, so the
   migration is ordered so a failure part way leaves a state the next run can finish.
2. **SC1 to SC4, the machine credential.** `GET /api/search` and `GET /api/browse` move from
   `machineOrAuth` to `requireAuth`, and nothing else may widen or narrow. A script holding
   `SERVICE_TOKEN` starts getting 401 with no other signal, which is why removed variables warn at boot.
3. **SC9, the env subscription rows.** The worker signs an `env` row with `WEBHOOK_SECRET` read at send
   time (`webhook-worker.js:202`). Code that forgets the branch while a row survives would sign with an
   empty secret. The migration deletes the rows, and the worker refuses any row that is not `admin`.
4. **SM10, issuer-managed accounts.** Outside suite mode an account linked to an issuer already keeps
   its local password, reset and 2FA routes, and the removal makes that true everywhere. The model a
   self-hoster gets is stated in `docs/security.md`: **OIDC-only mode makes the issuer the only door;
   with local sign-in on, an account may use every door it has.** An operator who needs the issuer to
   govern every account sets `AUTH_PROVIDERS=oidc`.
5. **SM8, the shared cookie.** An install that set `SUITE_PREFERENCE_DOMAIN` has browsers holding
   `cc_suite_theme` and `cc_suite_accent` on the parent domain. Once writes are host-only, that older
   cookie is listed first and would shadow a changed preference. The write path expires the name on each
   parent domain of the current host (the browser ignores a public suffix), so the shadow clears on the
   first change.
6. **Removed routes in production.** `vite-express` answers an unknown GET with `index.html` and status
   200 (`docs/maps/request-lifecycle.md`, section 2), so in the built image a removed GET route would look
   alive to a client that only checks the status. PR 5 adds a JSON 404 for every unmatched `/api` path.

## Upgrade impact for existing self-hosters

### Environment variables that stop working

None of them is read by 0.15.0 except to warn. Each becomes a `removed` entry in the configuration
contract (`cloudcodex/env-contract.js`), and boot prints one line per removed variable that is still set,
naming it and the replacement, and then starts normally. A removed variable never stops the boot.

| Variable | What it did | What to do |
|---|---|---|
| `SUITE_COMMAND_WORKSPACE_URL`, `SUITE_NAME` | Turned suite mode on and named the suite | Unset them. The sidebar shows the product and Workspaces as on any install |
| `SUITE_PREFERENCE_DOMAIN` | Shared the theme and accent across hosts | Unset it. The preference is per host |
| `OIDC_ACCOUNT_URL` | Linked an issuer-managed account to the issuer's page | Unset it. Accounts are no longer read-only in Codex |
| `SERVICE_TOKEN`, `SERVICE_TOKEN_USER` | A machine credential for search, browse and two machine routes | Unset them. A script signs in as a user and sends that session. `SERVICE_TOKEN_USER`'s account stays an ordinary user; delete or keep it |
| `MACHINE_OIDC_AUDIENCE`, `MACHINE_OIDC_SUBJECTS` | Machine JWTs from the OIDC issuer | Unset them. The OIDC sign-in for people is unaffected |
| `WEBHOOK_URL`, `WEBHOOK_SECRET`, `WEBHOOK_WORKSPACE_ID` | One subscription declared in the environment | Create it in Admin, Webhooks (same URL, the same workspace filter), give the receiver the new secret the console shows once, then unset them. The migration deletes the old row and its queued deliveries |

Removed routes: `GET /api/suite`, `GET /api/suite/links`, `GET /api/workspaces/:workspaceId/reader-check`,
`GET /api/documents/state`, `PUT /api/machine/members`, `DELETE /api/machine/members` and
`DELETE /api/machine/members/:email`. All seven answer 404.

### Data migrations

One migration, in PR 3, named with a date later than the newest file on `main` when that session starts
(today the newest is `2026-10-16-invitation-revoked.sql`, so it is `2026-10-17-` or later):
`migrations/<date>-remove-sibling-connection.sql`. In order:

1. Expire every revoked open invitation, so dropping `revoked_at` can never reopen one:
   `UPDATE user_invitations SET expires_at = LEAST(expires_at, NOW()) WHERE revoked_at IS NOT NULL AND accepted = FALSE;`
   (the removal already expired them; this makes the guarantee the migration's own).
2. Delete the env-declared subscriptions: `DELETE FROM webhook_subscriptions WHERE source = 'env';`
   Their deliveries go with them (`ON DELETE CASCADE`, `init.sql`, `webhook_deliveries`); their events
   are pruned by the worker's 30-day prune as before.
3. `ALTER TABLE user_invitations DROP COLUMN grants_admin, DROP COLUMN revoked_at;`

**Undo**, written in the file's header and in `tests/integration/pre-runner-state.js`:

```sql
ALTER TABLE user_invitations
  ADD COLUMN grants_admin BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN revoked_at TIMESTAMP NULL DEFAULT NULL;
```

The values are not restored: they meant something only to the removed sync. A downgraded 0.14.0 recreates
its env subscription at boot from `WEBHOOK_URL` if it is still set (`reconcileEnvSubscription`), so the
rows need no undo of their own.

**Order of upgrade.** 0.15.0 never reads either column, so the image may start before or after the
migration, and the migration may run before or after the new image starts. 0.14.0 refuses to start
without the columns (`services/release-schema.js:18-19`), so a rollback to 0.14.0 runs the undo first;
the upgrade notes say so.

**Not migrated, deliberately.**

- `webhook_subscriptions.source` and its two CHECK constraints stay. After step 2 every row is
  `admin`, the constraints still hold, and the runner's adoption check cannot verify a dropped CHECK, so
  the table is left alone until a later change has a reason to touch it.
- `users.deactivated_at` stays (SC11). Members the sync removed stay removed.
- Open invitations the sync created stay open until they expire (a year from their last refresh). After
  the drop they admit a plain member, never an admin. An admin who does not want them revokes them in
  Admin, Invitations; the upgrade notes give the query that finds them (`invited_by` is the former
  `SERVICE_TOKEN_USER`).

No table is dropped: every suite table was shared with a generic feature.

### Behaviour a self-hoster can see

- Installs that never set a removed variable see no difference, apart from a JSON 404 where an unknown
  `/api` path used to get `index.html`.
- An install that ran suite mode loses the cluster, Linked tasks, the suite copy and the hidden
  Workspaces page, and its OIDC-linked accounts become editable in Codex (SM10). Running OIDC-only keeps
  the issuer as the only door.

## Security posture after removal

The attack surface shrinks. What goes:

- **Seven routes**, two of them machine-only oracles or writers: the reader check (an answer about a
  third party's membership), and the membership sync, the only machine path that wrote and the only one
  that could grant `is_admin` to any address.
- **Two authentication paths that ran on unauthenticated input.** `machineOrAuth` digest-compared
  every bearer token sent to search and browse, and a JWS-shaped token made the server fetch the
  issuer's key set (`services/machine-auth.js`); both go, with `jose`'s use there.
- **A principal that was not a person** (`SERVICE_TOKEN_USER`, `is_admin` forced false), and the
  never-admin guard that existed only for it.
- **Two rate-limit buckets and one shared use of `authLimiter`** (`stateLimiter`,
  `machineMembersLimiter`, the reader check's mount).
- **A secret read from the environment at send time** and the retarget logic around it
  (`reconcileEnvSubscription`).
- **A parent-domain, script-readable cookie** any host under the domain could set (only a theme value,
  but a cross-host write path all the same), and the public `GET /api/suite` that disclosed the
  configuration.
- **Ten branches in the password, reset and 2FA routes** (SM10) that refused by a second rule beside
  `requireLocalSignIn`.
- **Two boot-time validators** of URLs and domains (`readSuiteConfig`, `readPreferenceDomain`) and one
  of `OIDC_ACCOUNT_URL`.

What stays, and is unchanged: the OIDC relying party with PKCE, nonce and the signed flow cookie; the
`(issuer, subject)` ladder that never creates an account from an email alone; RP-initiated and back-channel
logout; OIDC-only mode; the `__Host-` session cookie and Origin-required cookie writes; the webhook SSRF
guard; `jose` (still used to verify back-channel logout tokens) and `openid-client`.

`docs/security.md` loses its machine-credential section and its rate-limit rows for the removed buckets,
and gains the two-door model in risk 4 above.

## The pre-1.0 standalone review (PR 6)

Roadmap entry #105 recorded the review and its four caveats. After PRs 2 to 5 the review checks:

1. **Suite mode is gone from the public image**, not dormant: the standalone gate (PR 5) is green, and a
   search of the built image (`dist/` and the server source inside the container) finds no suite route,
   variable, component or class.
2. **The 1.0 stability promise** (below) is written, and the breaking changes since 0.13.0 are each in
   the upgrade notes: 0.13.0's `__Host-` cookie with `LEGACY_SESSION_COOKIE` and Origin-required cookie
   writes, 0.14.0's sidebar shell and removed density preference, and every removal of this track. The legacy
   cookie decision is made by checking its premise (below).
3. **Provider-neutral wording**: no source or doc outside dated records names one identity provider,
   except the setup docs that name several, and tests that record a provider's measured behaviour.
4. **The plug point**: one issuer per instance (kept, documented); setup docs for Keycloak, Authentik,
   Okta and Microsoft Entra ID (written in PR 4) that are correct for each provider's current admin
   console; `OIDC_PROVIDER_NAME` (kept); `OIDC_ACCOUNT_URL` and issuer-managed accounts (removed in
   PR 2, so the caveat closes by removal); machine-credential docs (removed in PR 3, so the same). The
   verified-email requirement (IS8) and the default From address (IS10) are decided here.
5. **A clean-clone standalone boot**, recorded in `docs/research/standalone-review-<date>/` with the
   commands and their output: `git clone` into an empty directory, the documented first install from
   `docs/deployment.md` with the image built from the branch, and then:
   - local accounts only: the boot admin signs in, invites a user by a copyable link with no SMTP, and
     that user signs in;
   - a non-default OIDC provider in a container, Keycloak by default (Authentik if Keycloak cannot be
     run): an invited email signs in and lands in its squad, an uninvited verified email is refused
     `no_account`, RP-initiated sign-out ends the provider's session, an administrator ending the session
     at the provider ends it in Codex through back-channel logout, and `AUTH_PROVIDERS=oidc` makes the
     provider the only door;
   - every removed route answers 404 on the running image, and a removed variable set in `.env` prints
     its warning and does not stop the boot.

Done means every check is green or its finding is fixed in PR 6, and the outcome is written into the
roadmap's pre-1.0 row.

## What 1.0 promises

Proposed here and confirmed by Kyle when PR 7 merges.

- **Configuration.** Every variable in `cloudcodex/env-contract.js` keeps its name and meaning across
  1.x. A variable is removed only in a major release, after at least one minor release in which it is a
  `removed` entry that warns at boot. A new variable is optional or has a default, so a 1.x upgrade never
  requires one.
- **Schema.** Every schema change is a runner migration with its undo written in the file, and a
  migration that deletes data says so in the upgrade notes of its release. `init.sql` stays in step with
  the migrations.
- **HTTP API.** The routes in `docs/api/*.md` keep their shape across 1.x; changes are additive. The
  webhook envelope `codex.event.v1` is stable.
- **Cookies.** The session cookie is `__Host-sessionToken` on https and `sessionToken` on plain http.
- **The legacy session cookie switch is removed in 1.0.0.** `LEGACY_SESSION_COOKIE` exists so a
  browser holding only the `sessionToken` written before 0.13.0 on https keeps its session; the client moves such
  a session to the new name on its first https page load once the server confirms it
  (`src/util.jsx`, the legacy move). By 1.0.0 every such session has either moved or expired: a session
  that is used is moved on that use, and one that is not used expires (a local or Google session row is
  written with seven days, `cloudcodex/mysql_connect.js:229-238`, and an OIDC one with at most
  `OIDC_SESSION_TTL_HOURS`). PR 6 checks that premise on the running image. If it holds, PR 7 removes
  the variable (as a `removed` entry that warns) and the https legacy read, and a browser not seen since
  before 0.13.0 signs in again. If it does not hold, 1.0.0 keeps the switch with its default turned to
  `0`, and says so.
- **Upgrade notes.** Every release's CHANGELOG entry has an upgrade section. 1.0.0's states the path from
  0.13.x, 0.14.x and 0.15.x.
- **Not promised:** the UI layout, CSS class names, internal modules and their exports, the vendored
  design package's internals, and the test layout.

## Release plan

- **0.15.0** after PRs 2 to 5: the removals, the one migration, the cleanup and the hardening. Its
  CHANGELOG entry carries the upgrade notes above. It is prepared as the last task of PR 5 on its own
  branch, `release/0.15.0`, with only the changelog heading and the version fields `release.yml` checks
  (`cloudcodex/package.json`, its lock file, and the default in `docker-compose-release.yml`). The tag is
  cut through `release.yml` when Kyle authorizes it.
- **1.0.0** after PR 6: the review's fixes, the legacy cookie decision and the stability promise. PR 7
  prepares it the same way on `release/1.0.0`, and retires this spec and its plan.

## Ordering constraint

```
PR 1 (this spec and plan)
  └─► PR 2 (suite mode) ─► PR 3 (sibling connection, the migration) ─► PR 4 (issuer-specific)
                                                                          └─► PR 5 (cleanup, 0.15.0)
                                                                                └─► PR 6 (review) ─► PR 7 (1.0.0)
```

- PR 2 comes first because suite mode gates SM10 and SM11, and because removing it first makes every later
  diff smaller.
- PR 3 owns the only migration and the runner change it needs; nothing else in the track changes schema.
- PR 4 could run beside PR 3 (they touch different files except `env-contract.js` and the docs), but runs
  after it so each re-derives the other's anchors once.
- PR 5 lands the standalone gate only after PRs 2 to 4, because the gate would be red until they have
  merged.
- One PR per session. Every removal lands with its proving test written first.

## Deferred, and why

- **A scoped API token for scripts.** `SERVICE_TOKEN` was the nearest thing, but it was one credential
  per install acting as one user, built for a sibling product. A real API token (per user, revocable,
  scoped) is a feature to design on its own, after 1.0 if asked for.
- **An admin control for deactivation.** `users.deactivated_at` is set by hand until then (SC11).
- **Several issuers per instance.** One issuer per instance is a documented limit for 1.0 (IS9).
- **Re-gating the issuer-managed rule on a setting** (SM10). Considered and not done: OIDC-only mode
  already gives the strong guarantee, and an optional setting can be added in a minor release without
  breaking anyone.
- **Renaming the preference storage keys.** A rename would reset every user's theme and accent for no
  behavioural gain.
- **Tightening `webhook_subscriptions.source`** to `admin` only (see "Not migrated").

## Open questions for Kyle

Each has a recommendation, and the track proceeds on it unless Kyle answers otherwise at the PR 1 review:

1. **Remove the static `SERVICE_TOKEN` with no replacement** (SC1). Recommended: yes, and design a scoped
   API token later only if a self-hoster asks.
2. **Remove the env-declared webhook subscription** (SC9) rather than keep it as a generic
   config-as-code feature. Recommended: yes; the admin console covers it, and one fewer secret lives in
   the environment.
3. **Remove `LEGACY_SESSION_COOKIE` at 1.0.0**, subject to PR 6's check. Recommended: yes.
4. **Remove the issuer-managed account rule rather than re-gate it** (SM10). Recommended: remove, with
   the two-door model documented.

## Retirement

PR 7 updates the maps, deletes this spec and its plan, marks the SA row in [`roadmap.md`](roadmap.md)
shipped with its PR numbers, and removes the rows from `docs/specs/README.md` and `docs/README.md`. The maps become the record.
