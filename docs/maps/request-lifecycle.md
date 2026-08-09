# Request Lifecycle Map

From process start to response body: what boots, in what order, what every
request passes through, and how the two WebSocket servers get attached to the
same HTTP listener.

---

## 1. Boot order

`cloudcodex/server.js` is the entry point and it is deliberately fail-fast: two
config gates run **before** anything listens.

| Step | Location | Behaviour |
|---|---|---|
| Load `.env` | `mysql_connect.js:16` | `dotenv` reads `../.env`, i.e. the **repo root**, not `cloudcodex/`. Importing `mysql_connect.js` is what loads env for the whole process. |
| DB pool | `mysql_connect.js:18-26` | `mysql2/promise` pool, `connectionLimit: 10`, no queue limit. |
| DB credential gate | `mysql_connect.js:28-32` | Missing `DB_USER`/`DB_PASS` calls `process.exit(1)`. |
| Admin config gate | `server.js`, top-level | Missing `ADMIN_USERNAME`/`ADMIN_PASSWORD`/`ADMIN_EMAIL` exits 1. This is now the only boot-fatal config gate besides the DB one above; there is no SMTP gate. |
| Mail capability | `server.js`, top-level `await` | `initMail()` (`services/email.js`) decides once, at boot, whether mail is usable: SMTP configured **and** the connection verifies. It never exits. Enabled logs `✔ SMTP connection verified`; disabled logs `✖ Email disabled: <reason>. Invites will show copyable links; password reset is unavailable.` on stderr, and `sendEmail()` becomes a silent no-op (`{skipped: true}`) for the rest of the process, so fire-and-forget callers needed no changes. The transport sets `connectionTimeout`/`greetingTimeout` of 10s and `socketTimeout` of 20s (`services/email.js`), so an unreachable host costs seconds here, not nodemailer's default two minutes. |
| Admin sync | `server.js`, top-level `await` | `ensureAdminUser()` from `routes/admin.js` upserts the `.env` admin and returns its `id` (`Promise<number\|null>`). Wrapped in `try/catch`: a DB blip logs `admin user sync failed` and boot continues with `adminId = null` rather than never listening. |
| Bootstrap instance | `server.js`, top-level `await` | `bootstrapInstance(adminId)` from `routes/admin.js` seeds a starter workspace, squad, squad-ownership row, archive and welcome document the first time the database holds **no workspaces, archives or logs at all** (one `SELECT` of three `COUNT(*)` sub-selects). Workspaces alone would not do: `DELETE /api/workspaces/:id` plus `archives.squad_id ON DELETE SET NULL` (`init.sql:212`) can leave orphaned archives and logs behind an empty `workspaces` table. All five writes share one transaction via `withTransaction()` in `mysql_connect.js`. Also `try/catch`-wrapped: a failed seed logs `instance bootstrap failed` and leaves the instance empty but usable, and the next restart retries. |
| Listen | `server.js`, `ViteExpress.listen(app, port)` | Port is `PORT` if set, else 3000; a non-numeric or out-of-range `PORT` exits rather than falling back. **Last, deliberately.** `ViteExpress.listen` binds the socket and starts accepting requests *before* running its callback, so anything awaited in there would serve traffic with the answer undecided: a configured instance reporting `isMailEnabled() === false` for the length of the SMTP verify, and an empty app on a first boot. All three steps above therefore run as top-level `await`s before it. **The success line is guarded on `server.listening`**, because Express 5 aliases `listen`'s callback onto the socket's `'error'` event and so runs it on a failed bind too (see `open-questions.md` B8); a sibling `'error'` handler names the port and exits non-zero. The `'listening'` event is deliberately *not* used: `vite-express` injects its middleware asynchronously, so that event fires about twelve seconds before the dev server can serve. |
| Collab WS | `server.js:64` | `setupCollabServer(server)`, path `/collab`. |
| Notification WS | `server.js:68` | `setupUserChannelServer(server)`, path `/notifications-ws`. |
| Activity prune | `server.js:73-89` | Deletes `activity_log` rows older than 365 days. `setInterval` every 24h plus a `setTimeout` 60s after boot, both `.unref()`ed. |

Two consequences worth knowing:

- **`app.js` is importable without side effects on the network.** It was split
  out of `server.js` precisely so Supertest can mount the app without a
  listener (`app.js:4-5`). Tests import `app.js`; they never import `server.js`
  except `tests/server.test.js`.
- **The daily prune is single-process by design.** `server.js:72` says so
  explicitly. If the app is ever scaled horizontally, every replica prunes.

## 2. The middleware stack, in mount order

All of this lives in `cloudcodex/app.js`. Order matters and is not alphabetical.

