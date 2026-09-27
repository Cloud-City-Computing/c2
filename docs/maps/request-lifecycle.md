# Request Lifecycle Map

From process start to response body: what boots, in what order, what every
request passes through, and how the two WebSocket servers get attached to the
same HTTP listener.

---

## 1. Boot order

`cloudcodex/server.js` is the entry point and it is deliberately fail-fast: two
config gates and the instance lock run **before** anything listens. The image
runs it as `node server.js` directly (`cloudcodex/Dockerfile`, the `CMD`), so a
stop signal reaches Node rather than npm; see section 7 for what it does then.

| Step | Location | Behaviour |
|---|---|---|
| Load `.env` | `mysql_connect.js:16` | `dotenv` reads `../.env`, i.e. the **repo root**, not `cloudcodex/`. Importing `mysql_connect.js` is what loads env for the whole process. |
| DB pool | `mysql_connect.js:18-32` | `mysql2/promise` pool, `connectionLimit: 10`, no queue limit. Its host, user, password and schema are one `connectionOptions` object, which `openConnection()` reuses for the instance lock's own connection. |
| DB credential gate | `mysql_connect.js:34-38` | Missing `DB_USER`/`DB_PASS` calls `process.exit(1)`. |
| Admin config gate | `server.js`, top-level | Missing `ADMIN_USERNAME`/`ADMIN_PASSWORD`/`ADMIN_EMAIL` exits 1. With the provider gate below and an invalid `PORT`, these are the only boot-fatal config gates besides the DB one above; there is no SMTP gate. |
| Sign-in provider gate | `server.js`, top-level | `parseAuthProviders()` (`services/identity.js`) validates `AUTH_PROVIDERS`. Unset or blank is today's set, `local` plus `google` when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are both set, so an install that sets nothing boots as before. A set value is a comma list of `local` and `google`; an unknown name, a list without `local`, a listed `google` that is not configured, or a configured Google the list leaves out exits 1 with a sentence naming the variable. The returned `Set` is not consumed yet: W6-CDX-8 is what unmounts providers by it. |
| Instance lock | `server.js:69-93`, top-level `await` | `acquireInstanceLock()` (`services/instance-lock.js`) runs `SELECT GET_LOCK(<name>, 0)` on a connection of its own (`openConnection()`, `mysql_connect.js:47-49`), never the pool, and holds it for the life of the process. **Before anything writes**, so a second process on the same schema refuses before its admin sync or seed can race the first's. A refusal exits 1 with `Another Cloud Codex process (MySQL connection <id>) already serves this database.`, naming the holder and the escape; so does a failure to open the connection at all, which under a supervisor is a restart rather than an outage. `C2_INSTANCE_LOCK=0`, and only `0`, takes no lock and logs that a second process will diverge. The lock object is handed to `/readyz` (`readiness.lock`, `routes/health.js`). The name, built server side as `INSTANCE_LOCK_NAME_SQL`, is `cloudcodex-instance:<db>`, or `cloudcodex-instance#` and the first 40 hex characters of the schema's SHA-256 when the schema name is longer than 44 characters, since MySQL refuses a lock name over 64 (ER 4163). It differs from the migration runner's `cloudcodex_migrate:<db>` (`scripts/migrate.js`, capped the same way past 45), so `npm run migrate` in a one-off container never contends with the running app, and it carries the schema, so instances sharing one MySQL server never contend with each other. `server.js` passes `onSuperseded`, which stops the process if another one takes the lock after this one lost it (section 7). |
| Mail capability | `server.js`, top-level `await` | `initMail()` (`services/email.js`) decides once, at boot, whether mail is usable: SMTP configured **and** the connection verifies. It never exits. Enabled logs `✔ SMTP connection verified`; disabled logs `✖ Email disabled: <reason>. Invites will show copyable links; password reset is unavailable.` on stderr, and `sendEmail()` becomes a silent no-op (`{skipped: true}`) for the rest of the process, so fire-and-forget callers needed no changes. The transport sets `connectionTimeout`/`greetingTimeout` of 10s and `socketTimeout` of 20s (`services/email.js`), so an unreachable host costs seconds here, not nodemailer's default two minutes. |
| Admin sync | `server.js`, top-level `await` | `ensureAdminUser()` from `routes/admin.js` creates the `.env` admin, or syncs an account that is already an admin (its email and password reset from `ADMIN_EMAIL`/`ADMIN_PASSWORD`), and returns its `id`; it **never promotes**: when an account matching by name or email is not an admin it writes nothing and returns `null` (`Promise<number\|null>`). It logs one `admin sync:` line, created, synced or refusing, never the password. The rule and its table are in `access-control.md` section 6. Wrapped in `try/catch`: a DB blip logs `admin user sync failed` and boot continues with `adminId = null` rather than never listening. |
| Bootstrap instance | `server.js`, top-level `await` | `bootstrapInstance(adminId)` from `routes/admin.js` seeds a starter workspace, squad, squad-ownership row, archive and welcome document the first time the database holds **no workspaces, archives or logs at all** (one `SELECT` of three `COUNT(*)` sub-selects). Workspaces alone would not do: `DELETE /api/workspaces/:id` plus `archives.squad_id ON DELETE SET NULL` (`init.sql:253`) can leave orphaned archives and logs behind an empty `workspaces` table. All five writes share one transaction via `withTransaction()` in `mysql_connect.js`. Also `try/catch`-wrapped: a failed seed logs `instance bootstrap failed` and leaves the instance empty but usable, and the next restart retries. |
| Listen | `server.js`, `ViteExpress.listen(app, port)` | Port is `PORT` if set, else 3000; a non-numeric or out-of-range `PORT` exits rather than falling back. **Last, deliberately.** `ViteExpress.listen` binds the socket and starts accepting requests *before* running its callback, so anything awaited in there would serve traffic with the answer undecided: a configured instance reporting `isMailEnabled() === false` for the length of the SMTP verify, and an empty app on a first boot. All three steps above therefore run as top-level `await`s before it. **The success line is guarded on `server.listening`**, because Express 5 aliases `listen`'s callback onto the socket's `'error'` event and so runs it on a failed bind too (see `open-questions.md` B8); a sibling `'error'` handler names the port and exits non-zero. The `'listening'` event is deliberately *not* used: `vite-express` injects its middleware asynchronously, so that event fires about twelve seconds before the dev server can serve. |
| Collab WS | `server.js:197` | `setupCollabServer(server)`, path `/collab`. |
| Notification WS | `server.js:201` | `setupUserChannelServer(server)`, path `/notifications-ws`. |
| Stop signals | `server.js:20-48`, before every other step; `server.js:209-221` | `process.on('SIGTERM')` and `process.on('SIGINT')` go in **first**, ahead of the config gates and the boot awaits. Node is PID 1 in the image, and the kernel drops a signal PID 1 has no handler for, so a `docker stop` during the lock, SMTP verify or admin sync would otherwise wait for SIGKILL. Until `createShutdown(...)` is assigned, after the listen and the socket servers, a signal logs `stopped on <signal> during boot` and exits 0 at once: nothing is pending and the lock goes with the process. From then on the first signal runs the shutdown (section 7) and a second one logs and exits 1 at once. |
| Activity prune | `server.js:223-241` | Deletes `activity_log` rows older than 365 days. `setInterval` every 24h plus a `setTimeout` 60s after boot, both `.unref()`ed. |

