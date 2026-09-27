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
┃   Startup log shows "✖ Email disabled: <reason>." Invitations only
┃   show a copyable link instead of sending mail, "Forgot password"
┃   reports itself unavailable, and email-based 2FA can't be enabled.
```

**Cause.** `SMTP_HOST`, `SMTP_USER`, or `SMTP_PASS` is empty in `.env`,
or the configured server refused the connection test. Mail is optional:
the server boots either way and degrades those three features instead of
exiting (the admin-credentials gate below is the only thing that's still
boot-fatal). Squad invitations still work: the in-app notification is the
reliable channel and the email was only ever a convenience.

**An email change on an account with no password is refused too,** since
its confirmation code goes out by email; see the account-page entry below.

**Two-factor authentication is affected, in both directions.** Logging in
with authenticator-app (TOTP) 2FA works normally, but *both* of these
refuse with `503` while mail is off, because both deliver a code by email:

- **Login for an account using email 2FA.** The verification code cannot
  be sent, so the login is refused outright rather than issuing a
  challenge nobody can answer. The account is unreachable until mail is
  restored, and "Forgot password" is unavailable too, so there is no
  self-service way out.
- **Turning 2FA off,** for email *and* TOTP accounts alike. The disable
  confirmation code is emailed in both cases.

**Recovery: an admin can clear 2FA without touching the database.**
`POST /api/admin/users/:id/2fa/reset` (also exposed as a "Reset 2FA" button
in the admin console's Users panel, next to a user whose 2FA is enabled)
clears `two_factor_method`, `totp_secret`, any outstanding
`two_factor_codes`, and any unused `password_reset_tokens` rows left behind
by an in-progress setup or disable confirmation. The affected user gets an
in-app notification either way; restoring mail is only needed if they want
to set 2FA up again with email delivery. See `docs/api/admin.md`.

**Fix.**
1. Confirm all three SMTP variables are set in `.env`.
2. Try the credentials manually with `swaks` or any SMTP CLI.
3. If you're using Gmail / Workspace, you need an **app password**, not
   your account password. TLS port 465 also works
   (`SMTP_PORT=465` triggers TLS automatically).
4. Restart with `docker compose -f docker-compose-prod.yml up -d` and
   watch `docker logs` for `✔ SMTP connection verified`.

**The mail capability is decided once, at boot, and never re-checked.**
`initMail()` runs before the port opens and the answer holds for the life
of the process, so fixing `.env` or bringing the SMTP host back up does
nothing until you **restart the app**. The same applies in reverse: a
server that dies after boot is not noticed, sends just start failing.
Connection and greeting attempts time out after 10 seconds each, so an
unreachable SMTP host delays startup by seconds, not minutes.

---

```
┃ ⚠  Symptom
┃   Server exits at startup with "Missing required admin configuration".
```

**Cause.** `ADMIN_USERNAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` are not
all set. The admin super-user is synced from `.env` on every boot — there
is no way to bootstrap the system without one.

**Fix.** Set all three in `.env`. Change them later in `.env`, not in the
app: every boot resets the admin's email and password from `ADMIN_EMAIL` and
`ADMIN_PASSWORD`.

---

```
┃ ⚠  Symptom
┃   "admin sync: ... matches an existing non-admin account (user N),
┃   refusing to promote it" in the server log at startup.
```

**Cause.** An account that is not an admin holds the name in `ADMIN_USERNAME`
or the address in `ADMIN_EMAIL`, usually because the admin renamed or changed
email and a member took the old one. The boot sync never promotes an account,
so it changed nothing and carried on starting.

**Fix.** If account `N` should be the admin, promote it in the admin console
(Users, click its **User** badge); from the next boot on its email and password
are reset from `.env` like any admin's. Otherwise set `ADMIN_USERNAME` and
`ADMIN_EMAIL` to the admin's current name and address, or to unused ones to
have boot create a fresh admin, and restart. See
[deployment.md, The boot admin](./deployment.md#the-boot-admin).

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
┃   On a fresh install, every request fails and the app's log shows
┃   "Table 'c2.users' doesn't exist". The MySQL container's log shows
┃   "/docker-entrypoint-initdb.d/init.sql: Permission denied".
```

**Cause.** The host enforces SELinux (Fedora, RHEL and their relatives), and
the compose file mounted `init.sql` without a relabel, so the MySQL container
could not read it. The first boot's initialisation then failed, MySQL
restarted on a data directory that was no longer empty, skipped
initialisation, and came up with no tables. `docker-compose-release.yml` and
`docker-compose-prod.yml` up to and including 0.11.0 mount it this way; later
versions mount it `:ro,z`.

**Fix.** On a version that still has the old line, change the `init.sql`
mount in the compose file you run to end in `:ro,z`, then start again from an
empty data directory: `docker compose -f <file> down -v` (this **destroys**
the database, which on a fresh install holds nothing yet) and `docker compose
-f <file> up -d`. The app's log then shows `admin sync: created ...`.

---

```
┃ ⚠  Symptom
┃   Google sign-in lands back on the sign-in form with "Your Google
┃   account domain is not allowed" (`/?oauth_error=domain_not_allowed`).
```

**Cause.** `GOOGLE_OAUTH_DOMAIN` is set and the Google account's hosted
domain is a different one (or it is a consumer account with none).

**Fix.** Either set `GOOGLE_OAUTH_DOMAIN` to the right domain, or remove
it to accept any Google account. Removing it also stops automatic account
creation for everyone, so a newcomer then needs an invitation first. While
it is set, the domain check runs before any account lookup, so an
existing user whose Google account is on another domain is refused too.

