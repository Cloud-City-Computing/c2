# Suite identity track: Cloud Codex as an OIDC relying party

Agreed 2026-09-24. Every `file:line` claim below was re-derived against `origin/main` `91493a6`.
Every PR in this track re-derives the anchors it touches at the then-current `main` before
editing, because `routes/auth.js`, `routes/oauth.js` and `app.js` move under every security change.

- **Track:** Wave 6 suite, identity. Sessions W6-CDX-2 to W6-CDX-9, preceded by the shared
  W6-CDX-10. This document is W6-CDX-1.
- **Plan:** [`../plans/2026-09-24-suite-identity.md`](../plans/2026-09-24-suite-identity.md)
- **Requested by:** Kyle, in the 2026-09-24 decisions recorded in the Cloud Command ADR
  `wave-6-is-one-sign-in-events-and-a-shared-shell.md` (Cloud Command is a private repository;
  the decisions that bind this spec are restated below so it stands on its own).

## Why this spec exists

Cloud City will run Cloud Codex beside Cloud Command as one suite (working name "Cloud City").
Kyle's decisions for Wave 6 that bind this track:

1. **One sign-in for both products, and one sign-out.** A person signs in once at Cloud City ID
   and is signed in to both products. Signing out of either ends both, by RP-initiated logout and
   by OIDC back-channel logout.
2. **Cloud City ID is a Zitadel instance, and it is the issuer.** Cloud Command and every Cloud
   Codex instance are OIDC relying parties. **Cloud Codex's own auth is not extracted into an
   issuer**, which retires the older "extract c2's auth into Cloud City ID" direction.
3. **Users are keyed on `(issuer, sub)`** through a `user_identities` table in each product, with
   verified-email linking as the fallback, so a member added by email binds on first sign-in.
4. **Every Cloud Command workspace maps to exactly one Cloud Codex instance.** Each instance gets
   its own Zitadel project, its own OIDC application and its own service user for machine calls.
   Codex keeps its per-instance integer ids.

What that means here: Cloud Codex gains a **generic** OIDC relying party. Nothing in the source
names Zitadel, Cloud City ID or the suite; the issuer is configuration, and a self-hoster can point
the same code at their own Zitadel, Keycloak, Authentik or Okta. **An install that sets no new
variable behaves exactly as it does today.** That is the constraint every item below carries,
because Cloud Codex stays source-available and complete on its own.

The track builds on shipped work: C2-2 made logout delete the session row and typed the token pool
(`024d862`), C2-3 is the migration runner every schema change here goes through (`55bdaf1`), C2-4
cut the `verifyMachineCredential` seam (`ab16b79`), and C2-5 is the reader check (`91493a6`).

## Current behaviour, the starting point

**No OIDC client.** `cloudcodex/package.json:19-59` has `google-auth-library` and neither
`openid-client` nor `jose`. The runtime is Node 20 (`cloudcodex/Dockerfile:11`, `:22`;
`.github/workflows/ci.yml:27`; `.github/workflows/release.yml:36`), which reached end of life on
2026-04-30.

**Google SSO is the closest shape, and it is the template for the ladder.**
`GET /api/oauth/google/callback` (`cloudcodex/routes/oauth.js:181-306`):

- the flow state lives in an in-memory `Map` (`oauth.js:84`), with no PKCE and no nonce;
- the ID token is verified with `audience: GOOGLE_CLIENT_ID` (`oauth.js:209-212`) and an
  unverified email is refused (`oauth.js:220-222`);
- it links by `(provider, provider_user_id)` first (`oauth.js:229-240`), then by email to an
  existing user (`oauth.js:241-253`), and refuses with `no_account` unless a domain allowlist is
  set (`oauth.js:256-259`);
- a created user gets a derived username (`deriveUniqueUsername`, `oauth.js:111-135`), because
  `users.name` is `VARCHAR(32) NOT NULL UNIQUE` (`init.sql:49`);
- it never asks for local 2FA, and it sets the cookie itself with `httpOnly: false`
  (`oauth.js:297-303`).

**`oauth_accounts` is the wrong home for an OIDC identity.** It is keyed on
`(provider, provider_user_id)` with `provider ENUM('google', 'github')` and no issuer
(`init.sql:74`, `:83`), and it carries GitHub token semantics (`encrypted_token`, `token_status`,
`init.sql:79-80`).

**One session row per user, stored raw.** `generateSessionToken`
(`cloudcodex/mysql_connect.js:109-144`) reuses the user's existing row, so a second device gets
the first device's token. Since C2-2 made `POST /api/logout` delete that row
(`routes/auth.js:370-384`), one logout signs out every device. `sessions.id` is the raw token
(`init.sql:88`), matched raw at `mysql_connect.js:153-156` and `:174-177`, and deleted raw at
`routes/auth.js:265` and `:381`. Nothing reaps expired rows: `server.js:132-150` prunes
`activity_log` only.