Two consequences worth knowing:

- **`app.js` is importable without side effects on the network.** It was split
  out of `server.js` precisely so Supertest can mount the app without a
  listener (`app.js:4-5`). Tests import `app.js`; they never import `server.js`
  except `tests/server.test.js`.
- **The daily prune is single-process by design.** `server.js:224` says so
  explicitly. The instance lock now enforces one process per schema, so a
  second replica does not start rather than pruning twice.

## 2. The middleware stack, in mount order

All of this lives in `cloudcodex/app.js`. Order matters and is not alphabetical.

```
app.set('trust proxy', 1)                    app.js:43
  │
  ├─ health router: /healthz, /readyz        app.js:47
  ├─ CORS, scoped to /api                    app.js:58-114
  ├─ helmet + CSP, scoped to /api            app.js:117-130
  ├─ express.json({ limit: '2mb' })          app.js:142
  ├─ authLimiter on 9 paths + reader-check   app.js:145-168
  ├─ searchLimiter on /api/users/search      app.js:179
  ├─ static /avatars      (7d immutable)     app.js:182-185
  ├─ static /doc-images   (30d immutable)    app.js:188-191
  └─ 18 routers, all mounted at /api
```

**CORS** (`app.js`, the `cors((req, cb) => ...)` block) allows, in order: a
request with no `Origin` header at all; a **same-origin** request, decided by
comparing the `Origin` URL's host against `req.headers.host`; a request whose
Origin matches **`APP_URL`**'s host; an exact match against `CORS_ORIGIN`; and
any localhost or 127.0.0.1 origin **when `NODE_ENV !== 'production'`**.
Everything else is rejected, which surfaces as a 500 rather than a 403 because
the rejection is thrown as an error before any router runs, and `app.js` mounts
no global error handler.