---

```
┃ ⚠  Symptom
┃   Google sign-in lands back on the sign-in form with "This email is
┃   already linked to a different Google account"
┃   (`/?oauth_error=identity_conflict`).
```

**Cause.** A Cloud Codex user has this email, and already has a Google
account linked under a different Google identity. That happens when a
Workspace address is reassigned to a new person, or a Google account is
deleted and recreated. Sign-in refuses rather than hand the newcomer the
previous owner's account.

**Fix.** Decide whose account it is. If it really is the same person on a
new Google account, they sign in with their password and choose **Unlink**
next to Google in the account menu (it needs a password set), then sign in
with Google again, which links the new account. Without a password, an
operator deletes the old link:
`DELETE FROM oauth_accounts WHERE user_id = <id> AND provider = 'google'`
(`make db-shell`). If it is a different person, the address has changed
hands and the old account still holds it; deal with that account first,
because two users cannot share an email.

---

```
┃ ⚠  Symptom
┃   Google sign-in lands back on the sign-in form with "This account has
┃   two-factor authentication on, so it cannot be linked to Google by
┃   email" (`/?oauth_error=two_factor_enabled`).
```

**Cause.** A Cloud Codex user has this email, has two-factor
authentication on (an authenticator app or an email code, either one), and
has no Google account linked yet. Google sign-in links an existing account
by its verified email only when two-factor is off, because a linked Google
account signs in from then on without the local code. Nothing was written.
Rarely, the same answer comes back when the account's email address changed
while the sign-in was under way; signing in again then gets the right answer.

**Fix.** Sign in with the username, password and code; the account works
exactly as before. If its owner also wants Google sign-in on it, they turn
two-factor off from the account menu, sign in with Google once (which links
the account), and can then turn two-factor back on. Know the trade-off before
doing that: a linked Google account signs in through Google's own sign-in,
its MFA included, and is never asked for the local code, whether two-factor
is on or off; password sign-in still asks for it. Turning two-factor off
emails a confirmation code, so on an instance without mail an admin's
**Reset 2FA** does it instead (see the email entry above).

**Reviewing Google links made before this release.** The database cannot
tell a link the owner made from one made without their second factor: a link
made by email records the account's own address as `provider_email`, and
nothing records when two-factor was turned on or off. Two-factor may also have
been turned off since a link was made, so an account showing `none` today is
not cleared by that alone. List every Google link made by email, that is,
made more than a minute after its account (a Google sign-in that creates an
account links it in the same moment), accounts with two-factor on now first
(`make db-shell`):

```sql
SELECT u.id, u.name, u.email, u.two_factor_method,
       u.created_at AS account_created, o.created_at AS google_linked
  FROM users u
  JOIN oauth_accounts o ON o.user_id = u.id AND o.provider = 'google'
 WHERE o.created_at > u.created_at + INTERVAL 1 MINUTE
 ORDER BY u.two_factor_method IN ('email', 'totp') DESC, o.created_at;
```

For each row, ask the owner whether they linked Google themselves. Where that
cannot be confirmed, delete the link (the owner can link again deliberately,
as the Fix above describes) and the account's session:

```sql
DELETE FROM oauth_accounts WHERE user_id = <id> AND provider = 'google';
DELETE FROM sessions WHERE user_id = <id>;
```

The second statement is not optional. An account has one session, shared by
every sign-in to it: a new sign-in is handed the live session the account
already has (`generateSessionToken` in `mysql_connect.js`), so whoever signed
in through the link holds the owner's own session token, and deleting the link
leaves them signed in. A password reset through **Forgot password** deletes
every session, and from this release so does an email or password change (the
next entry), so either can stand in for the second statement. Once the
sessions are gone, have the owner sign in again and check that the account's
email address, password and two-factor setting are theirs: before this
release a session alone was enough to change the email and the password. If
the email address is not theirs, an operator restores it before the owner
resets the password. One shared session per account is what the planned
W6-CDX-2 (one session per sign-in, stored hashed) replaces.

---

```
┃ ⚠  Symptom
┃   Changing your email on the account page asks for your current
┃   password, answers "Your current password is incorrect.", or
┃   refuses with "This account has no password, so an email change is
┃   confirmed with a code sent to your current address, and this
┃   instance cannot send email."
```

**Cause.** A signed-in session is no longer enough to change an account's
email or password. The account page asks for the current password as soon
as the email field differs from the saved address; the API
(`POST /api/update-account`) refuses an email or password change without a
correct `currentPassword`, with a 400 when it is missing and a 401 when it
is wrong, and changes nothing either way. A name change needs no password.

An account with no password (one an external sign-in created) confirms an email
change with a 6-digit code sent to its **current** address instead. That
needs mail, so with mail disabled the change is refused with the sentence
above.

After an email change goes through, every other device signed in to the
account is signed out and has to sign in again; the device that made the
change keeps working on a new session. The old address gets a notice.

**Fix.**
- Wrong password: enter the account's current password. Forgotten it? Sign
  out and use "Forgot Password?" on the sign-in screen, then try again.
- No password and mail disabled: an administrator can change the address in
  the database (`UPDATE users SET email = ? WHERE id = ?`) or restore mail
  (the email-disabled entry above) so the code can be sent.
- A script or integration calling the API: add `currentPassword` to the
  body for email and password changes, and store the `token` the response
  returns, because the one it sent has been deleted. See `docs/api/auth.md`.

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
it, or start this instance on another port with `PORT=<n>` (`server.js`
honours it, defaulting to 3000); set `APP_URL` to match.

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