**The cookie is JS-readable by design, and set in two places.** The client writes it itself
(`src/components/Login.jsx:123`, `:140`, `:190`) with `secure; samesite=strict`; the server writes
it only on the Google callback (`oauth.js:297-303`). The server reads the first `sessionToken=`
it finds (`middleware/auth.js:27-31`), and so does the client (`src/util.jsx:626-632`). Both
WebSockets authenticate from a token the client reads out of that cookie and sends as the first
message (`services/collab.js:254-287`, `services/user-channel.js:116-146`). Neither the server
nor the client ever sets `Domain`.

**Sign-out is local only.** `performLogout` (`src/components/AccountPanel.jsx:10-17`) posts
`/api/logout`, clears the cookie and navigates to `/`.

**CSRF rests on an Origin check plus `SameSite=Strict`.** The `/api` CORS delegate
(`app.js:53-109`) admits a request with **no** `Origin` header (`app.js:58`), a same-host Origin,
`APP_URL`'s host, an exact `CORS_ORIGIN`, or localhost outside production. There are no CSRF
tokens. Both WebSocket upgrades already refuse a missing Origin and require the Origin host to
equal `Host` (`collab.js:217-238`, `user-channel.js:90-109`).

**One machine credential per install.** `verifyMachineCredential`
(`services/machine-auth.js:100-148`) compares a SHA-256 digest of `SERVICE_TOKEN` and resolves
`SERVICE_TOKEN_USER` by email to a non-admin user (`machine-auth.js:57-87`, `:113-146`). Its
header already says an OIDC client-credentials grant replaces this body with no call site
changing (`machine-auth.js:4-7`).

**The admin comes from `.env`.** `ensureAdminUser` (`routes/admin.js:37-67`) matches
`LOWER(name) = LOWER(?) OR email = ?`, then force-syncs `is_admin`, `password_hash` and `email`.
`server.js:17-21` exits unless `ADMIN_USERNAME`, `ADMIN_PASSWORD` and `ADMIN_EMAIL` are all set.

**Admission is invite-only.** `user_invitations` carries an email, a squad, a role and the seven
permission flags (`init.sql:138-159`), and `POST /api/create-account` refuses without an invite
token (`routes/auth.js:52-66`), then joins the invited squad in the same transaction
(`routes/auth.js:150-177`). CLAUDE.md decision 4 makes that a rule.

**The reader check keys on email.** C2-5 matches `LOWER(u.email) = LOWER(?)`
(`routes/workspaces.js:216-230`).

## Decisions this spec records

1. **Generic OIDC, never named.** New configuration: `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`,
   `OIDC_CLIENT_SECRET`, and `OIDC_PROVIDER_NAME` for the button label (default `SSO`, so the
   button reads "Sign in with SSO"). The redirect URI is derived from `APP_URL`, never taken from
   a request. The UI track's suite mode may default the label from its single suite-name
   constant; this track never spells the name.
2. **A new `user_identities` table**, not a third `oauth_accounts` provider value, for the reason
   above: that table has no issuer and carries GitHub token semantics.
3. **`(issuer, sub)` is the key; verified email is the fallback; invite-only survives.** The
   sign-in ladder, in order:
   1. an identity row for `(issuer, sub)` exists: that user;
   2. else, with `OIDC_LINK_BY_VERIFIED_EMAIL` on (the default), an existing user whose email
      matches the issuer's **verified** email and who has **no identity at this issuer yet** is
      linked. A user who already has a different `sub` at this issuer is refused as
      `identity_conflict` (a recycled address, or a deleted and recreated IdP account), and an
      operator relinks by hand;
   3. else, an open invitation for that verified email creates the user with the invitation's
      squad and flags (W6-CDX-8);
   4. else `no_account`. **Auto-provisioning is off**, and there is no setting to turn it on in
      this track.
4. **Hosted instances are OIDC only.** `AUTH_PROVIDERS=oidc` unmounts local login, signup, reset
   and 2FA, so no C2-2 token purpose is ever minted there.
5. **One session row per sign-in, stored as a SHA-256 digest.** Existing rows are hashed in place,
   so nobody is signed out by the upgrade.
6. **Sign-out propagates both ways.** RP-initiated logout sends `client_id`,
   `post_logout_redirect_uri` and `state`; **no ID token is stored**. A back-channel logout
   receiver deletes the named sessions and closes exactly their sockets.
7. **The session cookie becomes `__Host-sessionToken` whenever it is Secure**, with the legacy name
   read only as a fallback behind `LEGACY_SESSION_COOKIE` (on for self-hosters, off for hosted).
   A cookie-only unsafe `/api` request must carry a passing `Origin`.