Both sides of every host comparison go through `new URL(...).host`, which
lowercases. A raw `Host` header does not, so a proxy emitting
`Host: Codex.Example.com` would otherwise fail to match its own `Origin`.

The same-origin clause is why this uses the request-taking form of `cors()`
rather than the simpler `cors({ origin: fn })`: the origin-only callback never
sees the request, so it cannot tell the app's own browser apart from a third
party's. Without it, a production instance with `CORS_ORIGIN` unset rejected
its own login POST, because browsers send `Origin` on same-origin
POST/PUT/DELETE. That was every install following `.env.example`, since
`npm run start` and the Docker image both force `NODE_ENV=production` while
`.env.example` ships `CORS_ORIGIN` blank. Covered by the `CORS` describe block
in `tests/app.test.js`, which forces `NODE_ENV=production` because the suite
otherwise runs as `test` and never reaches the branch that can reject.

The host comparison deliberately ignores scheme, so an install behind a
TLS-terminating proxy (browser sends an `https` Origin, the app sees a plain
`http` request) is still recognised as itself.

**The `APP_URL` clause exists because the `Host` clause alone is not enough
behind a proxy.** nginx's default `proxy_pass` sends `Host: 127.0.0.1:3000`, not
the public name, unless the operator adds `proxy_set_header Host $host`. Without
the `APP_URL` fallback that configuration reproduces the original outage exactly:
every write returns 500. `APP_URL` is already required and is operator-set.

It is deliberately **not** `req.hostname`. `trust proxy` is 1, so `req.hostname`
honours a client-supplied `X-Forwarded-Host`, and both compose files publish the
app's port directly, so an attacker could set that header themselves and turn
the same-origin clause into "allow any origin".

**CSP** (`app.js:118-129`) is scoped to `/api` on purpose so the Vite dev server's
inline module scripts are not blocked. `frameAncestors: 'none'`,
`objectSrc: 'none'`, `connectSrc` allows `ws:`/`wss:` for the two WebSockets,
`imgSrc` allows `data:` and `blob:` for pasted images.

**Body limit is 2 MB** (`app.js:142`). The collab WebSocket has its own, larger
limits (5 MB frame, 2 MB HTML) in `services/collab.js:48-49`, so a document that
saves fine over WS can 413 over REST.

### Rate limiters

| Limiter | Window / max | Applied to |
|---|---|---|
| `authLimiter` (`app.js:133-140`) | 15 min / 20, one bucket per IP across every mount | `/api/login`, `/api/create-account`, `/api/forgot-password`, `/api/reset-password`, `/api/2fa/verify`, `/api/2fa/totp/confirm`, `/api/2fa/disable/confirm`, `/api/oauth/google/callback` (`app.js:145-152`); `/api/update-account`, whose path mount also covers `/api/update-account/confirm-email` (`app.js:158`); and the `/api/workspaces/:id/reader-check` pattern (`app.js:168`) |
| `searchLimiter` (`app.js:171-178`) | 15 min / 60 | `/api/users/search` only (`app.js:179`), to blunt user enumeration |

Both carry `skip: () => process.env.NODE_ENV === 'test'`, which is why the test
suite can hammer `/api/login` without tripping them. One test exercises the
limiter itself: `tests/app.test.js` sets `NODE_ENV=production` for its duration
and requires the 21st `/api/update-account` request, then
`/api/update-account/confirm-email`, to answer 429 while an unmounted route does
not. The other mounts are not exercised.

### Router mounting

The health router (`routes/health.js`) is the one exception to what follows: it
mounts at the root, ahead of every `/api` layer (`app.js:47`), and answers
`/healthz` and `/readyz` only (section 7).

All 18 other routers mount on the bare `/api` prefix, so each router
declares its own full path (`router.post('/login', ...)` yields `/api/login`).
There is no per-area prefix. Mount order is the resolution order, and several
routers declare overlapping shapes, so a path collision resolves to whichever
router was mounted first. Current order:

