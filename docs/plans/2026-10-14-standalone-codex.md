# Plan: standalone track

Implements [`../specs/2026-10-14-standalone-codex.md`](../specs/2026-10-14-standalone-codex.md).

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` to
> implement this plan task by task, one fresh subagent per task, with review between tasks. This is
> the standing convention for a written plan in this repo (`docs/plans/README.md`), not a choice to
> re-present. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Codex becomes a standalone product; the suite integration is removed. Every route, variable,
column, component and comment that exists only for the sibling product or for one identity provider goes;
local accounts, generic OIDC with any provider and admin-created webhooks stay. 0.15.0 ships the removals,
and 1.0.0 ships after the pre-1.0 standalone review.

**Architecture:** removal in three passes, ordered by what gates what. Suite mode first (PR 2), because
`readSuiteConfig` gates the shell cluster, the front door's suite branches, the shared theme cookie and the
issuer-managed accounts. The machine connection second (PR 3), with the track's only migration and the
runner change it needs. Issuer-specific wording and the provider-neutral proof third (PR 4). Then a cleanup
and hardening pass with the standalone gate and the 0.15.0 release (PR 5), the review against a real
non-default provider (PR 6), and 1.0.0 (PR 7). Every removed variable becomes a `removed` contract entry
that warns at boot, so nothing fails silently.

**Tech stack:** Node 22, Express 5, MySQL 8.4 (`mysql2/promise`), `openid-client` 6, `jose` 6 (kept for
back-channel logout tokens), Vitest 4 + Supertest, Docker Compose, Keycloak in a container for PR 6.

**Order:** one PR per session, merged in this order. Session IDs are `CDX-SA-n` for PR n.

| PR | Session | Branch |
|---|---|---|
| 1 | CDX-SA-1, this spec and plan (docs only) | `track/cdx-sa-1-standalone-spec` |
| 2 | CDX-SA-2, remove suite mode | `track/cdx-sa-2-remove-suite-mode` |
| 3 | CDX-SA-3, remove the sibling-product connection | `track/cdx-sa-3-remove-sibling-connection` |
| 4 | CDX-SA-4, remove issuer-specific behaviour, keep generic OIDC | `track/cdx-sa-4-provider-neutral` |
| 5 | CDX-SA-5, clean up and harden, then the 0.15.0 release PR | `track/cdx-sa-5-cleanup`, then `release/0.15.0` |
| 6 | CDX-SA-6, the pre-1.0 standalone review, findings fixed | `track/cdx-sa-6-standalone-review` |
| 7 | CDX-SA-7, the 1.0.0 release | `release/1.0.0` |

**Baseline**, measured 2026-10-14 in a worktree of `origin/main` `d54cb78` after `npm ci`, on Node
22.22.2: `npm test` reports `Test Files  213 passed (213)` and `Tests  4786 passed (4786)`.

`npm test | tail` reports `tail`'s exit code, not Vitest's. Read the summary line.

## Before every PR

- [ ] `git fetch origin && git switch -c <branch> origin/main` from the repository root.
- [ ] Re-derive every anchor this PR's section and the spec's inventory rows name. Anchor on the **named
      function, route, column or variable** and find its line with `grep -n`; the `:line` numbers here
      and in the spec are from `d54cb78` and will have moved.
- [ ] Re-run the inventory grep for this PR's area and compare with the spec's rows. A suite-only item
      the spec missed is added to the spec's table in this PR and removed here if it fits; a generic
      item the spec marked suite-only is kept, and the spec row is corrected. Either way the PR body says
      so.
- [ ] `cd cloudcodex && npm ci && npm test`, and record the counts in the PR body.
- [ ] Before `gh pr create`: an adversarial review of the diff (the `momus` reviewer), given the riskiest
      file and the claims to disprove. Watch CI to green; never report done on a pending or red run.

## Global constraints

Every task's requirements implicitly include this section.

- **Run `npm` from `cloudcodex/`.** `make` and `docker compose` run from the repository root.
- **Tests first for every removal.** A removal's proving test (the route is 404, the variable is a
  `removed` entry, the boot warns and listens, the suite-off path is unchanged) is written and run red
  before the code goes. A test that tested removed behaviour is deleted in the same commit as the code
  it tested, never before, so the suite never passes with the behaviour present and untested.
- **The suite-off path is the contract.** Every existing test that exercises behaviour with suite mode
  off, no machine credential and no env subscription passes **unmodified**, apart from the deletions
  each PR names. A test edited to pass is a behaviour change and needs a line in the PR body.
- **Every new source file opens with the project header** (one-line description, then
  `All Rights Reserved to Cloud City Computing, LLC 2026` and `https://cloudcitycomputing.com`).
- **`no-console` allows only `console.error`**, in the format
  `` `[${new Date().toISOString()}] ...` ``.
- **`no-implicit-coercion`**: `Boolean(x)` and `Number(x)`, never `!!x` or `+x`.
- **All SQL is parameterized** through `c2_query(sql, params)`.
- **Backend tests queue `c2_query` mocks in the exact order the handler issues queries.** Removing a
  query from a handler shifts every later mock; fix the queue, never the assertion.
- **Schema changes are a dated `migrations/YYYY-MM-DD-<topic>.sql` and an `init.sql` edit**, with the
  undo in the file's header and in `tests/integration/pre-runner-state.js`. Never append to
  `LEGACY_BASELINE`. Date the file at session start, later than the newest file on `main`.
- **Coverage is per-glob** (`cloudcodex/vitest.config.js`). A deleted file's threshold entry is deleted
  with it; a touched file's threshold is never lowered to make room.
- **The design ledger only shrinks** (`tests/design/ledger.json`). Removing CSS lowers it by exactly
  the findings that CSS carried.
- **Every variable removed from the code becomes a `removed` entry** in `cloudcodex/env-contract.js`
  (Task 2.1) in the PR that stops reading it: out of `.env.example`, out of the Environment Variables
  table in `docs/getting-started.md`, into that page's Removed variables table, and warned at boot.
