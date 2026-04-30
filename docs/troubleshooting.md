```
╔════════════════════════════════════════════════════════════════════════════╗
║                                                                            ║
║   TROUBLESHOOTING                                                          ║
║   The handful of things that actually break, and what to do about them.    ║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝
```

# Troubleshooting

The things that go wrong in practice, in roughly the order they tend to
hit you. Each entry follows the same shape: a framed symptom box, then
the cause and the fix.

---

```
┃ ⚠  Symptom
┃   Server exits at startup with "SMTP credentials missing" or
┃   "verifyEmailConnection failed".
```

**Cause.** `SMTP_HOST`, `SMTP_USER`, or `SMTP_PASS` is empty in `.env`,
or the configured server refused the test connection. SMTP is a hard
dependency; the app exits rather than running in a half-broken state
where password reset and 2FA silently fail.

**Fix.**
1. Confirm all three are set in `.env`.
2. Try the credentials manually with `swaks` or any SMTP CLI.
3. If you're using Gmail / Workspace, you need an **app password**, not
   your account password. TLS port 465 also works
   (`SMTP_PORT=465` triggers TLS automatically).
4. Restart with `docker compose -f docker-compose-prod.yml up -d` and
   watch `docker logs`.

---

```
┃ ⚠  Symptom
┃   Server exits at startup with "Admin credentials missing".
```

**Cause.** `ADMIN_USERNAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` are not
all set. The admin super-user is synced from `.env` on every boot — there
is no way to bootstrap the system without one.

**Fix.** Set all three in `.env`. You can change them later through the
admin panel; subsequent boots will sync any changes you make to `.env`
back into the user record.

---

```
┃ ⚠  Symptom
┃   "ECONNREFUSED 127.0.0.1:3306" or "Access denied for user … "
┃   in the Node container's logs.
```

**Cause.** The MySQL container is not up yet, or the credentials in
`.env` don't match what MySQL was initialized with. The very first
`docker compose up` initializes MySQL using `MYSQL_ROOT_PASSWORD` plus
the user/db env vars — once that volume exists, changing those env
vars in `.env` will not retroactively change MySQL's credentials.

**Fix.**
1. `docker compose ps` — confirm the MySQL container is `healthy`.
2. `docker logs <mysql-container>` — check for init errors.
3. If you've been changing `DB_USER`/`DB_PASS` after first boot, the
   credentials inside the volume don't match. Either reset the user
   inside MySQL (`make db-shell`, then `ALTER USER`) or — if you don't
   need the data — remove the volume and start fresh: `docker compose
   down -v` (this **destroys** all data; back up first).

---

```
┃ ⚠  Symptom
┃   Google sign-in returns 403 "Domain not allowed".
```

**Cause.** `GOOGLE_OAUTH_DOMAIN` is set and the user's email is on a
different domain.

**Fix.** Either remove `GOOGLE_OAUTH_DOMAIN` to allow any domain (no
auto-account-creation outside the original domain — they'd need an
invitation), or update it to the right domain. Existing users from
other domains can still **link** Google to their account; the domain
check only governs SSO sign-up.

---

```
┃ ⚠  Symptom
┃   GitHub sign-in succeeds but the OAuth callback errors with
┃   "redirect_uri_mismatch".
```

**Cause.** The callback URL registered on the GitHub OAuth app does not
exactly match `${APP_URL}/api/oauth/github/callback`.

**Fix.** Open the GitHub OAuth app settings. The callback URL must
match the public `APP_URL` exactly — including the scheme (https), host,
no trailing slash. If you're testing on a local domain, register a
second callback URL for it.

---

```
┃ ⚠  Symptom
┃   Linked GitHub accounts suddenly fail with "decryption failed" after
┃   redeploying.
```

**Cause.** `GITHUB_CLIENT_SECRET` changed. That value is also the seed
for the AES-256-GCM key that encrypts stored OAuth tokens. Changing
it invalidates every stored token in `oauth_accounts`.

**Fix.** If the change was accidental, restore the previous value. If
intentional (e.g. rotated GitHub OAuth app), every linked user must
**re-link** their GitHub account from `/account`. Tokens cannot be
recovered.