```
auth, search, archives, documents, upload, workspaces, squads, comments,
avatars, doc-images, admin, oauth, github, favorites, notifications,
activity, first-run, watches
```

`first-run` (`routes/first-run.js`) is the newest addition, mounted between
`activity` and `watches`. It answers one question, does this authenticated
user still need the onboarding welcome and what should it point at
(`GET /api/first-run`), and stamps `users.onboarded_at` idempotently
(`POST /api/first-run/complete`). It has no writes of its own beyond that
stamp; the archive and squad it points at are resolved read-only through the
`ownership.js` fragments. See [access-control.md](access-control.md) for how
that lookup avoids the admin-bypass trap, and
[frontend-architecture.md](frontend-architecture.md) for the hook and gate
component that consume it.

## 3. Authentication

`middleware/auth.js` is the whole of it.

`requireAuth`:

1. Token from `extractSessionToken(req)`: `Authorization: Bearer <token>`,
   falling back to a `sessionToken=` cookie parsed by hand out of the raw
   `Cookie` header. The cookie path exists for browser redirects, notably the
   OAuth callbacks. There is no cookie-parser dependency. `extractSessionToken`
   is **exported**, so it is the single definition of "which token is this
   request carrying" and `POST /api/logout` uses the same one.
2. No token, 401 `Authentication required`.
3. `validateAndAutoLogin(token)` (`mysql_connect.js:178-192`) looks the session
   up by primary key, rejects if `expires_at <= now`, then loads the user row.
   The returned user carries exactly `id, name, email, avatar_url, is_admin`.
4. On success sets `req.user` and `req.sessionToken`, then fires
   `touchSession(token)` **without awaiting**; a failure is logged, never
   fatal.

`requireAdmin` (`middleware/auth.js`) is a pure `req.user.is_admin` check and
must run after `requireAuth`.

`machineOrAuth` (`middleware/auth.js`) is the one alternative to `requireAuth`,
and it wraps it rather than replacing it:

1. Token from the same `extractSessionToken(req)`. No token at all, straight to
   `requireAuth`, which 401s.
2. `verifyMachineCredential(token)` (`services/machine-auth.js`). A match sets
   `req.user` to a machine principal and calls `next()`, so
   `validateAndAutoLogin` is never reached and a service token cannot be
   mistaken for a session row.
3. Anything else, including every ordinary session token, falls through to
   `requireAuth` unchanged. A rejected lookup goes to `next(err)` and lands in
   the router's `errorHandler`, never in a silent pass.

A machine principal is `{ id, name, email, is_admin: false, is_machine: true }`
and carries **no `req.sessionToken`**: there is no session row, so
`touchSession` never runs and logout has nothing to revoke. The token
comparison is `crypto.timingSafeEqual` over two SHA-256 digests, so a session
token presented on these routes meets a constant-time comparison that cannot
match it and cannot leak its length, and the `users` lookup happens only after
the token matches, so a wrong token costs no query.

It is mounted on exactly two routes, `GET /api/search` and `GET /api/browse`
(`routes/search.js`), and configured by `SERVICE_TOKEN` plus
`SERVICE_TOKEN_USER`, both required. See
[access-control.md](access-control.md) section 7 for the never-admin rule.

### External identity: the resolution seam

`middleware/auth.js` authenticates a session; deciding **which local user** an
external sign-in is happens before any session exists, in one place:
`resolveIdentity(claims, policy)` in `services/identity.js`. A provider route
does the protocol work (state, code exchange, token verification), hands the
verified claims and a policy to the seam, and turns the answer into a session
or a redirect. The answer is `{ ok: true, userId, created }` or
`{ ok: false, reason }`, `reason` one of `email_not_verified`,
`domain_not_allowed`, `no_account`, `identity_conflict`, `email_conflict`,
`two_factor_enabled`. A refusal never throws and writes nothing; a thrown
error is a database failure and reaches the router's `errorHandler`.