8. **Machine JWTs go through `verifyMachineCredential`, authorized by a subject allowlist.** Zitadel
   lets a client request any project's audience, so `aud` is checked but is never the tenant
   boundary.
9. **OIDC sessions last at most `OIDC_SESSION_TTL_HOURS` (default 24)** and skip local 2FA, because
   the issuer owns the second factor. Local and Google sessions keep their 7 days.
10. **Node 22.** Node 20 is past end of life and Cloud Command's relying party already runs on 22.
    Neither `openid-client` 6.8.8 nor `jose` 6.2.12 declares an `engines` range (`npm view`,
    2026-09-24), so the bump is a deliberate choice rather than a forced one, and it lands as its
    own commit.
11. **Nothing in Wave 6 changes Cloud Codex's schema before a live-MySQL test project exists.**
    That project is W6-CDX-10. Its number comes from the events design, but it is shared enabling
    work for every Wave 6 track, and it is specified in this document and executed as the first PR
    of this track's plan because this track is the first to change schema (W6-CDX-2). The events
    and hosting specs name it as a precondition rather than repeating it.

The routes Cloud City ID registers for each Codex instance are fixed here, because the
config-as-code session (W6-CCID-2) asserts its registered URIs against them:

| Purpose | Route |
|---|---|
| Redirect URI | `https://<codex-host>/api/auth/oidc/callback` |
| Post-logout redirect URI | `https://<codex-host>/?signedOut=1` |
| Back-channel logout URI | `https://<codex-host>/api/auth/oidc/backchannel-logout` |

## Ordering constraint

```
W6-CDX-10 (live MySQL) ──► W6-CDX-2 (sessions) ──► W6-CDX-3 (cookie, Origin)
                                  │
W6-CDX-4 (identity seam) ─────────┴──► W6-CDX-5 (the relying party) ──► W6-CDX-6 (sign-out)
                                                                    ├──► W6-CDX-7 (machine JWT)
                                                                    └──► W6-CDX-8 (hosted mode)
                                                     W6-CDX-7 + W6-CDX-8 ──► W6-CDX-9 (contingent)
```

- W6-CDX-4 changes no behaviour and can run any time after this spec.
- **W6-CDX-5 needs a real issuer to finish**: the local Cloud City ID stack (W6-CCID-1) and its
  registrations (W6-CCID-2). Its unit and fake-issuer tests do not.
- **The issuer-contract probe (W6-CCID-3) gates W6-CDX-5 to W6-CDX-8.** It measures, on the
  pinned Zitadel, the `aud` and `azp` of ID tokens, `sub` stability, the exact logout-token shape,
  which termination paths send back-channel logout, `end_session` with `client_id` alone, and
  what `aud` a service user can mint. A finding that contradicts an assumption here is written
  into that session's section of the plan before the session starts.
- One PR per session. Every fix lands failing-test-first.

---

## W6-CDX-10. A live-MySQL integration test project (shared, and first)

### Current behaviour

- Every backend test runs against a mocked `c2_query` (`cloudcodex/tests/setup.js:15-24`), and the
  migration runner's own tests say "Nothing here connects to MySQL"
  (`tests/scripts/migrate.test.js:1-9`). No test in the repository touches a real database.
- `vitest.config.js:18-50` declares two projects, `backend` and `frontend`, and `npm test` is a bare
  `vitest run` (`package.json:13`), which runs every project the config declares.
- `.github/workflows/ci.yml:14-44` has no `services:` block.
- MySQL commits DDL implicitly, so a failed migration cannot be rolled back
  (`scripts/migrate.js:15-25`). A schema change that has only been checked against a mock is
  unverified in exactly the place it can do lasting damage.
- The pool binds `DB_NAME` when `mysql_connect.js` is first imported, and the module exits the
  process if `DB_USER` or `DB_PASS` is missing (`mysql_connect.js:18-32`).

### In scope

- A third Vitest project, `integration` (node environment), over `tests/integration/**`, with its
  own setup file that **does not** apply the `mysql_connect.js` mock.
- Per test file, the setup creates a throwaway schema `c2_it_<random>` over an admin connection,
  sets `DB_NAME` and the credentials **before any app module is imported**, loads `init.sql` over a
  `multipleStatements` connection (it has no `USE` statement), and adopts it with the runner's
  exported `runMigrations({ adoptFreshInstall: true })`. The schema is dropped in `afterAll`, and a
  global teardown asserts that no `c2_it_` schema remains.
- `npm test` becomes `vitest run --project backend --project frontend`, `test:coverage` takes the
  same flags, and `test:integration` runs the new project. A contributor without Docker is
  unaffected.
- A static guard, in the backend project, that every project `vitest.config.js` declares other
  than `integration` is named in the `test` script and `integration` is not. That is what stops a
  future project from silently dropping out of the default run.