- **Maps, `docs/*.md` and the root `CLAUDE.md` move in the same PR** as the code they describe. Dated
  records (`docs/research/`, shipped CHANGELOG entries, the roadmap's track W) are never edited.
- **Each PR adds its entries to the CHANGELOG under `[Unreleased]`**, in a `### Removed` section with
  what to do for each removed variable or route.
- **Public repository.** Describe the change as "Codex becomes a standalone product; the suite
  integration is removed". Never name another product's private repository, session IDs, hosts or
  plans in code, tests or docs written by this track.
- **No em dash characters** in code comments, commit messages or docs.

---

## PR 1: CDX-SA-1, this spec and plan

Docs only.

- [x] `docs/specs/2026-10-14-standalone-codex.md` and this plan.
- [x] `docs/specs/roadmap.md`: the SA row and section; the "Pre-1.0 standalone review" row marked as
      tracked by PR 6.
- [x] The indexes: `docs/specs/README.md` and `docs/README.md` (`docs/plans/README.md` lists no plans).

**Acceptance:** `npm test` green and unchanged (213 files, 4786 tests at `d54cb78`), because nothing under
`cloudcodex/` moved; `tests/docs-first-install.test.js` skips `docs/specs/` and `docs/plans/` by design.

---

## PR 2: CDX-SA-2, remove suite mode

Spec rows SM1 to SM12. After this PR nothing reads `SUITE_COMMAND_WORKSPACE_URL`, `SUITE_NAME`,
`SUITE_PREFERENCE_DOMAIN` or `OIDC_ACCOUNT_URL` except the boot warning.

**Corrections, recorded by CDX-SA-2 where the code proved this section wrong** (each is also noted at its task):

- Task 2.2 deletes `services/suite.js` with the suite routes. Its readers are `middleware/auth.js` and
  `services/identity.js`, which Task 2.3 removes, so the file is deleted in Task 2.3 with its last importer.
  Its test and its coverage threshold go in the same commit.
- Task 2.3 says the admin two-factor reset is "404 on an OIDC-only instance, as `requireLocalSignIn` already makes
  them". It is not: `POST /api/admin/users/:id/2fa/reset` is an admin route with no `requireLocalSignIn`, so it
  answers as before on an OIDC-only instance. The integration test pins that, and the question of whether an admin
  reset should be refused there is left for Kyle.
- Task 2.5 says `useSuite.js` goes once Task 2.5 removes its last importer. `services/suite.js` is not the only
  reader of the preference domain: `src/lib/suite-prefs.js` read `suitePreferenceDomain`, so `useSuite.js` goes in
  Task 2.6.
- Task 2.6 says no cookie string written carries `Domain=`. A parent-domain expiry has to carry `Domain=` to reach the
  parent at all. The value-bearing write never does, and the expiry writes carry `Max-Age=0` only.
- Task 2.7 names `docs/maps/suite-ui-alignment-record.md` as retired. The code pointed at it from three places
  (`src/tokens/accents.js`, `tests/design/suite-theme.json` `_rule`, the header of `tests/src/lib/suite-prefs.test.js`);
  each now points at its own source, and the record's open items are carried into `docs/maps/open-questions.md`
  section H.
- Task 2.7 says the design blocks and thresholds move with the code. `tests/design/geometry-fingerprint.json` is re-taken
  for the removed `.suite-doc-link` rule (its two non-colour declarations); its `_taken` note says so, and the
  deferred-dark ledger loses the two entries for that rule.

### Task 2.1 The contract learns `removed`, and boot warns (tests first)

The mechanism every later removal uses. `cloudcodex/env-contract.js` gains a fifth kind:

```javascript
// kind 'removed': no longer read for any behaviour. Boot prints one line naming the variable and
// `why` (what to do instead) when it is set, then starts. Absent from .env.example; listed in
// docs/getting-started.md under "Removed variables". Kept for at least one minor release.
{ name: 'SUITE_COMMAND_WORKSPACE_URL', kind: 'removed', perInstance: false,
  why: 'suite mode was removed in 0.15.0; unset it' },
```

`perInstance` stays on every entry until PR 5 removes the field.

- [ ] `tests/env-contract.test.js`: add `'removed'` to `KINDS`; a removed entry must be absent from
      `.env.example`, absent from the Environment Variables table, and present in a "Removed variables"
      table in `docs/getting-started.md` whose row repeats its `why`. Add a frozen list
      `REMOVED_IN_0_15` (grown by each PR of this track) and assert every name on it is `kind: 'removed'`,
      so a removed variable cannot quietly come back as `optional`. Run: red (no kind, no table).
- [ ] `tests/server.test.js`: with `SUITE_COMMAND_WORKSPACE_URL=https://example.test/w/1` and
      `SUITE_NAME=Example` set, the server logs exactly one line per variable naming it and the word
      `removed`, and still reaches its listen line (the existing boot harness in that file). With
      neither set, no such line. Run: red.
- [ ] `cloudcodex/services/removed-env.js` (new): `warnRemovedVariables()` reads each removed name by
      literal `process.env.NAME` (the contract scan forbids computed keys) and logs
      `` `[${ts}] ${name} is set but was removed: ${why}` `` for each one set and non-blank. Called once
      in `server.js` beside the other boot checks, before listen; never exits.
- [ ] Run both tests: green.

### Task 2.2 The server: suite mode and its routes go (tests first)

- [ ] `tests/app.test.js`, a new `describe('suite mode is removed')`: `GET /api/suite` is 404;
      `GET /api/suite/links` with a mocked session is 404; with `SUITE_COMMAND_WORKSPACE_URL` set the
      answers are the same. Run: red.
- [ ] `tests/routes/oauth*.test.js`: with `SUITE_COMMAND_WORKSPACE_URL` and `SUITE_NAME` set and
      `OIDC_PROVIDER_NAME` unset, `GET /api/oauth/providers` names the button `SSO`; the response's
      `oidc` object has no `accountUrl` key. Run: red.
- [ ] Delete `cloudcodex/services/suite.js`, `cloudcodex/routes/suite.js`, the mount and import in
      `app.js`, the "Validate suite mode" block in `server.js`, and `oidcButtonName`'s suite branch in
      `routes/oauth.js`.
- [ ] Delete `tests/routes/suite.test.js`, `tests/services/suite.test.js`, and the
      `routes/suite.js` and `services/suite.js` entries in `vitest.config.js`'s thresholds.
- [ ] Contract: `SUITE_COMMAND_WORKSPACE_URL`, `SUITE_NAME`, `SUITE_PREFERENCE_DOMAIN` become
      `removed` (Task 2.1's shape), and join `REMOVED_IN_0_15`.

### Task 2.3 Issuer-managed accounts and `OIDC_ACCOUNT_URL` go (tests first)

They are reachable only with suite mode on (spec SM10, SM11), so they leave with it.

- [ ] Replace `tests/integration/suite-issuer-local-sign-in.test.js` with
      `tests/integration/linked-account-doors.test.js`, which states the two-door model on live MySQL:
      on an instance with local sign-in on, an account with a `user_identities` row can request a reset
      (mail sent), reset its password, sign in with it, and have its 2FA reset by an admin; on an
      OIDC-only instance (`AUTH_PROVIDERS=oidc`) each of those routes is 404, as `requireLocalSignIn`
      already makes them. Run: the first half is red today only with suite mode on, so run it with
      `SUITE_COMMAND_WORKSPACE_URL` set to prove the refusal still exists before the removal.
- [ ] `tests/routes/auth.test.js` and `auth-update-account.test.js`: delete the `managed_by_issuer`
      cases; add one case that `GET /api/2fa/status` (the route behind `managed_by`) never answers
      `'issuer'`, and still answers `'oidc'` for an OIDC session.
- [ ] Remove `isIssuerManaged`, `isManagedByIssuerHere` (`services/identity.js`),
      `ISSUER_MANAGED_REFUSAL` and `refuseIssuerManaged` (`middleware/auth.js`) and every call in
      `routes/auth.js` and `routes/admin.js`. Keep the handlers' other checks in their order (the mock
      queues depend on it).
- [ ] Remove `readAccountUrl` and `accountUrl` from `services/oidc.js` and `routes/oauth.js`.
      `OIDC_ACCOUNT_URL` becomes `removed`.
- [ ] `src/components/AccountMenu.jsx`: the `issuer` state, `ManagedBy` with its account link, and the
      `managedBy === 'issuer'` branch go; the `'oidc'` branch stays. Delete
      `tests/src/components/AccountMenu-issuer.test.jsx`; any other AccountMenu test passes unmodified.

### Task 2.4 The client: the shell, Linked tasks and Workspaces (tests first)

- [ ] `tests/src/components/Sidebar*.test.jsx`: `Sidebar` renders the product mark and a Workspaces
      nav item with no `suite` prop, and never renders `.cc-suite`. `/workspaces` renders the Workspaces
      page (replace `tests/src/app-workspaces-gate.test.jsx` with that one assertion). Run: red where
      the props change.
- [ ] Delete `src/components/SuiteCluster.jsx`, `src/components/SuiteDocLink.jsx`,
      `src/lib/suite-doc-href.js`, `src/components/WorkspacesGate.jsx` (and its wrap in the router),
      and `src/hooks/useSuite.js` once Task 2.5 has removed its last importer. `DocumentHeader` loses
      `suiteArchiveId`; `Editor.jsx` stops passing it.
- [ ] `src/index.css`: delete the "Suite cluster" section, its phone-strip rules (`.cc-suite` in the
      phones block) and the `.suite-doc-link` rule. Re-run `npm run test:design`; lower
      `tests/design/ledger.json` by exactly the findings that left, and delete the suite blocks of
      `tests/design/z-index.test.js` and `tests/design/painted.test.js`.
- [ ] Delete `tests/src/components/SuiteCluster.test.jsx`, `SuiteDocLink.test.jsx`,
      `tests/src/hooks/useSuite.test.jsx`; edit the suite cases out of `phone-strip.test.jsx`,
      `Shell.test.jsx`, `WorkspacesPage.header.test.jsx`, `Sidebar.cache.test.jsx`.
- [ ] `src/pages/AdminPage.jsx`: reword the comment above the Workspaces dialogs (they render in every
      mode). Rename `tests/src/pages/AdminPage.suiteWorkspace.test.jsx` to
      `AdminPage.workspaceDialogs.test.jsx`, assertions unchanged.

### Task 2.5 The front door's suite branches (tests first)

- [ ] `tests/src/hooks/useSignedOutTarget.test.jsx`: delete every case that passes `suiteOn: true`;
      every other case passes unmodified once the parameter is gone. `decideSignedOut` with OIDC beside
      local login answers `login` (the modal), with OIDC only answers the bounce.
- [ ] `tests/src/components/Login-front-door.test.jsx`: delete the suite cases; the snapshot
      `__snapshots__/Login-front-door.test.jsx.snap` (the suite-off markup) must not change, which is
      the proof that a standalone install's sign-in modal is untouched.
- [ ] `tests/src/page_layouts/Std_Layout*.test.jsx`: `?signedOut=1` shows no "signed out of" sentence;
      delete the suite cases.
- [ ] Remove `suiteOn` from `useSignedOutTarget.js` (`decideSignedOut`, `startOidcBounce`,
      `resolveSignedOut`, the hook), `oidcLeads` and `useSuite` from `Login.jsx`, `NoLoginMessage`'s
      sentence and `useSuite` from `Std_Layout.jsx`, the suite comment in `src/lib/sign-out.js`.

### Task 2.6 The theme preference becomes host-only (tests first)

The preference itself, the pre-paint script and its hash stay byte-identical (spec SM9).

- [ ] `tests/src/lib/suite-prefs.test.js`: delete the preference-domain cases and
      `tests/src/lib/suite-domain.test.js`; add: every write is host-only (no `Domain=` attribute in any
      cookie string written) and needs no request first; a write also expires the name on each parent
      domain of `location.hostname` (`a.b.example.test` expires on `b.example.test` and
      `example.test`), so an older shared cookie cannot shadow the new choice; on `localhost` nothing
      extra is written. Run: red.
- [ ] `src/lib/suite-prefs.js`: remove `domainInUse`, `knowDomain`, `whenDomainKnown` and the domain
      branches; writes happen at once. Keep `THEME_NAME`, `ACCENT_NAME`, the read precedence, `watch`
      and `migrateLegacy`.
- [ ] `tests/src/theme-boot.test.js` and `tests/theme-boot-hash.test.js` pass unmodified, and
      `index.html` and `theme-boot-hash.js` are not in the diff.

### Task 2.7 Docs, maps, verification

- [ ] Docs: `docs/getting-started.md` (the Removed variables table, rows out of the Environment table),
      `.env.example` (at the repository root), `docs/features.md`, `docs/frontend.md`,
      `docs/api/auth.md` and `docs/api/oauth-github.md` where they describe suite mode, `managed_by`
      or `accountUrl`; CLAUDE.md where it mentions suite mode; CHANGELOG `[Unreleased]`.
- [ ] Maps: `frontend-architecture.md` (delete 3b; 3c loses its suite paragraphs; section 5 says the
      preference is host-only), `request-lifecycle.md` (boot order, the `GET /api/suite` mount, the
      account refusals in section 3), `build-test-and-ops.md` (the design blocks, thresholds),
      `open-questions.md` (section G, the suite front door, is closed by removal),
      `docs/maps/README.md`. **Retire `suite-ui-alignment-record.md`**: move anything still live and
      generic (the gamut open item, any decision pending Kyle that concerns Codex's own interface) into
      `open-questions.md` or `frontend-architecture.md`, then delete the record and its row.
- [ ] `rg -n 'SUITE_|readSuiteConfig|useSuite|cc-suite|suite-doc|isManagedByIssuerHere|OIDC_ACCOUNT_URL' cloudcodex --glob '!node_modules' --glob '!dist'`
      prints only the `removed` contract entries, `services/removed-env.js`, and their tests.
- [ ] By hand: `npm run dev` with the suite variables set: the warning lines print, the sidebar shows
      the product mark and Workspaces, a document has no Linked tasks link, the Account page's name and
      email are editable for an OIDC-linked account. Screenshot desktop and phone widths into the PR.
- [ ] Lint, test, coverage, build, design, integration.

**Files touched (expected):** `cloudcodex/{app.js,server.js,env-contract.js}`, `services/{suite.js
(deleted),removed-env.js (new),identity.js,oidc.js}`, `routes/{suite.js (deleted),oauth.js,auth.js,
admin.js}`, `middleware/auth.js`, `src/components/{SuiteCluster,SuiteDocLink,WorkspacesGate (deleted),
Sidebar,DocumentHeader,Login,AccountMenu}.jsx`, `src/hooks/{useSuite.js (deleted),useSignedOutTarget.js}`,
`src/lib/{suite-doc-href.js (deleted),suite-prefs.js,sign-out.js}`, `src/page_layouts/Std_Layout.jsx`,
`src/pages/{AdminPage,Editor}.jsx`, `src/index.css`, `vitest.config.js`, tests as listed, docs and maps.

**Migrations:** none.

**Acceptance:** an install with the suite variables set boots, warns once per variable, and behaves as an
install without them; the seven suite-off test families named above pass unmodified; the Login snapshot,
the pre-paint script and its hash are unchanged; the design ledger is lower or equal; CI green.

---

## PR 3: CDX-SA-3, remove the sibling-product connection

Spec rows SC1 to SC9 and SC3's machine half. The track's only migration.

### Task 3.1 The runner learns drop claims and folds claims in file order (tests first)

The trap (spec, riskiest removal 1): `--adopt-fresh-install` checks each post-baseline file's ADD claims
against the live schema (`scripts/migrate.js`, `schemaClaims`, `assertSchemaAlreadyHas`). On a fresh
0.15.0 database the columns this PR drops are absent, so adopting the two files that added them would be
refused, and a file whose only change is a drop declares no claim and is refused outright.

- [ ] `tests/scripts/migrate.test.js`:
  - `schemaClaims('ALTER TABLE t DROP COLUMN c')` returns `[{ kind: 'dropped-column', table: 't', column: 'c' }]`,
    and `ALTER TABLE t DROP COLUMN a, DROP COLUMN b` returns two; `DROP CHECK`, `DROP INDEX` and
    `DROP FOREIGN KEY` return nothing new.
  - a new `netClaims(files)` folds claims in filename order: an add of `t.c` followed by a later drop of
    `t.c` leaves `t.c` expected **absent**; a drop with no earlier add is expected absent; an add with no
    later drop is expected present.
  - `assertSchemaAlreadyHas` takes the net expectation for each file: a file whose added column a later
    file drops is adopted when the column is absent, and refused when it is present (the later drop never
    ran, so this is not a fresh 0.15.0 build). A drop-only file is adopted when the column is absent.
  Run: red.
- [ ] `tests/integration/migrate.test.js`: on a schema `init.sql` builds after this PR, `--adopt-fresh-install`
      records every file including `2026-10-15-invitation-grants-admin.sql`, `2026-10-16-invitation-revoked.sql`
      and the new one, and a second run is a no-op. On a schema that still has `grants_admin`, the same
      command refuses and names the new file. Run: red.
- [ ] Implement in `scripts/migrate.js`: the `dropped-column` claim (statement-level, the same narrow
      regex style as the ADD claim, never a parser), `netClaims`, and the net check in the
      `--adopt-fresh-install` path. Update the file's header comment, which explains the positive check,
      to say what a drop claim proves. Green.

If this proves larger than the PR, the fallback is recorded in the PR and the spec: the columns stay
dormant (0.15.0 never reads them), and the drop moves to a later release. The rest of PR 3 does not depend
on the drop.

### Task 3.2 The migration, `init.sql` and the undo (tests first)

`migrations/<date>-remove-sibling-connection.sql`, dated at session start after the newest file on `main`:

```sql
-- Codex becomes a standalone product; the suite integration is removed (CDX-SA-3).
--
-- The membership sync and the env-declared webhook subscription are gone from the code. This removes
-- what they left in the schema:
--   1. revoked open invitations are expired, so dropping revoked_at can never reopen one;
--   2. env-declared webhook subscriptions are deleted (their deliveries cascade); a self-hoster creates
--      the same subscription in Admin, Webhooks;
--   3. user_invitations.grants_admin and revoked_at are dropped. 0.15.0 reads neither.
--
-- MySQL commits each statement, so the order matters: 1 and 2 are safe to repeat if 3 fails.
-- Not idempotent as a whole. To undo it (the values are not restored; they meant something only to
-- the removed sync, and a downgraded 0.14.0 recreates its env subscription at boot):
--   ALTER TABLE user_invitations
--     ADD COLUMN grants_admin BOOLEAN NOT NULL DEFAULT FALSE,
--     ADD COLUMN revoked_at TIMESTAMP NULL DEFAULT NULL;

UPDATE user_invitations
   SET expires_at = LEAST(expires_at, NOW())
 WHERE revoked_at IS NOT NULL AND accepted = FALSE;

DELETE FROM webhook_subscriptions WHERE source = 'env';

ALTER TABLE user_invitations
  DROP COLUMN grants_admin,
  DROP COLUMN revoked_at;
```

- [ ] Rewrite `tests/integration/invitation-grants-admin.test.js` as
      `tests/integration/remove-sibling-connection.test.js`: on a pre-migration schema seeded with a
      revoked open invitation, an open `grants_admin` invitation, an `env` subscription with a pending
      delivery and an `admin` subscription with one, the runner applies the file; afterwards both
      columns are gone, the revoked invitation's `expires_at` is not in the future, the `env` row and its
      delivery are gone, the `admin` row and its delivery remain. Run: red.
- [ ] `init.sql`: remove the two columns and their comments from `user_invitations`.
- [ ] `tests/integration/pre-runner-state.js`: `UNDO_ON_INIT_SQL['<date>-remove-sibling-connection.sql']`
      is the undo above (it re-adds the columns, so the older two files' undos can drop them, newest
      first). `tests/integration/upgrade-path.test.js` then passes unmodified.
- [ ] `services/release-schema.js`: delete the `grants_admin` and `revoked_at` entries. The boot check
      keeps the other two.

### Task 3.3 The invitation rung stops reading `grants_admin` (tests first)

- [ ] `tests/services/identity.test.js` and `tests/integration/oidc-ladder.test.js`: an invitation binding
      creates a non-admin user, on a schema with the columns and on one without them (the same test run
      against both shapes, so either upgrade order works). Run: red on the dropped shape (the SELECT
      names the column).
- [ ] `services/identity.js`: drop `grants_admin` from the invitation SELECT and the `is_admin` value
      from the INSERT (it becomes the literal `FALSE`, as before W6-CDX-9). Green.

### Task 3.4 The membership sync goes (tests first)

- [ ] `tests/app.test.js` `describe('the sibling connection is removed')`: `PUT /api/machine/members`,
      `DELETE /api/machine/members` and `DELETE /api/machine/members/x@example.test` are 404 with a
      session and with `Authorization: Bearer <a 40-character token>` while `SERVICE_TOKEN` is set to
      that token. Run: red.
- [ ] Delete `routes/machine-members.js`, its import, mount and `machineMembersLimiter` in `app.js`,
      `docs/api/machine-members.md` and its row in `docs/README.md`, `tests/routes/machine-members.test.js`
      and `tests/integration/machine-members.test.js`, and its coverage threshold.

### Task 3.5 The reader check and the reconciliation read go (tests first)

- [ ] Same `describe`: `GET /api/workspaces/1/reader-check?email=a@example.test` and
      `GET /api/documents/state?workspaceId=1&ids=1` are 404 with a session and with the bearer above.
      Run: red.
- [ ] Delete the reader-check route from `routes/workspaces.js` (and its `getOidcConfig` import if
      nothing else uses it), the `/documents/state` route and `STATE_MAX_IDS` from `routes/documents.js`,
      the `authLimiter` mount on the reader-check path and `stateLimiter` in `app.js`.
- [ ] Delete `tests/routes/reader-check*.test.js`, the documents-state cases in
      `tests/routes/documents*.test.js`, and `tests/integration/documents-state.test.js`.

### Task 3.6 The machine credential goes; search and browse take a session (tests first)

- [ ] `tests/routes/search*.test.js`: with `SERVICE_TOKEN` and `SERVICE_TOKEN_USER` set, a request to
      `GET /api/search?query=x` and `GET /api/browse` carrying `Authorization: Bearer <SERVICE_TOKEN>` is
      401; a JWS-shaped bearer (`aaa.bbb.ccc`) is 401 and makes **no outbound request** (spy on
      `globalThis.fetch` and the `http` and `https` request functions: zero calls); a mocked session
      gets the same 200 body as before. Run: red.
- [ ] `routes/search.js`: `machineOrAuth` becomes `requireAuth` on both routes, and the doc comments that
      count "three routes a service token may reach" go. Nothing else in the handler changes.
- [ ] Delete `services/machine-auth.js`, `machineOrAuth`, `requireMachine` and `machineFailure` from
      `middleware/auth.js`, `tests/services/machine-auth.test.js`, the machine cases in
      `tests/middleware/*.test.js`, and the threshold. `jose` stays in `package.json`
      (`services/backchannel-logout.js` imports it); confirm with `rg -n "from 'jose'" cloudcodex --glob '!node_modules' --glob '!tests'`.
- [ ] Contract: `SERVICE_TOKEN`, `SERVICE_TOKEN_USER`, `MACHINE_OIDC_AUDIENCE`, `MACHINE_OIDC_SUBJECTS`
      become `removed` and join `REMOVED_IN_0_15`.

### Task 3.7 The env-declared webhook subscription goes (tests first)

- [ ] `tests/services/webhook-worker.test.js`: a subscription row whose `source` is not `admin` is never
      sent, whatever `WEBHOOK_SECRET` holds; it is logged once per skip window and its deliveries stay
      pending. `tests/routes/webhooks.test.js`: no response carries `managed`, and the env refusals
      ("configured in the server environment") are gone. `tests/server.test.js`: with `WEBHOOK_URL` and
      `WEBHOOK_SECRET` set, boot warns and inserts nothing into `webhook_subscriptions`. Run: red.
- [ ] `services/webhooks.js`: delete the env section (`ENV_UNSET_REASON`, `desiredEnvSubscription`,
      `reconcileEnvSubscription`, `MIN_SECRET_LENGTH` if unused) and fix the `MAX_WEBHOOK_SUBSCRIPTIONS`
      comment. `server.js`: drop the call. `services/webhook-worker.js`: select only `source = 'admin'`
      rows and sign with the stored secret only. `routes/webhooks.js`: drop `managed` and every
      `source === 'env'` branch. `src/components/WebhooksPanel.jsx`: drop the managed-row rendering
      and its test cases.
- [ ] Delete `tests/integration/webhooks-env.test.js`; `tests/integration/webhooks-cap.test.js` and
      `webhooks-schema.test.js` lose their env cases.
- [ ] Contract: `WEBHOOK_URL`, `WEBHOOK_SECRET`, `WEBHOOK_WORKSPACE_ID` become `removed`.
      `WEBHOOK_ALLOW_PRIVATE_TARGETS` stays (admin-created webhooks use it).

### Task 3.8 Docs, maps, verification

- [ ] Docs: `docs/api/search-favorites.md`, `docs/api/documents.md`, `docs/api/workspaces-squads-archives.md`
      (the reader check), `docs/api/webhooks.md` (the env subscription), `docs/security.md` (the machine
      credential section and the rate-limit rows), `docs/deployment.md` (the upgrade section: the
      migration, run order, the rollback undo, finding the sync's open invitations with
      `SELECT id, email FROM user_invitations WHERE invited_by = <former SERVICE_TOKEN_USER id> AND accepted = FALSE;`),
      `docs/getting-started.md`, `docs/database.md`, `docs/services.md`, `docs/notifications.md`;
      CLAUDE.md ("Machine callers" deleted, "Outbound webhooks" loses the env sentence, the Reuse table
      loses nothing it still needs); CHANGELOG `[Unreleased]`.
- [ ] Maps: `access-control.md` (section 7 deleted; section 8's checklist loses the machine step),
      `request-lifecycle.md` (rate limiters, router mounting, boot order), `data-model.md`
      (`user_invitations`, the webhook outbox's `source`, section 9's runner with drop claims),
      `notifications-and-activity.md` (2a and 2b lose the env subscription), `build-test-and-ops.md`
      (thresholds, the integration list), `open-questions.md`.
- [ ] `rg -n 'machineOrAuth|requireMachine|verifyMachineCredential|machine-members|reader-check|documents/state|reconcileEnvSubscription|grants_admin|revoked_at' cloudcodex --glob '!node_modules' --glob '!dist'`
      prints only migration-history references (the two older migration files, `pre-runner-state.js`,
      the runner tests) and the `removed` entries.
- [ ] Lint, test, coverage, build, design, and integration on a throwaway MySQL (`docker run -d --rm
      --name my-cdx-sa-3 -e MYSQL_ROOT_PASSWORD=root -p 127.0.0.1:<port>:3306 mysql:8.4.11`, stopped
      afterwards).

**Files touched (expected):** `scripts/migrate.js`, `migrations/<date>-remove-sibling-connection.sql`,
`init.sql`, `services/{machine-auth.js (deleted),identity.js,release-schema.js,webhooks.js,webhook-worker.js}`,
`middleware/auth.js`, `routes/{machine-members.js (deleted),search.js,documents.js,workspaces.js,webhooks.js}`,
`app.js`, `server.js`, `env-contract.js`, `src/components/WebhooksPanel.jsx`, tests as listed, docs and maps.

**Migrations:** one, `<date>-remove-sibling-connection.sql`, reversible by the undo in its header.

**Acceptance:** all seven removed routes are 404 under Supertest; a former service token and a JWS-shaped
bearer are 401 on search and browse with no outbound request; `--adopt-fresh-install` adopts a fresh
0.15.0 schema and refuses one that still has the columns; the upgrade path lands on `init.sql`'s schema
exactly; the worker never sends a non-admin row; CI green.

---

## PR 4: CDX-SA-4, remove issuer-specific behaviour, keep generic OIDC

Spec rows IS1 to IS6, IS9 and SC14. No behaviour change except what Task 4.3 finds.

### Task 4.1 "Hosted mode" becomes "OIDC-only mode"

Wording and names only; every assertion about behaviour stays.

- [ ] Rename `services/sessions-hosted.js` to `services/sessions-oidc-only.js` (export name kept or
      renamed with its one caller), its log line from `hosted boot:` to `OIDC-only boot:`, and the
      matching tests (`tests/routes/hosted-mode.test.js`, `admin-hosted.test.js`,
      `tests/integration/hosted-mode.test.js`) to `oidc-only-*`, changing only the expected log text.
- [ ] `env-contract.js` `why` texts that say "hosted instance" (`ADMIN_USERNAME`, `ADMIN_PASSWORD`,
      `LEGACY_SESSION_COOKIE`) say "an instance without local sign-in". Comments in
      `middleware/auth.js`, `services/auth-providers.js`, `routes/admin.js` (`ensureAdminUser`) and
      `src/hooks/useSignedOutTarget.js` follow.

### Task 4.2 Provider-neutral wording

- [ ] `services/oidc.js`: the header's reason for reading userinfo cites a research folder that is not in
      this repository; restate it in standard terms (OIDC Core names userinfo as the source of these
      claims, and some providers omit them from the ID token).
- [ ] `services/session-cookie.js`, `src/util.jsx`, `app.js` (`requireOriginForCookieWrites`): "a sibling
      host" becomes "another host under the same registrable domain"; the rules do not change.
- [ ] Tests: `rg -n -i 'zitadel' cloudcodex/tests`. Keep a mention only where the test records a measured
      provider behaviour (multi-valued `aud` with `azp`, identity claims only at userinfo), and say so in
      its comment; rename fixtures and descriptions that merely assume one.
- [ ] `tests/fixtures/return-to-corpus.json`: `_source` says the corpus is this repository's own hostile
      input set, first imported 2026-10-11; `tests/services/return-to.test.js`'s header drops the
      copy-and-sync contract and the plan reference. All 127 cases stay, byte for byte.

### Task 4.3 A second issuer shape proves nothing is provider-specific (tests first)

`tests/routes/oidc-callback.real-issuer.test.js` drives an in-process issuer that puts identity claims only
at userinfo, sends a multi-valued `aud`, a `sid`, and an `end_session_endpoint`. Add
`tests/routes/oidc-generic-provider.test.js` (factor the issuer out into a shared helper under
`tests/routes/` if the copy would exceed a screen) with the other common shape:

- `aud` a single string; `email`, `email_verified: true` and `name` in **both** the ID token and userinfo;
  no `sid` claim; discovery without `end_session_endpoint` and without `backchannel_logout_supported`.
- [ ] Sign-in through `/start` and `/callback` succeeds and the session row's `provider_sid` is NULL.
- [ ] `POST /api/logout` deletes the session and returns no end-session URL (`endSessionUrl` null or
      absent, whichever the route documents), and the client's local sign-out lands on `/?signedOut=1`.
- [ ] `POST /api/auth/oidc/backchannel-logout` with a valid logout token naming the subject still ends
      the session (a provider may support it without advertising it).
- [ ] Run. If any case is red, the fix is in scope here, smallest change first, and the spec's IS2 row
      records it.

### Task 4.4 Setup docs for common providers

- [ ] `docs/sign-in.md` (new, linked from `docs/README.md`, `docs/getting-started.md` and
      `docs/deployment.md`): local accounts, Google, and OIDC. For OIDC, the three URIs a provider
      registers (redirect `<APP_URL>/api/auth/oidc/callback`, post-logout `<APP_URL>/?signedOut=1`,
      back-channel `<APP_URL>/api/auth/oidc/backchannel-logout`), the scopes `openid email profile`, the
      verified-email requirement, `OIDC_PROVIDER_NAME`, `OIDC_LINK_BY_VERIFIED_EMAIL`,
      `OIDC_SESSION_TTL_HOURS`, OIDC-only mode with `AUTH_PROVIDERS=oidc`, the two-door model, the one
      issuer per instance limit, and the operator's relink for `identity_conflict` and
      `two_factor_enabled`. Then one short section each for Keycloak, Authentik, Okta and Microsoft Entra
      ID: where each setting lives in that provider's console, whether it sends `email_verified` and
      back-channel logout, and any known gap (Entra sends no `email_verified`; PR 6 decides the remedy).
      Each section says whether it was verified live, and only PR 6's provider may say yes.

### Task 4.5 Retire the identity spec and plan

The identity track's last open item was a recorded sign-in against the suite's issuer. A standalone product
has no suite issuer, and PR 6's live sign-in through a non-default provider replaces that check.

- [ ] Delete `docs/specs/2026-09-24-suite-identity.md` and `docs/plans/2026-09-24-suite-identity.md`;
      remove their rows from `docs/specs/README.md` and `docs/README.md`; mark the
      roadmap's identity row shipped and superseded by this track, with its PR numbers. Fix every link
      to them (`rg -n 'suite-identity' docs cloudcodex --glob '!docs/research/**'`), including the test
      header Task 4.2 rewrote.

### Task 4.6 Docs, maps, verification

- [ ] Maps: `request-lifecycle.md` (section 3's OIDC, the cookie rationale, the OIDC-only boot),
      `access-control.md` (section 6's provider-aware admin wording), `open-questions.md` (section F
      renamed). CLAUDE.md "Auth & accounts" and the security bullet's wording. CHANGELOG `[Unreleased]`.
- [ ] `rg -n -i 'zitadel|hosted mode|hosted instance|sibling' cloudcodex docs --glob '!node_modules' --glob '!docs/research/**' --glob '!CHANGELOG.md'`
      prints only provider-measured test comments and the setup docs.
- [ ] Lint, test, coverage, build, design, integration.

**Files touched (expected):** `services/{oidc.js,session-cookie.js,auth-providers.js,sessions-hosted.js
(renamed)}`, `middleware/auth.js`, `routes/admin.js`, `app.js`, `server.js`, `src/util.jsx`,
`src/hooks/useSignedOutTarget.js`, `env-contract.js`, `tests/fixtures/return-to-corpus.json`, tests as
listed, `docs/sign-in.md` (new), docs and maps, the two retired identity files.

**Migrations:** none.

**Acceptance:** both issuer shapes sign in and sign out; no source or current doc names one provider
outside the setup docs and measured-behaviour test comments; the return-to cases are unchanged; the
identity spec and plan are retired with no dangling link; CI green.

---

## PR 5: CDX-SA-5, clean up and harden, then the 0.15.0 release PR

Spec rows SM13, SM14, SC13, and riskiest removal 6.

### Task 5.1 The standalone gate (tests first)

- [ ] Replace `tests/design/suite-name.test.js` with `tests/design/standalone.test.js`, scanning the same
      directories and files (`src`, `routes`, `services`, `middleware`, `scripts`, `app.js`, `server.js`,
      `mysql_connect.js`, `index.html`, `env-contract.js`) for:

      ```javascript
      const FORBIDDEN = [
        /Cloud City(?! Computing)/,          // the company's legal name in a header is the only allowed form
        /Cloud Command/,
        /\bsuite mode\b/i,
        /\bSUITE_[A-Z_]+\b/,
        /\bW6-CMD-\d+/,
        /\bzitadel\b/i,
        /\b(paired|sibling) product\b/i,
      ];
      // Allowed, by exact string: the two preference storage names, and the removed contract entries
      // with services/removed-env.js, which must name what they warn about.
      ```

      Allow the two storage names (`cc_suite_theme`, `cc_suite_accent`) by exact match, and
      `SUITE_[A-Z_]+` only inside `env-contract.js` entries of `kind: 'removed'` and
      `services/removed-env.js`. Run: red on whatever PRs 2 to 4 left (comments, CSS banners, test names
      are not scanned); fix each by rewording or deleting.
- [ ] Mutation-check the gate: add `// Cloud Command` to one scanned file and see it red, then remove it.

### Task 5.2 Dead code and names

- [ ] Rename `src/lib/suite-prefs.js` to `src/lib/appearance-prefs.js` (exports unchanged, storage names
      unchanged, `__resetSuitePrefs` to `__resetAppearancePrefs`), with every importer and its tests;
      `tests/design/suite-theme.json` and `suite-theme.test.js` to `theme.json` and `theme.test.js`;
      update the comments in `index.html` only if the pre-paint script's bytes are untouched (the hash
      covers the script, not the HTML comment above it; `tests/theme-boot-hash.test.js` proves it).
- [ ] Find exports with no importer: for each `export` under `cloudcodex/services`, `routes`,
      `middleware`, `src/lib`, `src/hooks`, `rg` its name outside its own file and its test. Delete what
      only removed code used. `email_at_last_signin` stays (spec SC12), with its comment saying who reads
      it now.
- [ ] Comments that justify code by the suite or the sibling (`src/lib/focus-trap.js`'s "port of the
      Cloud Command focus trap", the design-token comments in `src/codex.css`, `AppearanceOptions.jsx`,
      `AppearanceControl.jsx`, `ShellIcons.jsx`, `src/tokens/accents.js`): restate in Codex's own terms.

### Task 5.3 The configuration contract

- [ ] `tests/env-contract.test.js`: `perInstance` is no longer an allowed field, and the header no longer
      says another product pins a copy. Run: red.
- [ ] `env-contract.js`: remove `perInstance` from every entry and the header paragraph. Keep the file
      data only. `docs/maps/request-lifecycle.md`'s contract section follows.
- [ ] `.env.example`: no section heading or comment mentions the suite, a machine credential or an env
      webhook.

### Task 5.4 An unmatched `/api` path is a JSON 404 in every mode (tests first)

`vite-express` serves `index.html` with 200 for an unknown GET in production, so a removed GET route would
look alive.

- [ ] `tests/app.test.js` `security header scope` block (it already re-imports `app.js` per `NODE_ENV` and
      appends a handler the way `vite-express` does): in production, `GET /api/suite` and
      `GET /api/no-such-route` answer 404 with `{ success: false, message: 'Not found' }` and
      `Content-Type: application/json`, before the appended handler can answer; `GET /some-page` still
      reaches it. Run: red.
- [ ] `app.js`: after the last `/api` router, `app.use('/api', (req, res) => res.status(404).json({ success: false, message: 'Not found' }));`
      Confirm no `/api` route is mounted later (`server.js` mounts none). Green.

### Task 5.5 Docs, maps, gates, CHANGELOG

- [ ] `docs/`: one pass over `README.md`, `docs/README.md`, `architecture.md`, `features.md`,
      `services.md`, `security.md`, `deployment.md`, `getting-started.md`, `testing.md`, `frontend.md`,
      `notifications.md`, `troubleshooting.md`, `CONTRIBUTING.md`, `SECURITY.md` with
      `rg -n -i 'suite|machine credential|service token|cloud command|zitadel|hosted' <file>`; every hit
      is rewritten or justified in the PR body.
- [ ] Maps: a full re-anchor pass on every map this track touched (re-derive each `file:line` from its
      landmark, never shift by a constant); `docs/maps/README.md`'s table; `build-test-and-ops.md`'s
      design-project section (the standalone gate, the renamed theme table).
- [ ] CLAUDE.md: the directory tree, the application areas and the Reuse table describe a standalone
      product; nothing mentions suite mode or machine callers.
- [ ] Design gates: `npm run test:design` green, ledger lower or equal, and the before and after
      counts in the PR body.
- [ ] CHANGELOG `[Unreleased]` complete: Removed (every variable with what to do, every route),
      Changed (search and browse take a session only; the theme preference is per host; linked accounts
      are editable outside OIDC-only mode; an unknown `/api` path is a JSON 404), Migration (the one file,
      run order, the rollback undo).
- [ ] Lint, test, coverage, build, design, integration.

### Task 5.6 The 0.15.0 release PR (its own branch, after Tasks 5.1 to 5.5 merge)

- [ ] `git switch -c release/0.15.0 origin/main`.
- [ ] CHANGELOG: `[Unreleased]` becomes `## [0.15.0] - <date>` with a two-sentence summary ("Codex
      becomes a standalone product; the suite integration is removed. ..."), and an empty `[Unreleased]`
      above it.
- [ ] `cloudcodex/package.json` and `cloudcodex/package-lock.json` versions, and the
      `CLOUDCODEX_VERSION` default in `docker-compose-release.yml`, become `0.15.0` (the three values
      `release.yml` checks).
- [ ] Nothing else in the diff. CI green; the maintainer authorized cutting the 0.15.0 tag once CI is green.

**Files touched (expected):** `tests/design/{suite-name.test.js (deleted),standalone.test.js (new),
theme.json,theme.test.js}`, `src/lib/appearance-prefs.js` (renamed), `env-contract.js`, `.env.example`,
`app.js`, comments across `src/`, docs, maps, CLAUDE.md, CHANGELOG; on the release branch only the
changelog and the three version values.

**Migrations:** none.

**Acceptance:** the standalone gate is green and mutation-checked; an unknown `/api` GET is a JSON 404 in
production; no `perInstance`; docs and maps describe a standalone product; CHANGELOG has the full upgrade
notes; the release PR carries only the version and the heading; CI green.

---

## PR 6: CDX-SA-6, the pre-1.0 standalone review, findings fixed

The spec's section "The pre-1.0 standalone review". Everything is recorded in
`docs/research/standalone-review-<date>/` (a `README.md` summary and a `raw/` folder of commands and
output), and the outcome goes into the roadmap's pre-1.0 row.

### Task 6.1 The image carries nothing of the suite

- [ ] Build the image from the branch: `docker compose -f docker-compose-prod.yml build app`.
- [ ] `docker run --rm --entrypoint sh <image> -c "grep -rIl -i -E 'suite mode|cloud command|SUITE_COMMAND|machine/members|reader-check|documents/state|zitadel' /app --exclude-dir=node_modules"`
      prints nothing, or only the `removed` contract
      entries and `services/removed-env.js` (`/app` is the image's `WORKDIR`, `cloudcodex/Dockerfile:29`).
      Record the output.

### Task 6.2 A clean-clone boot with local accounts

- [ ] In an empty directory: `git clone https://github.com/Cloud-City-Computing/c2.git && cd c2 && git switch <branch>`,
      then the first install exactly as `docs/deployment.md` writes it for `docker-compose-prod.yml`
      (`cp .env.example .env`, set the required values, `up -d --build`, `run --rm app npm run migrate -- --adopt-fresh-install`).
- [ ] With no SMTP: the boot admin signs in, invites a user by the copyable link, the user creates the
      account and opens the seeded welcome document. `/readyz` is 200.
- [ ] The seven removed routes answer 404 (JSON) through `curl` on the running app.
- [ ] Set `SERVICE_TOKEN=x` and `SUITE_NAME=y` in `.env`, restart: one warning line each, and the app
      serves.

### Task 6.3 A non-default OIDC provider in a container

Keycloak by default (pin the image digest at session start; Authentik if Keycloak cannot run here). The
issuer URL must resolve to the same name from the browser and the app container, so use a `*.localhost`
name (`OIDC_ISSUER_URL` allows plain http there): run Keycloak on the compose network with the alias
`keycloak.localhost`, listening on the same port inside and published on loopback, for example
`KC_HTTP_PORT=8180` with `-p 127.0.0.1:8180:8180`, so `http://keycloak.localhost:8180/realms/codex` is the
same URL for both.

- [ ] A realm `codex`, a confidential client with the three URIs from `docs/sign-in.md`, back-channel
      logout URL set, and two users with verified emails. Record the realm export (secrets redacted) in
      `raw/`.
- [ ] With local sign-in on: invite one address; it signs in through Keycloak and lands in its squad; the
      other address is refused `no_account`; signing out of Codex ends the Keycloak session
      (RP-initiated); ending the session in Keycloak's admin console ends the Codex session (back-channel),
      and the open tab's socket closes.
- [ ] `AUTH_PROVIDERS=oidc`: the bare root bounces to Keycloak, local routes are 404, and the boot admin
      signs in through Keycloak with no password.
- [ ] Follow `docs/sign-in.md`'s Keycloak section as written; every step that was wrong is fixed in the
      doc in this PR, and the section is marked verified with the date.

### Task 6.4 The four caveats, and the decisions the spec leaves here

- [ ] (1) Suite mode is absent (6.1 and the standalone gate). (2) The stability promise is written into
      `docs/deployment.md` (or a new `docs/stability.md`) from the spec's "What 1.0 promises", and every
      breaking change since 0.12.0 is in the upgrade notes. (3) Provider-neutral wording (PR 4's grep,
      re-run on `main`). (4) The plug point: one issuer per instance documented; the four provider
      sections present; `OIDC_PROVIDER_NAME` documented; issuer-managed accounts and machine-credential
      docs gone.
- [ ] **The legacy cookie premise.** On the running image over https (a local TLS proxy in front of the
      app, recorded in `raw/`): sign in on a pre-0.13.0 style cookie (`sessionToken` only, set by hand to
      a live session's token), load a page, and confirm the browser now holds `__Host-sessionToken` and no
      `sessionToken`. Confirm a session row cannot outlive seven days unused (or the OIDC TTL). Record the
      result; PR 7 acts on it.
- [ ] **The verified-email requirement (IS8).** Decide from the provider docs and, if reachable, a test
      tenant: either the docs suffice (Entra's section explains how to emit a verified claim or why it
      cannot), or a documented setting is added. A new setting is a product decision: ask Kyle before
      building it, and record the answer.
- [ ] **The default From address (IS10).** Recommend a default that does not name the vendor's domain
      (for example `Cloud Codex <noreply@<APP_URL host>>`, or requiring `SMTP_FROM` whenever SMTP is on);
      the change is a configuration change before 1.0, so it is made here, tests first, with its upgrade
      note, unless Kyle says otherwise.
- [ ] Any other finding: fixed in this PR if small, tests first; otherwise recorded in the roadmap with a
      named follow-up, and 1.0 waits only if it is a defect a self-hoster would hit.

### Task 6.5 Record

- [ ] `docs/research/standalone-review-<date>/README.md`: what was checked, how, the result of each
      check, and every finding with its fix or follow-up.
- [ ] Roadmap: the pre-1.0 row says done, with the date, the provider, and the link to the record.
- [ ] Maps and docs for any fix. CHANGELOG `[Unreleased]`.

**Files touched (expected):** `docs/research/standalone-review-<date>/` (new), `docs/sign-in.md`,
`docs/deployment.md` or `docs/stability.md`, the roadmap, and whatever each finding's fix touches.

**Migrations:** none expected. A finding that needs one numbers it at session start, reversible, under the
global constraints.

**Acceptance:** every check in the spec's review section is green or fixed; the clean-clone boot with local
accounts and with Keycloak (or Authentik) is recorded with its output; the legacy cookie premise is
measured; the IS8 and IS10 decisions are recorded; CI green.

---

## PR 7: CDX-SA-7, the 1.0.0 release

- [ ] `git switch -c release/1.0.0 origin/main` (after PR 6 merges).
- [ ] **The legacy cookie.** If PR 6 confirmed the premise: tests first (`tests/services/session-cookie*.test.js`,
      `tests/middleware/auth*.test.js`, the client's `util` tests: on https a lone `sessionToken` signs
      nobody in and the client never tries to move one; on plain http `sessionToken` is still the cookie),
      then remove `legacyCookieAllowed`, the https legacy read and the client's move, and make
      `LEGACY_SESSION_COOKIE` a `removed` entry. If PR 6 did not confirm it: change the default to `0`,
      update its contract entry and its `contractDefault` proof, and say so in the notes.
- [ ] The `removed` entries from 0.15.0 stay through 1.0.x (the promise: removed only in a major, after a
      minor release of warnings, so they may go in 2.0.0).
- [ ] CHANGELOG: `## [1.0.0] - <date>`, with the stability promise (from `docs/stability.md` or the
      deployment page), the upgrade path from 0.13.x, 0.14.x and 0.15.x, and the legacy cookie outcome.
- [ ] The three version values become `1.0.0`. The tag waits for Kyle.
- [ ] **Retirement:** delete `docs/specs/2026-10-14-standalone-codex.md` and this plan; mark the SA row in
      `docs/specs/roadmap.md` shipped with its PR numbers; remove the rows from `docs/specs/README.md`
      and `docs/README.md`; fix every link (`rg -n 'standalone-codex' docs cloudcodex`).
      The maps are the record.
- [ ] Lint, test, coverage, build, design, integration.

**Files touched (expected):** `services/session-cookie.js`, `middleware/auth.js`, `src/util.jsx`,
`env-contract.js` and their tests (if the cookie goes), CHANGELOG, the three version values, the roadmap
and the indexes, the two retired files.

**Migrations:** none.

**Acceptance:** the 1.0.0 notes state the promise and the upgrade paths; the legacy cookie decision is
implemented as PR 6 measured it; the spec and plan are retired with no dangling link; CI green; the tag is
Kyle's.
