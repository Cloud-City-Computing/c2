# Five-Minute Evaluation

**Track A of the [roadmap](roadmap.md). Agreed 2026-07-27.**

Make Cloud Codex runnable and demo-able by a stranger who has cloned the repo
and configured nothing but two admin variables.

**Done means:** `git clone`, `cp .env.example .env`, set `ADMIN_USERNAME` /
`ADMIN_PASSWORD` / `ADMIN_EMAIL`, `docker compose -f docker-compose-prod.yml up`,
and land on a real document. No SMTP server anywhere. Under five minutes. CI
green with all coverage thresholds held.

---

## Why

Two walls stop every evaluator, both documented with evidence in the
[roadmap](roadmap.md):

1. **The app refuses to boot without a working SMTP server.**
   `server.js:17-21` exits on missing credentials; `server.js:33-38`
   live-verifies the connection and calls `process.exit(1)` on failure. No
   bypass exists, including for `NODE_ENV`.
2. **A fresh admin lands in a completely empty app**, because
   `ensureAdminUser()` in `routes/admin.js` creates only a user row and a
   permissions row.

## 1. The mail capability

`services/email.js` gains one module-level fact, decided once at boot and
exported:

```
mailEnabled = SMTP_HOST && SMTP_USER && SMTP_PASS
              && verifyEmailConnection() succeeded
```

- `server.js` stops calling `process.exit(1)` for both the missing-config gate
  (`server.js:17-21`) and the failed verification (`server.js:33-38`). It logs
  one honest line instead and continues booting:
  `Email disabled: <reason>. Invites will show copyable links; password reset is unavailable.`
- `sendEmail()` (`services/email.js:51`) becomes a no-op returning
  `{ skipped: true }` when mail is disabled, so the fire-and-forget callers in
  `services/notifications.js` need no changes at all.

**Not in scope:** runtime re-checking, a retry queue, a UI toggle. The state is
determined at boot and logged once. If SMTP dies later, `sendEmail` throws
exactly as it does today and the consumers below already tolerate it.

## 2. Consumer degradation

Complete map of every `sendEmail` caller and its behaviour when mail is off:

| Caller | Route | Behaviour with no mail |
|---|---|---|
| `routes/admin.js:256` | `POST /admin/invitations` | returns the invite link in the response |
| `routes/auth.js:329` | `POST /login` | unreachable, email-2FA cannot be enabled |
| `routes/auth.js:610` | `POST /forgot-password` | honest unavailable message |
| `routes/auth.js:800` | `POST /2fa/enable` | TOTP only, QR still rendered in-app |
| `routes/auth.js:908` | `POST /2fa/disable` | unreachable, same reason as login |
| `routes/squads.js:399` | squad invite | in-app notification only, already exists |
| `services/notifications.js:172` | the notification funnel | already fire-and-forget |

### Invitations become link-first, permanently

`POST /admin/invitations` builds `signupUrl` at `routes/admin.js:253` and
**never returns it** (`admin.js:272` returns only a message). Worse, a send
failure returns 500 at `admin.js:269` *after* the invitation row was already
inserted, orphaning an invite whose link the admin can no longer recover.

The fix serves both problems: **return `signupUrl` in the response body whether
or not mail is enabled**, and have the admin UI always render a copyable link.
Mail becomes a convenience on this path rather than the mechanism, and a send
failure downgrades from a 500 to a 201 carrying a warning flag.

Same treatment for squad invitations, which already create an in-app
notification of type `squad_invite`.

### Email-2FA is blocked at the source

`POST /2fa/enable` (`routes/auth.js:761-766`) currently accepts
`method: 'email'` unconditionally. It must return 400 when mail is disabled.

That single guard makes the dangerous pair unreachable: without it, a user who
enabled email-2FA on a mail-less instance could neither receive a login code
(`auth.js:329`) nor receive the code required to disable it (`auth.js:908`).
TOTP remains fully available, since its QR is rendered in-app and the email is
only a convenience copy.

### Password reset degrades honestly

`POST /forgot-password` returns a clear "password reset is unavailable on this
instance, contact your administrator" instead of its current silent success. The
admin is never stranded: `ensureAdminUser()` re-syncs their password from `.env`
on every boot.

### Security posture

Unchanged. Nothing becomes reachable without a token that was not required
before. The invite link carries the same 32-byte token generated at
`admin.js` today, delivered through the admin's screen rather than their inbox.

## 3. Install fixes

Four mechanical changes, all previously recorded in
[`../maps/open-questions.md`](../maps/open-questions.md):

- **`docker-compose-prod.yml`**: add `environment: DB_HOST: database` to the
  `app` service. `env_file` supplies `DB_HOST=localhost`, correct for dev where
  the app runs on the host and wrong inside a container. An explicit
  `environment` entry takes precedence over `env_file`, so this fixes production
  without touching dev.
- **`cloudcodex/Dockerfile`**: `npm install` → `npm ci`. Safe:
  `cloudcodex/package-lock.json` is committed and CI already runs `npm ci`
  against it.
