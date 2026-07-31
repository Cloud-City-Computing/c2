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
| Listen | `server.js`, `ViteExpress.listen(app, 3000, cb)` | Port 3000 is hardcoded. **Last, deliberately.** `ViteExpress.listen` binds the socket and starts accepting requests *before* running its callback, so anything awaited in there would serve traffic with the answer undecided: a configured instance reporting `isMailEnabled() === false` for the length of the SMTP verify, and an empty app on a first boot. All three steps above therefore run as top-level `await`s before it. |
| Collab WS | `server.js:42` | `setupCollabServer(server)`, path `/collab`. |
| Notification WS | `server.js:46` | `setupUserChannelServer(server)`, path `/notifications-ws`. |
| Activity prune | `server.js:51-67` | Deletes `activity_log` rows older than 365 days. `setInterval` every 24h plus a `setTimeout` 60s after boot, both `.unref()`ed. |

Two consequences worth knowing:

- **`app.js` is importable without side effects on the network.** It was split
  out of `server.js` precisely so Supertest can mount the app without a
  listener (`app.js:4-5`). Tests import `app.js`; they never import `server.js`
  except `tests/server.test.js`.
- **The daily prune is single-process by design.** `server.js:50` says so
  explicitly. If the app is ever scaled horizontally, every replica prunes.

## 2. The middleware stack, in mount order

All of this lives in `cloudcodex/app.js`. Order matters and is not alphabetical.

```
app.set('trust proxy', 1)                    app.js:41
  │
  ├─ CORS, scoped to /api                    app.js:44-63
  ├─ helmet + CSP, scoped to /api            app.js:66-79
  ├─ express.json({ limit: '2mb' })          app.js:91
  ├─ authLimiter on 8 specific paths         app.js:94-101
  ├─ searchLimiter on /api/users/search      app.js:112
  ├─ static /avatars      (7d immutable)     app.js:115-118
  ├─ static /doc-images   (30d immutable)    app.js:121-124
  └─ 17 routers, all mounted at /api         app.js:127-143
```

**CORS** (`app.js:45-61`) allows a request with no `Origin` header, allows an
exact match against `CORS_ORIGIN`, and additionally allows any localhost or
127.0.0.1 origin **when `NODE_ENV !== 'production'`**. Everything else is
rejected.

**CSP** (`app.js:68-77`) is scoped to `/api` on purpose so the Vite dev server's
inline module scripts are not blocked. `frameAncestors: 'none'`,
`objectSrc: 'none'`, `connectSrc` allows `ws:`/`wss:` for the two WebSockets,
`imgSrc` allows `data:` and `blob:` for pasted images.

**Body limit is 2 MB** (`app.js:91`). The collab WebSocket has its own, larger
limits (5 MB frame, 2 MB HTML) in `services/collab.js:43-44`, so a document that
saves fine over WS can 413 over REST.

### Rate limiters

| Limiter | Window / max | Applied to |
|---|---|---|
| `authLimiter` (`app.js:82-89`) | 15 min / 20 | `/api/login`, `/api/create-account`, `/api/forgot-password`, `/api/reset-password`, `/api/2fa/verify`, `/api/2fa/totp/confirm`, `/api/2fa/disable/confirm`, `/api/oauth/google/callback` (`app.js:94-101`) |
| `searchLimiter` (`app.js:104-111`) | 15 min / 60 | `/api/users/search` only (`app.js:112`), to blunt user enumeration |

Both carry `skip: () => process.env.NODE_ENV === 'test'`, which is why the test
suite can hammer `/api/login` without tripping them. That also means **no test
exercises the limiter behaviour itself**.

### Router mounting

All 17 routers mount on the bare `/api` prefix (`app.js:127-143`), so each router
declares its own full path (`router.post('/login', ...)` yields `/api/login`).
There is no per-area prefix. Mount order is the resolution order, and several
routers declare overlapping shapes, so a path collision resolves to whichever
router was mounted first. Current order:

```
auth, search, archives, documents, upload, workspaces, squads, comments,
avatars, doc-images, admin, oauth, github, favorites, notifications,
activity, watches
```

## 3. Authentication

`middleware/auth.js` is the whole of it.

`requireAuth` (`middleware/auth.js:15-47`):

1. Token from `Authorization: Bearer <token>` (`auth.js:17`), falling back to a
   `sessionToken=` cookie parsed by hand out of the raw `Cookie` header
   (`auth.js:20-25`). The cookie path exists for browser redirects, notably the
   OAuth callbacks. There is no cookie-parser dependency.
2. No token, 401 `Authentication required`.
3. `validateAndAutoLogin(token)` (`mysql_connect.js:107-121`) looks the session
   up by primary key, rejects if `expires_at <= now`, then loads the user row.
   The returned user carries exactly `id, name, email, avatar_url, is_admin`.
4. On success sets `req.user` and `req.sessionToken`, then fires
   `touchSession(token)` **without awaiting** (`auth.js:38-43`); a failure is
   logged, never fatal.

`requireAdmin` (`middleware/auth.js:53-58`) is a pure `req.user.is_admin` check
and must run after `requireAuth`.

### Session tokens

`generateSessionToken(user, ip, userAgent)` (`mysql_connect.js:64-99`) is
**one session per user**, not one per device:

- It looks up `WHERE user_id = ? LIMIT 1`.
- If a live session exists, it updates `ip_address`/`user_agent`/`last_active_at`
  and **returns the same token** (`mysql_connect.js:70-78`).
- If the session exists but is expired, it rotates the id in place and extends
  by 7 days (`mysql_connect.js:81-88`).
- Otherwise it inserts a new row with a 7-day expiry.

Token generation (`mysql_connect.js:50-54`) uses `crypto.getRandomValues` over a
62-character alphabet, default length 64, matching `sessions.id CHAR(64)`. The
modulo mapping is very slightly biased; irrelevant at 64 characters of entropy.

**Consequence:** logging in from a second device silently reuses the first
device's token, and `POST /api/logout` (`routes/auth.js:358`) therefore logs out
every device at once.

## 4. Error handling

The convention is per-router, not app-global. Each router file ends with
`router.use(errorHandler)` where `errorHandler` comes from
`routes/helpers/shared.js:192-198`:

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