- CI: a `mysql:8.4` service and a `npm run test:integration` step go **inside** the existing
  `Lint, test and build` job, so the check that is already required on `main` covers them and no
  branch-protection change is needed.
- First real tests: `init.sql` plus `--adopt-fresh-install` gives a schema the runner accepts; a
  second run is a no-op; the runner's schema check refuses a schema missing a post-baseline
  column; and a canary that fails if `c2_query` is a mock.
- The build-test-and-ops map, and CLAUDE.md's Testing section, whose "a single `npm test` runs
  both" stays true and gains a sentence about the third project.

### Done means

- `npm test` reports the same file and test counts as `main` did before the PR (71 files and 1,479
  tests at `91493a6`, re-measured at execution), and the PR body shows both runs.
- The canary fails when the mock is reintroduced, and the teardown check fails when a schema is
  left behind. Each mutation is confirmed to have actually landed before its red run is trusted.
- A deliberately broken migration turns the integration step red inside the required check.
- Nothing in `npm test` needs Docker. Lint and coverage thresholds are green.

### Explicitly deferred

The schema-per-instance GRANT isolation proof. It runs on this project, but it is W6-CDX-33 in the
hosting track.

---

## W6-CDX-2. One session per sign-in, stored hashed

### Current behaviour

See "One session row per user, stored raw" above.

### In scope

- `generateSessionToken` always inserts a new row; the reuse and refresh-in-place branches go.
- One helper, `hashSessionToken(token)`, SHA-256 lowercase hex, used at every lookup and delete:
  `validateAndAutoLogin` and `touchSession` in `mysql_connect.js`, and `routes/auth.js:265` and
  `:381`. `sessions.id` stays `CHAR(64)`; a hex SHA-256 digest is also 64 characters.
- Each row records which flow minted it: `sessions.auth_provider VARCHAR(16) NOT NULL`, with a
  `CHECK` over `('local', 'google')` for now (c2's own VARCHAR-plus-CHECK precedent,
  `init.sql:104-121`); existing rows become `local`, and the default is dropped after the backfill
  so a future flow that forgets to name itself fails at insert, as the C2-2 purpose column does.
  W6-CDX-5 widens the CHECK to `oidc`.
- The same dated migration hashes existing rows in place with `SHA2(id, 256)`, **only for rows that
  are not already a lowercase hex digest**, so it is idempotent and safe whichever of the new image
  or the migration runs first. A raw token is 64 characters from `[A-Za-z0-9]`
  (`mysql_connect.js:96-100`), so the chance of one already looking like a digest is
  `(16/62)^64`. `init.sql` gains the column and a comment on `sessions.id`.
- **Why the hash rides with a column.** `--adopt-fresh-install` refuses any post-baseline file that
  declares no `CREATE TABLE` or `ADD COLUMN` it can check (`scripts/migrate.js:389-404`). A
  data-only migration would therefore make every later fresh install refuse to adopt. The rule for
  every Wave 6 migration in every track: a data change rides in a file that also makes a schema
  change, or it is not a migration.
- A daily prune of expired sessions beside the activity prune (`server.js:132-150`).
- Logout still deletes only the presented session; a password change still signs out the other
  devices (`routes/auth.js:263-266`); a reset still clears every session (`routes/auth.js:781-782`).
- A test pins that the Google callback's `Set-Cookie` carries no `Domain`.
- The deploy note: the new `NOT NULL` column with no default is incompatible with the old image in
  both directions, exactly like C2-2's purpose column, so this follows the documented stop,
  migrate, start order (`docs/deployment.md`, "Stop every writer first"). The hash step is
  idempotent, so a re-run or an interrupted run is harmless. The CHANGELOG entry says so.

### Done means

- Two sign-ins make two rows, and logging out one leaves the other valid, **against real MySQL**
  in the W6-CDX-10 project.
- No stored id equals a raw token, and a row created before the migration still validates after
  it, against real MySQL. Running the migration's `UPDATE` twice changes zero rows the second time.
- The JS digest equals MySQL's `SHA2(?, 256)` for the same token, asserted on real MySQL.
- A local sign-in writes `auth_provider = 'local'` and the Google callback writes `'google'`; an
  insert that omits the column fails, on real MySQL. `--adopt-fresh-install` still adopts a schema
  `init.sql` built.
- Existing tests change only where they asserted row reuse, and the PR body lists each one.
- Coverage thresholds hold. `docs/maps/request-lifecycle.md` (session tokens),
  `docs/maps/data-model.md` section 4 and `docs/maps/open-questions.md` C2 move in the same PR.

### Explicitly deferred

Binding a session to an IP or user agent, and any change to the 7-day lifetime of local sessions.
Neither is needed for sign-out to propagate.

---

## W6-CDX-3. Sibling-host hardening: a `__Host-` cookie, and Origin-required cookie writes