- **`init.sql`**: add `github_links`, `activity_log`, `watches` and
  `notifications` to the `DROP TABLE IF EXISTS` block at `init.sql:12-31`, so
  `make reset-db` stops aborting partway on an existing database.
- **`.env.example`**: relabel the SMTP block optional with a comment stating
  what disabling it costs, and document `NODE_ENV`, which currently governs CORS
  behaviour (`app.js:52`) and the rate limiters (`app.js:87`, `app.js:109`)
  while appearing nowhere.

## 4. A non-empty first boot

`ensureAdminUser()` gains a sibling, `bootstrapInstance()`, guarded on
`SELECT COUNT(*) FROM workspaces = 0`. That guard makes it idempotent across
restarts and unable to interfere with any existing install.

When the count is zero, it creates:

```
Workspace  "<ADMIN_USERNAME>'s Workspace"    owner = ADMIN_EMAIL
  └── Squad "General"                         addSquadOwnerMember(squadId, adminId)
        └── Archive "Getting Started"         squad_id SET, never NULL
              └── Log "Welcome to Cloud Codex"
```

Three details that are load-bearing:

- **`workspaces.owner` is a `TEXT` column holding an email address**
  (`init.sql:39`), not a foreign key. Clause 4 of the access fragments matches
  on it (`routes/helpers/ownership.js:30`), so it must receive `ADMIN_EMAIL`.
- **The archive's `squad_id` must be set.** An archive with `squad_id NULL` is
  orphaned: clauses 4 through 7 of `readAccessWhere` all evaluate false and only
  the creator can ever reach it. This is exactly the existing bug in
  `/api/setup` (`routes/auth.js:180`).
- **Use the existing helpers**, `createDefaultPermissions` and
  `addSquadOwnerMember` from `routes/helpers/shared.js`, rather than writing new
  inserts.

The welcome document is not filler. It explains Workspaces → Squads → Archives →
Logs *by being an instance of it*, which is the cheapest available down payment
on the track C vocabulary problem: people learn the model by landing inside a
working one.

## 5. Testing

Affected files sit under high per-glob thresholds in `vitest.config.js`:
`services/email.js` at 95% lines, `routes/admin.js` at 90, `routes/auth.js` at
85. Tests ship with the code or CI rejects the change.

Coverage required:

- `tests/services/email.test.js`: the `mailEnabled` matrix; `sendEmail` no-ops
  and reports `skipped` when disabled.
- `tests/routes/admin.test.js`: invitations return `signupUrl` with mail both
  enabled and disabled; a send failure yields 201 with the link rather than 500.
- `tests/routes/auth.test.js`: `2fa/enable` rejects `method: 'email'` with 400
  when mail is disabled and still accepts `totp`; `forgot-password` returns the
  unavailable message.
- `tests/server.test.js`: boot does not exit when SMTP configuration is absent.
- New coverage for `bootstrapInstance`: seeds the full chain on an empty
  database, and no-ops when any workspace already exists.

### Two landmines

Both come from this repository's own test harness and will look mysterious:

1. **`tests/setup.js` replaces `services/email.js` with a factory mock**
   exposing exactly `sendEmail` and `verifyEmailConnection`. A new `mailEnabled`
   export is `undefined` at import in all 30-plus backend test files until that
   mock is extended. This breaks everything at once.
2. **`ensureAdminUser` gaining queries shifts the `c2_query` mock queue.**
   Backend tests queue `mockResolvedValueOnce` calls in the exact order a
   handler issues them, so every existing test touching the boot path will need
   its queue re-aligned. Those failures are ordering artifacts, not regressions.

## Explicitly deferred

- **`/api/setup` still creates orphaned archives** (`routes/auth.js:180`,
  `squad_id NULL`). The bootstrap makes it moot for the admin, and fixing it
  properly means deciding whether the endpoint should survive at all. Belongs to
  track B.
- **`WelcomeSetup.jsx` stays as-is.** Replacing the dead-end modal with a real
  guided flow is track B, and it lands in the UI layer that track E has to open
  up first.
- **No demo instance, no seed-data demo mode.** The bootstrap makes a fresh
  install non-empty, which is enough to evaluate. A hosted demo is track D.
- **No changes to the hierarchy or its vocabulary.** That is track C and it
  needs its own decision.

## Shippability

Beyond the repository's standard checklist in `CLAUDE.md`:

- `npm run lint` clean, `npm test` green, thresholds held.
- `.env.example` updated for both `SMTP_*` (now optional) and `NODE_ENV` (new).
- No migration needed: the bootstrap writes data, not schema. `init.sql` changes
  are to its `DROP` block only.
- Update [`../maps/request-lifecycle.md`](../maps/request-lifecycle.md) (the
  boot-gate table), [`../maps/build-test-and-ops.md`](../maps/build-test-and-ops.md)
  (Docker fixes), and resolve items **B3** and the `DB_HOST` note in
  [`../maps/open-questions.md`](../maps/open-questions.md), all in the same PR.
- Verify the five-minute claim by actually doing it from a clean clone with an
  empty `db-data/`, not by reasoning about it.