Google (`GET /api/oauth/google/callback` in `routes/oauth.js`) is the only
caller. Its policy is `requiredHostedDomain: GOOGLE_OAUTH_DOMAIN`,
`linkByVerifiedEmail: true`, `autoCreate: Boolean(GOOGLE_OAUTH_DOMAIN)`, and the
Google branch is the ladder the route used to carry inline, in the same order
plus two checks: refuse an unverified email, refuse a hosted domain other than
the required one, look up `oauth_accounts` by `provider_user_id`, else take the
user whose `email` matches (that lookup also reads `two_factor_method`),
refuse `two_factor_enabled` if that user has two-factor on (`email` or
`totp`; `none` and NULL are off, as they are to `POST /api/login`), refuse
`identity_conflict` if that user already holds a Google row (another subject,
since the subject lookup missed: spec Decision 3's rule, `open-questions.md`
C7), else link them, else create-and-link (username from
`deriveUniqueUsername`, also in the seam) only when auto-create is on, else
`no_account`. With linking by email off, an email match is `email_conflict`
before either check. The two-factor refusal comes before the Google row check
because it reads the row already in hand and still holds once a conflicting
link is cleared. The link itself is `INSERT INTO oauth_accounts ... SELECT ...
FROM users WHERE id = ? AND email = ? AND (two_factor_method IS NULL OR
two_factor_method = 'none') FOR SHARE`, so the INSERT repeats the test at
insert time, on a locking read, at any isolation level: a change to the user
row still being committed is waited for and then seen. Two-factor turned on
after the lookup, or the account giving up the looked-up email, inserts no
row, and anything but exactly one row is the same `two_factor_enabled` with
nothing written. Without `FOR SHARE`, READ COMMITTED would read the old row
without a lock and link over the change.

**The linked rung never consults local two-factor.** An identity found by
`provider_user_id` signs in with no second-factor challenge, including a user
who turned two-factor on after linking: once linked, Google's own sign-in, its
MFA included, governs the account. That is a deliberate trade-off, and the
`two_factor_enabled` refusal is what keeps it from reaching an account whose
owner never linked Google, because password sign-in (`POST /api/login`)
demands the code and a link by email would skip it for good.

A refusal becomes `/?oauth_error=<reason>`, which `Std_Layout.jsx`
turns into copy in the Login modal, with a generic fallback for a code it does
not know. A provider the seam has no ladder for throws. The route keeps everything around
the seam unchanged: the browser-bound state cookie, the token exchange, the
user fetch and `generateSessionToken`. The OIDC relying party (W6-CDX-5) is the
seam's second caller.

The query order is load-bearing for tests, not only for behaviour: route tests
queue `c2_query` mocks in call order, which is why
`tests/routes/oauth-google-seam.test.js` and
`oauth-google-domain-seam.test.js` pin it through the route and
`tests/services/identity.test.js` pins it call by call.
`tests/integration/oauth-google-two-factor.test.js` proves the two-factor
refusal and the linked rung's trade-off against MySQL 8.4.

### Session tokens

`generateSessionToken(user, ip, userAgent)` (`mysql_connect.js:135-170`) is
**one session per user**, not one per device:

- It looks up `WHERE user_id = ? LIMIT 1`.
- If a live session exists, it updates `ip_address`/`user_agent`/`last_active_at`
  and **returns the same token** (`mysql_connect.js:142-149`).
- If the session exists but is expired, it rotates the id in place and extends
  by 7 days (`mysql_connect.js:151-159`).
- Otherwise it inserts a new row with a 7-day expiry.

Token generation (`mysql_connect.js:121-125`) uses `crypto.getRandomValues` over a
62-character alphabet, default length 64, matching `sessions.id CHAR(64)`. The
modulo mapping is very slightly biased; irrelevant at 64 characters of entropy.

**Consequence:** logging in from a second device silently reuses the first
device's token, and `POST /api/logout` therefore logs out every device at once.

### An email or password change rotates every session

`POST /api/update-account` (`routes/auth.js`, the `router.post('/update-account'`
handler) authenticates by the `token` and `userId` in its body, not
`requireAuth`. A name change needs nothing more. An email or password change
also needs `currentPassword`, compared with `bcrypt.compare` against
`users.password_hash` as `POST /api/login` does: missing is a 400, wrong is a
401, and neither writes anything. The credential check runs before the
uniqueness checks, so a session alone cannot ask which addresses are taken. An
email equal to the one on file is not a change, which is what lets the account
panel send the form as it stands.

On success the `UPDATE users` and `DELETE FROM sessions WHERE user_id = ?` run in
one `withTransaction()` (the caller's own row included: the old
`AND id != ?` "keep this device" delete is gone), and only after the commit
does the handler call `generateSessionToken`, which finds no row and inserts a
fresh one. The response is `{ success: true, token }`; the account panel stores
it with `setSessionCookie` (`src/util.jsx`), the same writer sign-in uses. An
email change then sends `buildEmailChangedNoticeEmail` to the OLD address when
`isMailEnabled()`, and a failed send is logged, never answered as a failure.