---

```
┃ ⚠  Symptom
┃   Editor opens but other users' cursors / live edits don't appear,
┃   or the doc reverts after refresh. Notifications never push live.
```

**Cause.** A reverse proxy in front of the app is stripping or not
forwarding the WebSocket upgrade headers. Both `/collab/:logId` and
`/notifications-ws` rely on `Upgrade: websocket` + `Connection: Upgrade`
passing through unchanged.

**Fix.**
- **Caddy:** `reverse_proxy` handles WS automatically.
- **nginx:** add the standard upgrade block:
  ```
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  ```
- **Cloudflare:** WebSockets are on by default for paid plans; verify
  the WebSockets toggle is on in the dashboard.

Confirm by opening the browser dev console — the WS connection to
`/collab/:logId` should be `101 Switching Protocols`, not `502` or
`400`.

---

```
┃ ⚠  Symptom
┃   "/notifications-ws" closes immediately with code 4002 or 403.
```

**Cause.** Either the proxy is rewriting the `Origin` header (so the
same-origin check in `services/user-channel.js` rejects the upgrade),
or the client did not send `{type:'auth', token:'…'}` within 5 seconds.

**Fix.**
- Make sure your proxy preserves both `Origin` and `Host` so the public
  hostname appears on both — the WS server compares them as exact
  matches.
- The auth message must arrive within 5 s of upgrade. If a custom
  client is being used, send it immediately on `open`.

---

```
┃ ⚠  Symptom
┃   Image upload silently fails or the server logs include
┃   "Could not load the sharp module" / "Cannot find module
┃   '@img/sharp-…'".
```

**Cause.** `sharp` is a native module and ships per-platform binaries.
Building inside one image and running on another (e.g. building on Mac
and running on Linux/arm64) leaves it without a matching native binary.

**Fix.** Always build the production image on the same platform you'll
run it on, or use Docker buildx with a matching `--platform`. Locally,
`npm rebuild sharp` after switching platforms.

---

```
┃ ⚠  Symptom
┃   CI fails with "ERROR: Coverage … below threshold for routes/foo.js
┃   (lines 78%, expected 85%)".
```

**Cause.** A change reduced coverage on a glob with a per-glob threshold
in `vitest.config.js`. The global floor is intentionally low; the
per-glob floors lock in achieved coverage on security-critical modules.

**Fix.** Either add tests to bring coverage back, or — if the drop is
genuinely justified (e.g. removing dead code increases the percent
denominator) — adjust the threshold for that glob. Don't blanket-lower
without good reason; the threshold's job is exactly to make this
visible.

---

```
┃ ⚠  Symptom
┃   `npm test` floods stdout with React 19 warnings during frontend
┃   tests.
```

**Cause.** React 19 emits dev-only warnings for patterns it's
deprecating (act-less updates, certain ref usages). The frontend
project uses the dev React build for jsdom.

**Fix.** Expected. Don't suppress globally — fix the underlying pattern
in the component or test (usually wrapping the action in `act(…)` or
adopting `userEvent`). If a third-party library is the source, file an
upstream issue and silence narrowly with a `console.error` mock around
the offending block.

---

```
┃ ⚠  Symptom
┃   Vite dev server fails to bind because port 3000 is in use.
```

**Cause.** Another instance of `npm run dev` is already running, or
something else (a previous container, an unrelated app) is holding the
port.

**Fix.** `lsof -iTCP:3000 -sTCP:LISTEN` to find the offender and kill
it. Cloud Codex doesn't currently take a `PORT` env var — port 3000
is hard-coded in dev. If you really need a different port, search for
the literal in `server.js` and the docs.

---

```
┃ ⚠  Symptom
┃   `npm install` fails with native build errors on `bcrypt` or
┃   `sharp`.
```

**Cause.** Both are native modules. On Linux you typically need build
tools (`build-essential`, `python3`), and on macOS Xcode CLI tools.

**Fix.** Install the platform's build tools, then retry. The container
image already includes them — if you're building images, this only hits
local installs.