```
app.set('trust proxy', 1)                    app.js:42
  │
  ├─ CORS, scoped to /api                    app.js:53-109
  ├─ helmet + CSP, scoped to /api            app.js:112-125
  ├─ express.json({ limit: '2mb' })          app.js:137
  ├─ authLimiter on 8 specific paths         app.js:140-147
  ├─ searchLimiter on /api/users/search      app.js:158
  ├─ static /avatars      (7d immutable)     app.js:161-164
  ├─ static /doc-images   (30d immutable)    app.js:167-170
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

**CSP** (`app.js:113-124`) is scoped to `/api` on purpose so the Vite dev server's
inline module scripts are not blocked. `frameAncestors: 'none'`,
`objectSrc: 'none'`, `connectSrc` allows `ws:`/`wss:` for the two WebSockets,
`imgSrc` allows `data:` and `blob:` for pasted images.

**Body limit is 2 MB** (`app.js:137`). The collab WebSocket has its own, larger
limits (5 MB frame, 2 MB HTML) in `services/collab.js:43-44`, so a document that
saves fine over WS can 413 over REST.

### Rate limiters

| Limiter | Window / max | Applied to |
|---|---|---|
| `authLimiter` (`app.js:128-136`) | 15 min / 20 | `/api/login`, `/api/create-account`, `/api/forgot-password`, `/api/reset-password`, `/api/2fa/verify`, `/api/2fa/totp/confirm`, `/api/2fa/disable/confirm`, `/api/oauth/google/callback` (`app.js:140-147`) |
| `searchLimiter` (`app.js:150-157`) | 15 min / 60 | `/api/users/search` only (`app.js:158`), to blunt user enumeration |

Both carry `skip: () => process.env.NODE_ENV === 'test'`, which is why the test
suite can hammer `/api/login` without tripping them. That also means **no test
exercises the limiter behaviour itself**.

### Router mounting

All 18 routers mount on the bare `/api` prefix, so each router
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

`requireAuth` (`middleware/auth.js:15-47`):

1. Token from `Authorization: Bearer <token>` (`auth.js:17`), falling back to a
   `sessionToken=` cookie parsed by hand out of the raw `Cookie` header
   (`auth.js:20-25`). The cookie path exists for browser redirects, notably the
   OAuth callbacks. There is no cookie-parser dependency.
2. No token, 401 `Authentication required`.
3. `validateAndAutoLogin(token)` (`mysql_connect.js:152-166`) looks the session
   up by primary key, rejects if `expires_at <= now`, then loads the user row.
   The returned user carries exactly `id, name, email, avatar_url, is_admin`.
4. On success sets `req.user` and `req.sessionToken`, then fires
   `touchSession(token)` **without awaiting** (`auth.js:38-43`); a failure is
   logged, never fatal.

`requireAdmin` (`middleware/auth.js:53-58`) is a pure `req.user.is_admin` check
and must run after `requireAuth`.

### Session tokens

`generateSessionToken(user, ip, userAgent)` (`mysql_connect.js:109-144`) is
**one session per user**, not one per device:

- It looks up `WHERE user_id = ? LIMIT 1`.
- If a live session exists, it updates `ip_address`/`user_agent`/`last_active_at`
  and **returns the same token** (`mysql_connect.js:116-123`).
- If the session exists but is expired, it rotates the id in place and extends
  by 7 days (`mysql_connect.js:125-133`).
- Otherwise it inserts a new row with a 7-day expiry.

Token generation (`mysql_connect.js:95-99`) uses `crypto.getRandomValues` over a
62-character alphabet, default length 64, matching `sessions.id CHAR(64)`. The
modulo mapping is very slightly biased; irrelevant at 64 characters of entropy.

**Consequence:** logging in from a second device silently reuses the first
device's token, and `POST /api/logout` (`routes/auth.js:371`) therefore logs out
every device at once.

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
`routes/helpers/shared.js:198-204`:

```js
console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}:`, err);
res.status(500).json({ success: false, message: 'An internal server error occurred' });
```

It always emits 500 and never leaks the error message to the client. Async
handlers reach it because every route is wrapped in `asyncHandler`
(`shared.js:30-31`), a one-liner that catches a rejected promise into `next`.

**`routes/github.js` is the deliberate exception.** Its terminal handler
(`github.js:2254-2261`) forwards the upstream status when it is a sane
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
`server.prependListener('upgrade', ...)` (`services/collab.js:211`,
`services/user-channel.js:86`). `prependListener` is used so these handlers run
before Vite's own HMR upgrade handler, and each returns early when the path is
not its own, letting the next listener try.

| | `/collab` | `/notifications-ws` |
|---|---|---|
| File | `services/collab.js` | `services/user-channel.js` |
| Path guard | `collab.js:215` | `user-channel.js:88` |
| Origin check | `collab.js:218-238` | `user-channel.js:91-109` |
| Query params | `?logId=<int>` (`collab.js:240-246`) | none |
| Auth | first message must be `{type:'auth', token}` within 5s (`collab.js:257-276`) | same, 5s (`user-channel.js:117-135`) |
| Max payload | 5 MB (`collab.js:208`) | default |
| Per-user cap | 10 across all docs (`collab.js:45,292-296`) | 10 (`user-channel.js:23,150-153`) |

**Origin handling is strict in both:** a *missing* `Origin` header is rejected
with a raw `403` on the socket (`collab.js:220-224`), as is any origin whose
host differs from the request `Host`. This is CSWSH protection, and it means a
non-browser client must send an `Origin` matching the host.

**Auth is post-upgrade, not pre-upgrade.** The handshake completes first
(`collab.js:249-251`), then the first frame must be the auth message. An
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

## Related

- [access-control.md](access-control.md) picks up where `requireAuth` stops.
- [documents-and-collab.md](documents-and-collab.md) covers what happens after
  the `/collab` handshake succeeds.
- [build-test-and-ops.md](build-test-and-ops.md) for how the test suite mounts
  `app.js`.