Why the caller's row goes too: sessions are one per user (above), so the
caller's token is every other holder's, and keeping it alive kept a stolen
session alive through the owner's password change. **What it does not fix:**
until sessions are per sign-in (W6-CDX-2), a later sign-in by anyone with the
new credentials is handed the caller's new token by `generateSessionToken`,
exactly as any two sign-ins share one today. Rotation signs out every holder of
the old token, and that is all it can do on this schema.

An account with **no password** (`password_hash` NULL, made by an external
sign-in) cannot answer the check. A password change is refused with a pointer
to Forgot Password. An email change is refused with a 503 when mail is off;
with mail on, `startEmailChangeByCode` (same file) invalidates the user's
unused `two_factor_codes` and unused `email_change` tokens, mints a code and an
`email_change` row carrying `new_email`, sends the code to the CURRENT address
(`buildEmailChangeCodeEmail`), then applies any name change in the request, and
answers `{ requires_email_code: true, confirmToken }`. The email itself changes
only at `POST /api/update-account/confirm-email` (`requireAuth`, modelled on
`/2fa/disable/confirm`): purpose-bound token lookup, owner check, code check,
uniqueness re-check, then the same transaction-then-fresh-token rotation and
notice. Both routes share the auth rate-limit bucket through one mount on
`/api/update-account`.

### Logout actually terminates the session now

`POST /api/logout` used to read its token from `req.body.token` only. No client
sends one: `apiFetch` in `src/util.jsx` puts the session token in an
`Authorization: Bearer` header, and `AccountPanel.jsx` posts an empty body, then
swallows the rejection in a `catch`. Every logout was therefore a 400 nobody
saw, and **no `sessions` row was ever deleted**: the client cleared its local
token while the server-side session stayed valid until its 7-day expiry, usable
by anyone who had the token.

It now resolves the token through the same `extractSessionToken` that
`requireAuth` uses, with `req.body.token` kept as a fallback for any caller that
still posts one, and only 400s when the request carries no token at all. The
route stays unauthenticated: it deletes by token, so presenting a token is the
authorisation, and an unknown token deletes nothing.

The cookie fallback does not open a cross-site logout: every writer of the
`sessionToken` cookie sets `SameSite=Strict` (`routes/oauth.js` server-side,
`src/components/Login.jsx` client-side), so a cross-site POST carries no cookie
and lands in the 400 branch.

**`POST /api/create-account` generates its session token only after its
transaction commits.** The user insert, default-permissions insert,
invitation-accepted update, and (when the invitation carried a `squadId`) the
new `squad_members` insert all run inside one `withTransaction()` call in
`routes/auth.js`. `generateSessionToken` is called afterward, outside the
transaction, so the token is the caller's proof that every write landed; a
mid-transaction failure rolls all four back and never mints a token for a
half-created account.

## 4. Error handling

The convention is per-router, not app-global. Each router file ends with
`router.use(errorHandler)` where `errorHandler` comes from
`routes/helpers/shared.js:258-264`:

```js
console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}:`, err);
res.status(500).json({ success: false, message: 'An internal server error occurred' });
```

It always emits 500 and never leaks the error message to the client. Async
handlers reach it because every route is wrapped in `asyncHandler`
(`shared.js:30-31`), a one-liner that catches a rejected promise into `next`.

**`routes/github.js` is the deliberate exception.** Its terminal handler
(`github.js:2340-2347`) forwards the upstream status when it is a sane
4xx/5xx and prefers `err.ghBody.message`, so a GitHub 404 surfaces as a 404
with GitHub's own wording. Replacing it with the shared `errorHandler` would
turn every "file not found on that branch" into a 500. See
[github-integration.md](github-integration.md).

**`app.js` mounts no global error handler at all.** A router that forgets its
`router.use(errorHandler)` falls through to Express's default handler, which
returns an HTML stack trace outside production. Adding a router means adding the
handler.

## 5. WebSocket upgrades

Both WS servers attach to the same `http.Server` returned by
`ViteExpress.listen`, and both use `noServer: true` plus
`server.prependListener('upgrade', ...)` (`services/collab.js:278`,
`services/user-channel.js:104`). `prependListener` is used so these handlers run
before Vite's own HMR upgrade handler, and each returns early when the path is
not its own, letting the next listener try.

| | `/collab` | `/notifications-ws` |
|---|---|---|
| File | `services/collab.js` | `services/user-channel.js` |
| Path guard | `collab.js:282` | `user-channel.js:106` |
| Origin check | `collab.js:285-305` | `user-channel.js:109-127` |
| Query params | `?logId=<int>` (`collab.js:307-313`) | none |
| Auth | first message must be `{type:'auth', token}` within 5s (`collab.js:324-343`) | same, 5s (`user-channel.js:135-153`) |
| Max payload | 5 MB (`collab.js:274`) | default |
| Per-user cap | 10 across all docs (`collab.js:50,359-363`) | 10 (`user-channel.js:23,167-171`) |

**Origin handling is strict in both:** a *missing* `Origin` header is rejected
with a raw `403` on the socket (`collab.js:287-291`), as is any origin whose
host differs from the request `Host`. This is CSWSH protection, and it means a
non-browser client must send an `Origin` matching the host.

**Auth is post-upgrade, not pre-upgrade.** The handshake completes first
(`collab.js:316-318`), then the first frame must be the auth message. An
unauthenticated client can therefore hold an open socket for up to 5 seconds.
Close codes are meaningful: 4001 auth timeout, 4002 malformed auth, 4003
unauthorized or access denied, 4004 too many connections.

Query-string tokens were deliberately avoided; the token travels in a frame, not
in a URL that would land in access logs.

## 6. Response shape

Success is `{ success: true, ... }`. Failure is
`{ success: false, message: '<human readable>' }`. Status codes in use across the
routers: 400 validation, 401 unauthenticated, 403 access denied or feature not
linked, 404 not found or access-denied-disguised-as-not-found, 409 conflict
(duplicate email, GitHub divergence), 413 payload too large, 500 server error.

Some older handlers return a bare `{ message }` without `success`. Two live
examples are in `routes/comments.js:30` and `routes/comments.js:36`. The
convention is to normalise a handler you are already editing, and leave the rest
alone.

---

## 7. Probes and shutdown

### `/healthz` and `/readyz`

`routes/health.js`, mounted at the root before CORS, Helmet and every limiter,
so nothing stands between a supervisor and its answer. Both are
unauthenticated and both set `Cache-Control: no-store`. Because anyone who can
reach the port can call them, **neither body carries a version, a count, a
filename or a table name**; `tests/routes/health.test.js` asserts that over
every outcome.

| Probe | Answers | Touches |
|---|---|---|
| `GET /healthz` | `200 { ok: true }`, always, while the process serves HTTP | nothing: no query, so a database outage never looks like a dead process |
| `GET /readyz` | `200 { ready: true }`, or `503 { ready: false, reason }` | the checks below, first failure wins |

`notReadyReason()` checks, in order:

1. `shutting_down`: `readiness.shuttingDown`, set by the shutdown's first line.
2. `lock`: `readiness.lock` is absent, or neither `held` nor `disabled`
   (`services/instance-lock.js`).
3. `database`: `SELECT 1` through the pool rejects or takes longer than two
   seconds. The answer is reused for one second (`readiness.database`).
4. `migrations`: some file in `migrations/` (`listMigrationFiles`) has no
   `schema_migrations` row (`readApplied`), both reused from
   `scripts/migrate.js`. A missing table (a database nobody adopted) and an
   unreadable directory both count as pending: readiness never says ready when
   it cannot tell. The answer is cached on `readiness.migrations` for ten
   seconds. **The directory is the repo-root `migrations/`, which is not in the
   image**: every compose file bind-mounts it at `/migrations` for the runner,
   and `/readyz` reads the same mount, so a container started without it
   reports `migrations` (and logs why once).

A **fresh** install therefore reads `migrations` until the one-time
`npm run migrate -- --adopt-fresh-install` records its starting point, which is
the documented first-run step (`docs/deployment.md`, "First run"); the first
probe that finds no `schema_migrations` table logs that command once.

The probes are unauthenticated and ahead of every limiter, so a burst of them
must not become a burst of queries. Concurrent callers share the migrations
read that is out (`migrationsCheck`) and the `SELECT 1` that is out
(`readiness.probe`). A `SELECT 1` that outlives the two-second bound still
holds a pooled connection until MySQL answers, so the next probe waits on that
same query rather than queueing another behind it, for up to ten seconds, after
which a query that may never answer is left behind and a new one is sent. At
most one probe query per ten seconds can therefore be stuck in the pool.

The image's `HEALTHCHECK` (`cloudcodex/Dockerfile`) probes `/readyz` every 10 s
with Node's own `fetch` (`node:20-slim` has no curl), a 3 s timeout, a 20 s
start period and 3 retries.

### The instance lock for the life of the process

Taken at boot (section 1), on a connection of its own, and pinged with
`SELECT 1` every 60 s so it is never idle long enough for `wait_timeout`. The
connection carries an `'error'` listener, because a mysql2 connection error
with no listener is thrown by the EventEmitter and would take the process down
with every open document's unsaved state. When the connection is lost (a MySQL
restart), `held` goes false, `/readyz` answers `lock`, and a retake on a new
connection is tried every second (`retakeMs`) until one succeeds; a reason it
keeps failing for, MySQL still down say, is logged once. Only the connection
currently holding the lock can mark it lost, attempts never overlap (`busy`),
and a retake that completes after `release()` ends its own connection.

**If another process took the lock meanwhile**, two live processes now serve
one schema, which is the divergence the lock exists to prevent. The retake's
refusal (`heldElsewhere`) is logged, retrying stops, and `onSuperseded` runs
once: `server.js` logs `another process took the instance lock while this one
had lost it` and runs the shutdown below with exit code 1 (or exits 1 at once
during boot). Under `restart: unless-stopped` the supervisor restarts it into an
ordinary refusal that names the holder. The one-second retake keeps that
window short: a duplicate that reconnects first after a MySQL restart wins it,
and this process stops within about a second of MySQL coming back.
`tests/integration/lifecycle.test.js` KILLs a real server's lock connection,
takes the lock from the test, and requires the server to exit 1 naming the
test's connection. GET_LOCK belongs to
a connection, so a process killed with SIGKILL releases it as soon as MySQL
sees the socket close: `tests/integration/lifecycle.test.js` measures the next
process taking it within two seconds.

### Shutdown

`services/shutdown.js` exports `createShutdown(deps)`, which returns
`shutdown(cause, { code = 0 })`. `server.js` calls it for the first `SIGTERM`
or `SIGINT` once it is serving (section 1; a second signal exits 1 at once
there), and with `('the lost instance lock', { code: 1 })` from
`onSuperseded`. A second call is ignored. In order:

1. `readiness.shuttingDown = true`, so `/readyz` answers 503 from here on.
2. `server.close()`: no new connections.
3. `flushPendingSaves()` (`services/collab.js`): every document with a pending
   debounced save is written now, awaiting a write a fired timer already has in
   flight first so an older state can never land after a newer one; one
   document that throws is logged and the rest still run.
4. `closeAll(1001, 'Server shutting down')` on both WebSocket servers
   (`services/collab.js`, `services/user-channel.js`), authenticated or not.
   A live editor reconnects to the next process and its Yjs sync re-sends
   whatever it has that the server does not.
5. The instance lock's connection ends, then `endPool()`
   (`mysql_connect.js:56-58`).
6. `exit(code)`. The last line is `stopped cleanly on <cause>` only when the
   code is 0, every step ran and every pending document was written; otherwise
   it is `stopped on <cause>`, with `N documents not saved` and `N failed
   steps` when there were any. The flush's own line says `wrote N pending
   documents` and how many failed. A failed document or step does not change
   the exit code: the plan fixes a rejecting flush at `exit(0)`, and the line
   is what an operator is told to read.

Every step runs even when an earlier one throws, and the flush still runs for
a lost-lock stop: the process that took over has no editors on these
documents in the realistic case (it is the duplicate), so the flush is what
keeps the last seconds of edits. The whole thing is bounded at 10 s: past that
it logs `shutdown timed out after 10000 ms` and exits 1. The
compose files give the app `stop_grace_period: 20s`, so the bound finishes
before Docker's SIGKILL (its default grace, 10 s, would tie).

**What it does not cover.** An explicit `save` or `publish` frame whose writes
are still in flight is not awaited (only the debounced autosave is), and
`html_content` stays as stale after a restart as it was before one: a document
edited only over the socket still reads its last explicit save to non-editors
(`documents-and-collab.md`).

## Related

- [access-control.md](access-control.md) picks up where `requireAuth` stops.
- [documents-and-collab.md](documents-and-collab.md) covers what happens after
  the `/collab` handshake succeeds.
- [build-test-and-ops.md](build-test-and-ops.md) for how the test suite mounts
  `app.js`.