### Current behaviour

See "The cookie is JS-readable by design" and "CSRF rests on an Origin check" above. Under
sibling hosts (`command.example.com`, `codex.example.com`) script on any sibling can set
`sessionToken=<its own>; Domain=example.com; Path=/api`, the browser sends the longer path first,
and both readers take the first match. A `__Host-` cookie cannot carry `Domain` at all.

### In scope

- The session cookie is named `__Host-sessionToken` whenever it is Secure, on every writer and
  reader: the server write (`oauth.js:297-303`), the client writes (`Login.jsx:123`, `:140`,
  `:190`), the reads (`middleware/auth.js:27-31`, `util.jsx:626-632`) and the clear
  (`AccountPanel.jsx:15`). The prefixed cookie always wins. The legacy name is read only when no
  prefixed cookie exists **and** `LEGACY_SESSION_COOKIE` is on (default on, so a self-hoster's
  existing sessions survive the upgrade), and the client rewrites a legacy cookie under the
  prefixed name when it finds one.
- A new rule after CORS in `app.js`: an unsafe-method `/api` request authenticated by **cookie
  alone** (no `Authorization` header) is refused with 403 unless its `Origin` passes the same
  allow rule the CORS delegate applies. The allow rule moves into one named function so the two
  cannot drift. Bearer-only calls (every `apiFetch` call, and every server-to-server caller) are
  unaffected.
- Both WebSocket upgrades already refuse a missing Origin; tests pin that they do, and that a
  sibling Origin is refused.
- `.env.example` documents `LEGACY_SESSION_COOKIE`; the request-lifecycle map and
  `docs/security.md` describe the cookie and CSRF model.

### Done means

- A prefixed cookie beats a tossed legacy cookie, and with the flag off a lone legacy cookie
  authenticates nobody.
- No `Set-Cookie` the server writes carries `Domain`, and every client write omits it.
- A cookie-only POST without `Origin` gets 403; the same POST with a bearer header and no `Origin`
  passes; a cookie-only POST with the app's own `Origin` passes.
- The existing suite is green. Login, collaborative editing and notifications are checked by hand
  in a browser at desktop and mobile widths, over https or `localhost`.

### Explicitly deferred

- Making the cookie `HttpOnly`. Both WebSockets authenticate from a token the client reads, so an
  `HttpOnly` cookie needs a socket handshake change first. Out of scope for Wave 6.
- CSRF tokens. The Origin rule closes the no-Origin gap without a token scheme.
- Removing the legacy-name fallback for self-hosters. That is a later, announced change.

---

## W6-CDX-4. An identity-resolution seam, with Google moved onto it

### Current behaviour

The Google callback's linking ladder is written inline in the route (`oauth.js:229-281`), and
`deriveUniqueUsername` sits beside it (`oauth.js:111-135`).

### In scope

- `cloudcodex/services/identity.js` holds `resolveIdentity(claims, policy)` and
  `deriveUniqueUsername`, moved verbatim. It lives under `services/`, beside `machine-auth.js`,
  rather than a new top-level directory, so the existing coverage globs
  (`vitest.config.js:56-65`) include it without a config change.
- The Google callback delegates to it with a policy that reproduces today clause for clause, the
  `email_verified` refusal first.
- `AUTH_PROVIDERS` is parsed and validated at boot, failing fast on an unknown value. It accepts
  `local` and `google` now and `oidc` once W6-CDX-5 lands, and its default is today's derived set
  (local always, Google when configured).
- `middleware/auth.js` is untouched.

### Done means

- `tests/routes/oauth.test.js` and `tests/routes/auth.test.js` pass with **zero assertion edits**.
- New unit tests cover every `resolveIdentity` branch. Coverage thresholds hold and lint is clean.

### Explicitly deferred

Extracting the local username-and-password provider into the seam. The old design's full
extraction buys nothing the relying party needs.

---

## W6-CDX-5. The OIDC relying party, `user_identities`, and session provenance

### Current behaviour

There is none; see "No OIDC client" above.

### In scope

- **Node 22**, as the first commit: both `Dockerfile` stages, `ci.yml`, `release.yml`, and the
  "Node 20" statements in `CLAUDE.md` and `docs/`.
- `openid-client` and `jose` as direct dependencies.
- **Schema**, through the runner and `init.sql`, in shapes `schemaClaims` (`scripts/migrate.js:351`)
  can read:
  - `user_identities`: `INT` id, `user_id` FK to `users` `ON DELETE CASCADE`, `issuer` and
    `subject` `VARCHAR(255)` in `utf8mb4_bin` (a `sub` is case-sensitive), `email_at_link`,
    `created_at`, `last_login_at`, `UNIQUE (issuer, subject)`, and `UNIQUE (user_id, issuer)`,
    which makes the same-issuer conflict rule a database fact.
  - `sessions.auth_provider`'s CHECK (from W6-CDX-2) widens to `('local', 'google', 'oidc')`, and
    `sessions` gains `identity_id` (FK to `user_identities` `ON DELETE CASCADE`) and
    `provider_sid` with an index.
    **The pairing rule "oidc if and only if `identity_id` is set" cannot be a CHECK here**: MySQL
    prohibits a CHECK over a column that carries a foreign-key referential action. It is enforced
    in `generateSessionToken`'s signature and pinned by a live-MySQL test.
- `cloudcodex/services/oidc.js`, a port of Cloud Command's relying party: discovery cached per
  process, authorization code with PKCE, `state` and `nonce` in a **signed, stateless flow cookie**
  (never the `oauth.js:84` Map), identity claims read from **userinfo**, a 60-second clock
  tolerance, and a plaintext `http` issuer accepted only on loopback, including `*.localhost`.
- `routes/oidc.js`: `GET /api/auth/oidc/start?returnTo=` and `GET /api/auth/oidc/callback`, the
  callback on `authLimiter` (`app.js:128-147`). `returnTo` is validated by one allowlist function
  (a single leading `/`, no `//` or `/\`, no scheme, no control characters, no encoded form of any
  of those, bounded length) and sealed in the flow cookie; the callback never redirects to a host
  taken from input. Its hostile-input corpus is the one Cloud Command commits for W6-CMD-24,
  copied verbatim.
- The ladder in Decision 3, through `resolveIdentity`. On an identity hit, the issuer's verified
  email replaces `users.email` when it has changed, unless another row holds that address, which
  refuses as `email_conflict` and changes nothing.
- OIDC sessions skip local 2FA (the user's `totp_secret` is kept), and `GET /api/2fa/status`
  reports `managed_by` so the account page can say who owns the factor.
- `OIDC_SESSION_TTL_HOURS`, default 24, sets an OIDC session's absolute expiry.
- `GET /api/oauth/providers` gains `oidc: { enabled, name }`, and `Login.jsx` renders the button.
- The C2-5 reader check accepts an optional `subject` query parameter, matched through
  `user_identities` before the email. The unknown-subject answer is the same `false`.
- `.env.example`, the trust statement in `docs/security.md`, and the request-lifecycle,
  data-model and access-control maps.

### Done means

- An in-process fake-issuer test, with identity claims **only** at userinfo (Cloud Command's
  pattern), signs a user in end to end. A real sign-in against the local Cloud City ID stack is
  recorded in `docs/research/`.
- Linking tests: an existing local user links; a same-issuer different `sub` is refused; an
  unverified email is refused; an issuer-side email change is followed; a collision is refused.
- The migration is verified on real MySQL, including `--adopt-fresh-install` on an `init.sql`
  schema. All pre-existing tests pass unmodified, and coverage thresholds hold.

### Explicitly deferred

Auto-provisioning; storing ID or refresh tokens; per-request token introspection; brokering a
customer's own IdP; any change to `requireAuth`.

---

## W6-CDX-6. Sign-out that propagates: RP-initiated, back-channel, and per-session socket teardown

### Current behaviour

See "Sign-out is local only" above. Both socket services authenticate once
(`collab.js:281`, `user-channel.js:139`) and never re-check, and neither records which session a
socket belongs to.

### In scope

- For an OIDC session, `POST /api/logout` deletes the row and returns `endSessionUrl` (the
  discovered `end_session_endpoint` with `client_id`, `post_logout_redirect_uri` and `state`);
  `AccountPanel.jsx` ends locally first, then navigates to it. A failed request still ends
  locally.
- `POST /api/auth/oidc/backchannel-logout`, mounted only when OIDC is enabled, with its own
  route-level `urlencoded` parser (`app.js:137` mounts only JSON) and its own IP-keyed limiter
  sized for issuer bursts, never `authLimiter`. It verifies the logout token with `jose` against
  the cached JWKS: `iss`, `aud` includes the client id, a bounded `iat`, `exp` if present, the
  back-channel `events` member, **no** `nonce`, `sid` or `sub` present, and `jti` not replayed (a
  bounded in-process cache, which is correct for the single process CLAUDE.md decision 1
  mandates). It deletes by `provider_sid`, or every OIDC session of the `(issuer, sub)` identity
  when only `sub` is present, and answers `200` with `Cache-Control: no-store`, or `400`.
- `validateAndAutoLogin` also returns the session digest; both socket services store it per
  socket; `closeSocketsForSessions(digests)` in each closes exactly those sockets, on back-channel
  logout and on local logout.
- The request-lifecycle and documents-and-collab maps.

### Done means

- A test per token-validation rule, each of which deletes nothing on failure.
- Row deletion by `sid` and by `sub`, and socket closure by digest, including another device's
  socket staying open.
- Against the local Cloud City ID stack, signing out of Cloud Command makes Codex answer 401 and
  closes both of that browser's sockets. W6-CCID-5's E3 repeats this in both domain shapes.

### Explicitly deferred

The collab re-authentication frame. Sockets never re-check, so expiry cannot cut an edit
mid-keystroke, and revocation now closes the right sockets, which was the security half of it.

---

## W6-CDX-7. Machine credential: OIDC client-credentials JWTs through `verifyMachineCredential`

### Current behaviour

See "One machine credential per install" above.

### In scope

- `verifyMachineCredential` gains a JWT branch, reached only for a JWS-shaped token and only when
  `OIDC_ISSUER_URL`, `MACHINE_OIDC_AUDIENCE` (the instance's Zitadel project id) and
  `MACHINE_OIDC_SUBJECTS` (the allowlisted service-user ids) are all set.
- `jose` verifies it against the cached JWKS with `iss`, `aud` and a 60-second tolerance; then
  `sub` must be in the allowlist.
- The principal stays `SERVICE_TOKEN_USER`'s non-admin user: the admin row is refused and
  `is_admin` is the literal `false`, exactly as today. The static `SERVICE_TOKEN` path is unchanged
  for self-hosters, and **no call site changes**.
- The file header and access-control map section 7.

### Done means

- A valid token yields the principal; the right `aud` with a wrong `sub` yields null; another
  instance's `aud` yields null; an expired token yields null; an opaque 64-character session token
  never enters the JWT branch; an admin principal is refused.
- The existing `requireMachine` and `machineOrAuth` tests are unmodified and green.

### Explicitly deferred

Scopes or claims-based authorization inside the token. The principal's ordinary archive ACLs stay
the only authorization, which is what keeps this safe.

---

## W6-CDX-8. Hosted mode: OIDC-only sign-in, a provider-aware admin, and invitations that bind on verified email

### Current behaviour

See "The admin comes from `.env`" and "Admission is invite-only" above. `StdLayout` sends every
signed-out path other than `/` and `/404` to `/` and drops the target
(`src/page_layouts/Std_Layout.jsx:273-276`).

### In scope

- `AUTH_PROVIDERS=oidc` unmounts local login, create-account, forgot and reset password, and the
  2FA routes.
- With local disabled, `ensureAdminUser` resolves by `ADMIN_EMAIL` only (no name match), sets
  `is_admin` and writes no `password_hash`; `server.js:17-21` requires `ADMIN_USERNAME` and
  `ADMIN_PASSWORD` only while local is enabled. That boot assertion is the one existing test
  expected to move, and the PR says so.
- An OIDC sign-in whose verified email matches an open `user_invitations` row creates the user with
  that invitation's squad and flags, in one transaction, and marks it accepted: track B's path,
  reached by a verified email instead of a token.
- `users.deactivated_at`, refused by `validateAndAutoLogin` and by every sign-in path, so a removed
  member keeps their authorship and loses their access.
- **The deep-link bounce for OIDC-only instances.** `StdLayout` keeps a signed-out target instead of
  discarding it, and when OIDC is the only provider it sends the browser once per tab to
  `/api/auth/oidc/start?returnTo=<target>`, with a loop guard so an error return renders the
  landing instead of bouncing again. The UI track's W6-CDX-26 builds the suite-mode front door and
  the mixed-provider case on top of this.

### Done means

- A fresh hosted instance boots with no admin password, and the `ADMIN_EMAIL` user signs in through
  OIDC as the admin.
- An invited email signs in and lands in its squad; an uninvited verified email gets `no_account`;
  a deactivated user is refused everywhere.
- A signed-out deep link on an OIDC-only instance lands on the document after sign-in, and the
  loop guard holds.
- Self-hosted defaults behave byte-identically, with existing tests unmodified apart from the one
  called-out boot assertion.

### Explicitly deferred

Self-service account deletion, and an admin UI for deactivation (the column is set by W6-CDX-9 or
by hand).

---

## W6-CDX-9. Machine membership endpoints for Cloud Command's admission sync (contingent)

**Contingent on Kyle's answer** to the first open question below. If the answer is "manual Codex
invitations for the test deploy", this session moves after the deploy and Cloud Command's W6-CMD-7
moves with it.

### In scope

- Two `requireMachine` routes. `PUT /api/machine/members { email, role }` creates or refreshes a
  long-lived invitation owned by the machine principal, sending no email, or reactivates a
  deactivated user. `DELETE /api/machine/members/:email` deactivates the user, deletes their
  sessions and closes their sockets.
- Both are idempotent and rate-limited, and neither reveals anything about an account the caller
  did not already name.
- The owner-to-instance-admin mapping follows Kyle's answer.
- `docs/api/` and the access-control map. This widens the machine surface CLAUDE.md:108-114
  describes, and that paragraph is amended in the same PR.

### Done means

Creation, refresh, idempotency, deactivation and reactivation are tested. After `DELETE` the user
cannot sign in, and their documents and authorship remain. A human session calling either route
gets the same 401 an anonymous caller gets.

---

## Cross-repo dependencies

| This session | Needs, from outside this repo | Is needed by |
|---|---|---|
| W6-CDX-10 | nothing | every Wave 6 Codex schema change, in every track |
| W6-CDX-2 | nothing | W6-CCID-5 (indirectly, through W6-CDX-3 and W6-CDX-6) |
| W6-CDX-3 | nothing | W6-CCID-5 (E4, E5, E6) |
| W6-CDX-5 | W6-CCID-1 and W6-CCID-2 for the recorded real sign-in; W6-CCID-3 findings; the W6-CMD-24 returnTo corpus | W6-CMD-6 (reader check by subject) |
| W6-CDX-6 | W6-CCID-3 (logout-token shape, termination triggers) | W6-CCID-5 (E3, E7) |
| W6-CDX-7 | W6-CCID-2 (one service user per instance) | W6-CMD-6 (per-workspace client credentials) |
| W6-CDX-8 | nothing beyond W6-CDX-5 | W6-CCID-5 (E2); W6-CDX-26 |
| W6-CDX-9 | Kyle's answer | W6-CMD-7 |

## Lessons carried from Cloud Command's relying party

Measured against a real Zitadel v4.19.0 on 2026-09-23 while Cloud Command's relying party was
verified, and binding on this port:

- **Zitadel's ID token carries no email claim by default.** Identity claims come from userinfo.
- **Login v2 is a separate container**, owned by Cloud City ID. This repo never runs it.
- **The masterkey is 32 characters** (`openssl rand -hex 16`); `openssl rand -base64 32` gives 44
  and Zitadel refuses to boot. Relevant to any local stack a contributor stands up.
- **`openid-client` refuses a discovered issuer that differs from the configured one**, and a
  container's `localhost` is itself. The issuer URL must resolve under the same name from the
  browser and from the server, which is why local stacks use `*.localhost` names.
- **Zitadel puts a list in `aud`** (the client ids plus the project id for project-scoped apps).
  `openid-client` refuses a multi-valued `aud` unless `azp` equals the client id, and a code can
  be redeemed only with the owning client's credentials, so one project per Codex instance keeps
  ID-token audiences from crossing tenants.
- **The fake-issuer test pattern**: an in-process HTTP issuer serving discovery, JWKS, token and
  userinfo, with identity claims only at userinfo, catches what a wholesale library mock cannot.

## CLAUDE.md amendments this track owes

Each lands in the PR that makes it true, and each is deliberate rather than slid past:

- "MySQL 8 + Node 20" (`CLAUDE.md:20`) becomes Node 22 (W6-CDX-5).
- "Auth & accounts" (`CLAUDE.md:101-106`) gains OIDC, one hashed session row per sign-in, and the
  `__Host-` cookie (W6-CDX-2, W6-CDX-3, W6-CDX-5).
- "Machine callers" (`CLAUDE.md:108-114`) gains the JWT branch (W6-CDX-7) and, if it ships, the
  membership routes (W6-CDX-9).
- Critical decision 4 (`CLAUDE.md:223-224`) says an OIDC flow admits only an existing user or an
  open invitation for the verified email (W6-CDX-5, W6-CDX-8).

## Explicitly deferred, track level

- **UUIDs in Cloud Codex.** Kyle's decision keeps per-instance integer ids; the instance id Cloud
  Command mints is the only suite-wide key.
- **Changes to `requireAuth`.** Identity resolves at sign-in; the routes behind `requireAuth` stay
  as they are.
- **Cloud Codex as an issuer.** Decided against.
- **Commercial machinery** (billing, entitlements, seat taxonomy, hosted provisioning automation,
  operator access), deferred to the later containerized-service era for the whole suite.

## Open questions for Kyle

1. **Admission sync.** Should adding, re-roling or removing a member in Cloud Command admit to or
   remove from the paired Codex instance automatically before the test deploy (which puts W6-CDX-9
   and W6-CMD-7 in pre-deploy scope), or are manual Codex invitations acceptable until after it?
2. **The 24-hour ceiling.** Is a 24-hour absolute lifetime on SSO sessions, renewed by a silent
   redirect, acceptable as the backstop for deprovisioning? This spec assumes yes; the cost is at
   most one full-page bounce per day for an active user.

## Retirement

Whichever of W6-CDX-2 to W6-CDX-9 merges last (W6-CDX-9, or W6-CDX-8 if W6-CDX-9 moves after the
test deploy) updates the maps, deletes this spec and its plan, and marks the identity row in
[`roadmap.md`](roadmap.md) shipped.
